-- Nexus Multiverse 6.13: equipment prerequisites and conflict validation.
-- Optional default_properties.equip_requirements:
-- {"min_attributes":{"STR":15},"forbidden_equipped_categories":["shield"]}
-- Minimums read saved base character attributes, not effective equipped bonuses.
-- Equip checks run inside the existing serialized, authorized transaction before
-- deleting or replacing equipment; the valid-slot reader uses the same helper.
-- Item requirements are authored through a GM-only RPC for campaign-created items.
-- Existing 2-argument equip_inventory_item wrapper still dispatches to 3-argument implementation.
-- All newly added helper operations remain non-executable by client roles.

CREATE OR REPLACE FUNCTION app_private.equipment_requirement_failure(p_character uuid, p_item uuid, p_exclude_assignments uuid[] DEFAULT '{}'::uuid[])
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_campaign uuid;
 v_rules jsonb;
 v_min jsonb;
 v_forbidden jsonb;
 v_pair record;
 v_score integer;
 v_label text;
begin
 select i.campaign_id,
   coalesce(i.properties->'equip_requirements',d.default_properties->'equip_requirements','{}'::jsonb)
 into v_campaign,v_rules
 from public.item_instances i
 join public.item_definitions d on d.id=i.definition_id
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 where i.id=p_item and h.character_id=p_character and h.holder_type='character';
 if v_campaign is null then return 'Item is not owned by the selected character';end if;
 if jsonb_typeof(v_rules)<>'object' then return 'Invalid equipment requirement configuration';end if;
 if v_rules='{}'::jsonb then return null;end if;
 if v_rules - 'min_attributes' - 'forbidden_equipped_categories'<>'{}'::jsonb then
   return 'Unsupported equipment requirement configuration';
 end if;
 v_min:=coalesce(v_rules->'min_attributes','{}'::jsonb);
 v_forbidden:=coalesce(v_rules->'forbidden_equipped_categories','[]'::jsonb);
 if jsonb_typeof(v_min)<>'object' or jsonb_typeof(v_forbidden)<>'array' then
   return 'Invalid equipment requirement configuration';
 end if;
 if jsonb_array_length(v_forbidden)>20 or (select count(*) from jsonb_object_keys(v_min))>20 then
   return 'Too many equipment requirements';
 end if;
 for v_pair in select key,value from jsonb_each(v_min) loop
   if jsonb_typeof(v_pair.value)<>'number' or (v_pair.value #>> '{}') !~ '^[0-9]{1,3}$' then
     return 'Invalid minimum attribute requirement';
   end if;
   select a.score,a.attribute_label into v_score,v_label
   from public.list_character_attributes(p_character) a
   where upper(a.attribute_code)=upper(v_pair.key);
   if not found then return 'Required attribute '||upper(v_pair.key)||' is unavailable';end if;
   if v_score is null or v_score < (v_pair.value #>> '{}')::integer then
     return 'Requires base '||coalesce(v_label,upper(v_pair.key))||' '||(v_pair.value #>> '{}')||
       ' (current '||coalesce(v_score::text,'unset')||')';
   end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(v_forbidden) v where jsonb_typeof(v.value)<>'string') then
   return 'Invalid forbidden equipped category';
 end if;
 select d.category into v_label
 from public.equipment_assignments a
 join public.item_instances i on i.id=a.item_instance_id
 join public.item_definitions d on d.id=i.definition_id
 where a.character_id=p_character and a.id<>all(coalesce(p_exclude_assignments,'{}'::uuid[]))
   and i.id<>p_item
   and lower(d.category) in (select lower(x.value) from jsonb_array_elements_text(v_forbidden) x(value))
 order by d.category limit 1;
 if found then return 'Cannot equip while a '||v_label||' item is equipped';end if;
 return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.equip_inventory_item(p_item uuid, p_slot uuid, p_replace boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign uuid;
  v_char uuid;
  v_holder_type text;
  v_item_category text;
  v_item_two_handed boolean;
  v_slot_campaign uuid;
  v_slot_code text;
  v_slot_label text;
  v_allowed text[];
  v_cap integer;
  v_count integer;
  v_system_code text;
  v_main_id uuid;
  v_off_id uuid;
  v_conflicts uuid[] := '{}';
  v_id uuid;
  v_count_after integer;
  v_requirement_failure text;
begin
  select i.campaign_id,h.character_id,h.holder_type,d.category,
    coalesce((i.properties->>'two_handed')::boolean,
             (d.default_properties->>'two_handed')::boolean,false)
  into v_campaign,v_char,v_holder_type,v_item_category,v_item_two_handed
  from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
  join public.item_definitions d on d.id=i.definition_id
  where i.id=p_item;
  if v_char is null or v_holder_type <> 'character' then
    raise exception 'Item is not character-owned';
  end if;

  -- Lock one character to serialize simultaneous equips and prevent capacity races.
  perform 1 from public.characters where id=v_char and campaign_id=v_campaign and is_active for update;
  if not found then raise exception 'Character is not active'; end if;
  if not (
     app_private.is_gm(v_campaign)
     or exists(
       select 1 from public.characters c
       join public.campaign_members m on m.id=c.member_id
       where c.id=v_char and c.campaign_id=v_campaign
         and c.is_active and m.user_id=(select auth.uid()) and m.status='active'
     )
  ) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  -- Re-read and lock the item after acquiring the character lock.
  select h.character_id, d.category,
    coalesce((i.properties->>'two_handed')::boolean,
             (d.default_properties->>'two_handed')::boolean,false)
  into v_char,v_item_category,v_item_two_handed
  from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id
  join public.item_definitions d on d.id=i.definition_id
  where i.id=p_item and i.campaign_id=v_campaign and h.character_id=v_char
  for update of i;
  if not found then raise exception 'Item is no longer owned by this character'; end if;
  if exists (select 1 from public.item_instances where id=p_item and container_id is not null) then
    raise exception 'Take this item out of storage before equipping it';
  end if;

  select s.capacity,s.campaign_id,s.code,s.label,s.allowed_categories
  into v_cap,v_slot_campaign,v_slot_code,v_slot_label,v_allowed
  from public.equipment_slot_definitions s where s.id=p_slot;
  if v_slot_campaign is distinct from v_campaign then raise exception 'Slot mismatch'; end if;

  if exists(select 1 from public.equipment_assignments where item_instance_id=p_item) then
    raise exception 'This item is already equipped';
  end if;

  if cardinality(v_allowed)>0 and not (v_item_category=any(v_allowed)) then
    raise exception 'Item category "%" is not allowed in the "%" slot',v_item_category,v_slot_label;
  end if;

  select gs.code into v_system_code from public.campaigns c
  join public.ruleset_versions rv on rv.id=c.ruleset_version_id
  join public.game_systems gs on gs.id=rv.system_id where c.id=v_campaign;

  v_slot_code:=lower(regexp_replace(trim(v_slot_code),'[ _-]+','_','g'));
  if v_system_code='dnd5e' then
    if cardinality(v_allowed)=0 then
      case v_slot_code
        when 'main_hand' then v_allowed:=array['weapon','shield','focus','tool'];
        when 'off_hand' then v_allowed:=array['weapon','shield','focus','tool'];
        when 'head' then v_allowed:=array['headgear','armor','clothing'];
        when 'body' then v_allowed:=array['armor','clothing'];
        when 'armor' then v_allowed:=array['armor'];
        when 'neck' then v_allowed:=array['jewelry','wondrous'];
        when 'ring' then v_allowed:=array['jewelry','ring'];
        when 'feet' then v_allowed:=array['footwear','clothing'];
        else v_allowed:=array[]::text[];
      end case;
    end if;
    if cardinality(v_allowed)>0 and not (v_item_category=any(v_allowed)) then
      raise exception 'Item category "%" is not allowed in the "%" slot',v_item_category,v_slot_label;
    end if;

    if v_slot_code in ('main_hand','off_hand') then
      select s.id into v_main_id
      from public.equipment_slot_definitions s where s.campaign_id=v_campaign
        and lower(regexp_replace(trim(s.code),'[ _-]+','_','g'))='main_hand'
      order by s.id limit 1;
      select s.id into v_off_id
      from public.equipment_slot_definitions s where s.campaign_id=v_campaign
        and lower(regexp_replace(trim(s.code),'[ _-]+','_','g'))='off_hand'
      order by s.id limit 1;

      if v_item_two_handed then
        if v_slot_code <> 'main_hand' then raise exception 'Two-handed weapons must use Main Hand'; end if;
        if v_off_id is null then raise exception 'An Off Hand slot is required for two-handed weapons'; end if;
        -- An off-hand item conflicts with the required second hand.
        select coalesce(array_agg(a.id),'{}'::uuid[]) into v_conflicts
        from public.equipment_assignments a
        where a.character_id=v_char and a.slot_id=v_off_id;
      elsif v_slot_code='off_hand' and v_main_id is not null then
        -- Other-hand equipment cannot coexist with a two-handed weapon.
        select coalesce(array_agg(a.id),'{}'::uuid[]) into v_conflicts
        from public.equipment_assignments a
        join public.item_instances i on i.id=a.item_instance_id
        join public.item_definitions d on d.id=i.definition_id
        where a.character_id=v_char and a.slot_id=v_main_id
          and coalesce((i.properties->>'two_handed')::boolean,
                       (d.default_properties->>'two_handed')::boolean,false);
      end if;
    end if;
  end if;

  if cardinality(v_conflicts)>0 and not p_replace then
    raise exception 'Both hands are occupied; choose Replace equipped items';
  end if;

  select count(*) into v_count from public.equipment_assignments
  where character_id=v_char and slot_id=p_slot;
  if v_count>=v_cap then
    if not p_replace then raise exception 'Slot full'; end if;
    -- Replace the oldest occupant; capacity >1 retains other occupants.
    select a.id into v_id from public.equipment_assignments a
    where a.character_id=v_char and a.slot_id=p_slot order by a.id limit 1;
    v_conflicts:=array_append(v_conflicts,v_id);
  end if;

  -- Check requirements with the complete would-be replacement set, before any mutations.
  select app_private.equipment_requirement_failure(v_char,p_item,v_conflicts)
    into v_requirement_failure;
  if v_requirement_failure is not null then
    raise exception '%',v_requirement_failure using errcode='22023';
  end if;

  if cardinality(v_conflicts)>0 then
    delete from public.equipment_assignments
    where id=any(v_conflicts) and character_id=v_char and campaign_id=v_campaign;
  end if;

  select count(*) into v_count_after from public.equipment_assignments
  where character_id=v_char and slot_id=p_slot;
  if v_count_after>=v_cap then raise exception 'Slot full'; end if;

  insert into public.equipment_assignments(campaign_id,character_id,item_instance_id,slot_id)
  values(v_campaign,v_char,p_item,p_slot)
  returning id into v_id;
  return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.list_character_valid_equipment_slots(p_character uuid)
 RETURNS TABLE(item_id uuid, slot_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign uuid;
  v_system_code text;
begin
  select c.campaign_id, gs.code
    into v_campaign, v_system_code
  from public.characters c
  join public.campaigns camp on camp.id = c.campaign_id
  join public.ruleset_versions rv on rv.id = camp.ruleset_version_id
  join public.game_systems gs on gs.id = rv.system_id
  where c.id = p_character and c.is_active;

  if v_campaign is null or not (
    app_private.is_gm(v_campaign)
    or exists (
      select 1 from public.characters c
      join public.campaign_members m on m.id = c.member_id
      where c.id = p_character and c.campaign_id = v_campaign
        and c.is_active and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with slot_rules as (
    select s.id, s.code, s.capacity, s.allowed_categories,
      lower(regexp_replace(trim(s.code), '[ _-]+', '_', 'g')) as normalized_code
    from public.equipment_slot_definitions s
    where s.campaign_id = v_campaign and s.capacity > 0
  ),
  item_rules as (
    select i.id, d.category,
      coalesce((i.properties->>'two_handed')::boolean,
               (d.default_properties->>'two_handed')::boolean, false) as two_handed
    from public.item_instances i
    join public.inventory_holders h on h.id = i.holder_id
      and h.campaign_id = v_campaign and h.character_id = p_character
      and h.holder_type = 'character'
    join public.item_definitions d on d.id = i.definition_id
    where i.campaign_id = v_campaign
      and i.container_id is null
      and not exists (
        select 1 from public.equipment_assignments a where a.item_instance_id = i.id
      )
  )
  select i.id, s.id
  from item_rules i
  cross join slot_rules s
  where
    (cardinality(s.allowed_categories) = 0 or i.category = any(s.allowed_categories))
    and (
      v_system_code <> 'dnd5e'
      or (
        (
          cardinality(s.allowed_categories) > 0
          or s.normalized_code not in
            ('main_hand','off_hand','head','body','armor','neck','ring','feet')
          or (
            case s.normalized_code
              when 'main_hand' then i.category = any(array['weapon','shield','focus','tool'])
              when 'off_hand' then i.category = any(array['weapon','shield','focus','tool'])
              when 'head' then i.category = any(array['headgear','armor','clothing'])
              when 'body' then i.category = any(array['armor','clothing'])
              when 'armor' then i.category = 'armor'
              when 'neck' then i.category = any(array['jewelry','wondrous'])
              when 'ring' then i.category = any(array['jewelry','ring'])
              when 'feet' then i.category = any(array['footwear','clothing'])
              else true
            end
          )
        )
        and (
          not (s.normalized_code in ('main_hand','off_hand') and i.two_handed)
          or (
            s.normalized_code = 'main_hand'
            and exists (
              select 1 from slot_rules offslot
              where offslot.normalized_code = 'off_hand'
            )
          )
        )
      )
    )
    and app_private.equipment_requirement_failure(
      p_character,i.id,
      array(
        select a.id from public.equipment_assignments a
        join public.equipment_slot_definitions occupied_slot on occupied_slot.id=a.slot_id
        join public.item_instances occupied_item on occupied_item.id=a.item_instance_id
        join public.item_definitions occupied_def on occupied_def.id=occupied_item.definition_id
        where a.character_id=p_character
          and (
            a.slot_id=s.id
            or (v_system_code='dnd5e' and i.two_handed and s.normalized_code='main_hand'
              and lower(regexp_replace(trim(occupied_slot.code),'[ _-]+','_','g'))='off_hand')
            or (v_system_code='dnd5e' and s.normalized_code='off_hand'
              and lower(regexp_replace(trim(occupied_slot.code),'[ _-]+','_','g'))='main_hand'
              and coalesce((occupied_item.properties->>'two_handed')::boolean,(occupied_def.default_properties->>'two_handed')::boolean,false))
          )
      )
    ) is null
  order by i.id, s.id;
end
$function$
;
CREATE OR REPLACE FUNCTION public.save_campaign_item_equip_requirements(p_campaign uuid, p_definition uuid, p_min_attributes jsonb, p_forbidden_categories text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_min jsonb:=coalesce(p_min_attributes,'{}'::jsonb);
 v_categories text[]:=coalesce(p_forbidden_categories,'{}'::text[]);
 v_attr record;v_policy jsonb;
begin
 if not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if not exists(
  select 1 from public.item_definitions d
  where d.id=p_definition and d.campaign_id=p_campaign
    and coalesce(d.source_info->>'import_batch','')=''
    and coalesce(d.code,'') !~* '^srd'
 ) then raise exception 'Choose a campaign-created item' using errcode='22023';end if;
 select rv.configuration->'attributes' into v_policy
 from public.campaigns c join public.ruleset_versions rv on rv.id=c.ruleset_version_id
 where c.id=p_campaign;
 if jsonb_typeof(v_min)<>'object' or (select count(*) from jsonb_object_keys(v_min))>20 then
   raise exception 'Minimum attributes must be a small object' using errcode='22023';end if;
 for v_attr in select key,value from jsonb_each(v_min) loop
   if not coalesce(v_policy ? upper(v_attr.key),false)
     or jsonb_typeof(v_attr.value)<>'number'
     or (v_attr.value #>> '{}') !~ '^[0-9]{1,3}$'
     or (v_attr.value #>> '{}')::integer>100 then
      raise exception 'Invalid minimum attribute requirement: %',v_attr.key using errcode='22023';
   end if;
 end loop;
 if cardinality(v_categories)>20 or exists(
  select 1 from unnest(v_categories) category
  where category is null or category='' or category !~ '^[a-z][a-z0-9_]{0,39}$'
 ) then raise exception 'Invalid forbidden equipment category' using errcode='22023';end if;
 update public.item_definitions d
 set default_properties=
  case when v_min='{}'::jsonb and cardinality(v_categories)=0
    then coalesce(d.default_properties,'{}'::jsonb)-'equip_requirements'
    else jsonb_set(coalesce(d.default_properties,'{}'::jsonb),'{equip_requirements}',
       jsonb_build_object('min_attributes',v_min,
                          'forbidden_equipped_categories',to_jsonb(v_categories)),true)
  end
 where d.id=p_definition and d.campaign_id=p_campaign;
end $function$
;
revoke all on function app_private.equipment_requirement_failure(uuid,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.save_campaign_item_equip_requirements(uuid,uuid,jsonb,text[]) from public,anon;
grant execute on function public.save_campaign_item_equip_requirements(uuid,uuid,jsonb,text[]) to authenticated;
