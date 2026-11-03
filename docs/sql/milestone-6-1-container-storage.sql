-- Nexus Multiverse Milestone 6.1: one-level backpack and pouch storage.
-- Applied in Supabase project fvapsdirjgknxpqlxljx on 2026-11-02.
-- Existing DB includes tables: containers, item_instances, inventory_holders.
-- Do not run on an empty schema. Review existing database migrations first.
-- Container instances are linked through properties.source_item_id (UUID string).
-- No nested containers or capacity enforcement in this milestone.

create unique index if not exists containers_source_item_unique
  on public.containers ((properties->>'source_item_id'))
  where properties ? 'source_item_id';

CREATE OR REPLACE FUNCTION public.list_character_storage(p_character uuid)
 RETURNS TABLE(item_id uuid, container_item_id uuid, is_container boolean, location_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active;
 if v_campaign is null or not (
   app_private.is_gm(v_campaign) or exists(
     select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
     where c.id=p_character and c.campaign_id=v_campaign and c.is_active and m.user_id=(select auth.uid()) and m.status='active'
   )
 ) then raise exception 'Not authorized' using errcode='42501'; end if;

 return query
 select i.id,
   owner_item.id,
   (i.identified and (d.category='container' or d.code='srd521_pouch')) as is_container,
   case when i.container_id is null then 'Carried'::text
        when owner_item.id is not null then
          case when owner_item.identified then coalesce(nullif(owner_item.custom_name,''),owner_def.name)
          else 'Unidentified Container'::text end
        else 'Stored'::text end
 from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=v_campaign and h.character_id=p_character and h.holder_type='character'
 join public.item_definitions d on d.id=i.definition_id
 left join public.containers box on box.id=i.container_id and box.holder_id=i.holder_id and box.campaign_id=v_campaign
 left join public.item_instances owner_item on owner_item.id=(box.properties->>'source_item_id')::uuid and owner_item.holder_id=i.holder_id and owner_item.campaign_id=v_campaign
 left join public.item_definitions owner_def on owner_def.id=owner_item.definition_id
 where i.campaign_id=v_campaign
 order by i.id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.move_character_item_storage(p_character uuid, p_item uuid, p_container_item uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid; v_holder uuid; v_current uuid; v_box uuid; v_item_category text;
v_destination_category text; v_destination_code text; v_destination_name text;
begin
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active for update;
 if v_campaign is null or not (
   app_private.is_gm(v_campaign) or exists(
     select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
     where c.id=p_character and c.campaign_id=v_campaign and c.is_active and m.user_id=(select auth.uid()) and m.status='active'
   )
 ) then raise exception 'Not authorized' using errcode='42501'; end if;

 select i.holder_id,i.container_id,d.category into v_holder,v_current,v_item_category
 from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id and h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character'
 join public.item_definitions d on d.id=i.definition_id
 where i.id=p_item and i.campaign_id=v_campaign
 for update of i;
 if v_holder is null then raise exception 'Item is not owned by this character' using errcode='42501';end if;
 if v_item_category='container' or exists(
   select 1 from public.item_instances i join public.item_definitions d on d.id=i.definition_id
   where i.id=p_item and d.code='srd521_pouch'
 ) then raise exception 'Moving containers into other containers is not enabled';end if;
 if exists (select 1 from public.equipment_assignments a where a.item_instance_id=p_item)
 then raise exception 'Unequip the item before storing it';end if;

 if p_container_item is null then
   if v_current is null then raise exception 'Item is already carried';end if;
   if not exists(
     select 1 from public.containers box where box.id=v_current and box.campaign_id=v_campaign and box.holder_id=v_holder
     and box.properties ? 'source_item_id'
   ) then raise exception 'This storage location cannot be managed here';end if;
   update public.item_instances set container_id=null,version=version+1 where id=p_item;
 else
   if p_container_item=p_item then raise exception 'Cannot store a container inside itself';end if;
   select d.category,d.code,
       case when ci.identified then coalesce(nullif(ci.custom_name,''),d.name) else 'Unidentified Container' end
     into v_destination_category,v_destination_code,v_destination_name
   from public.item_instances ci
   join public.item_definitions d on d.id=ci.definition_id
   where ci.id=p_container_item and ci.campaign_id=v_campaign and ci.holder_id=v_holder
     and ci.container_id is null
   for update of ci;
   if v_destination_category is null or not(v_destination_category='container' or v_destination_code='srd521_pouch') then
     raise exception 'Destination is not a carried backpack or pouch owned by this character';end if;
   select box.id into v_box from public.containers box
   where box.campaign_id=v_campaign and box.holder_id=v_holder and box.properties->>'source_item_id'=p_container_item::text;
   if v_box is null then
     insert into public.containers(campaign_id,holder_id,name,properties)
       values(v_campaign,v_holder,v_destination_name,jsonb_build_object('source_item_id',p_container_item))
       returning id into v_box;
   end if;
   if v_current is not distinct from v_box then raise exception 'Item is already in that container';end if;
   update public.item_instances set container_id=v_box,version=version+1 where id=p_item;
 end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,(select auth.uid()),'container_move',
 jsonb_build_object('item_id',p_item,'from_container_id',v_current,'to_container_id',v_box));
end
$function$
;

-- Existing equip function with the new guard against equipping stored items.
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

revoke all on function public.list_character_storage(uuid) from public, anon;
revoke all on function public.move_character_item_storage(uuid,uuid,uuid) from public, anon;
grant execute on function public.list_character_storage(uuid) to authenticated;
grant execute on function public.move_character_item_storage(uuid,uuid,uuid) to authenticated;
