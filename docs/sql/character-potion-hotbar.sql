-- Persistent character potion hotbar; selections refer to definition types, not stack IDs.
-- This survives stack merging and depletion. No inventory is consumed by assigning a slot.
create or replace function public.get_character_potion_hotbar(p_character uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid; v_config jsonb; v_slots jsonb; v_options jsonb;
begin
  select c.campaign_id,c.sheet_data->'potion_hotbar' into v_campaign,v_config
  from public.characters c where c.id=p_character and c.is_active;
  if v_campaign is null or not (
    app_private.is_gm(v_campaign) or exists (
      select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
      where c.id=p_character and c.campaign_id=v_campaign and c.is_active
      and m.user_id=(select auth.uid()) and m.status='active'
    )
  ) then raise exception 'Not authorized' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot',s.slot,
    'definition_id',d.id,
    'name',d.name
  ) order by s.slot),'[]'::jsonb)
  into v_slots
  from generate_series(1,4) as s(slot)
  left join public.item_definitions d
    on d.id=case when (v_config->>(s.slot::text)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (v_config->>(s.slot::text))::uuid else null::uuid end
    and d.campaign_id=v_campaign and d.category='consumable'
    and d.name ilike '%potion%';

  select coalesce(jsonb_agg(to_jsonb(q) order by q.name),'[]'::jsonb)
  into v_options
  from (
    select d.id as definition_id,d.name,sum(i.quantity)::integer as quantity,
           (array_agg(i.id order by i.id))[1] as item_id
    from public.list_character_usable_items(p_character) u
    join public.item_instances i on i.id=u.item_id and i.campaign_id=v_campaign
    join public.item_definitions d on d.id=i.definition_id
      and d.campaign_id=v_campaign and d.category='consumable' and d.name ilike '%potion%'
    group by d.id,d.name
  ) q;
  return jsonb_build_object('slots',v_slots,'options',v_options);
end $function$;

create or replace function public.set_character_potion_hotbar_slot(
  p_character uuid,p_slot integer,p_definition uuid
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid; v_current jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_slot is null or p_slot not between 1 and 4 then
    raise exception 'Potion slot must be between 1 and 4' using errcode='22023';
  end if;
  select c.campaign_id into v_campaign from public.characters c
  where c.id=p_character and c.is_active for update;
  if v_campaign is null or not (
    app_private.is_gm(v_campaign) or exists (
      select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
      where c.id=p_character and c.campaign_id=v_campaign and c.is_active
      and m.user_id=(select auth.uid()) and m.status='active'
    )
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_definition is not null and not exists (
    select 1 from public.item_definitions d
    where d.id=p_definition and d.campaign_id=v_campaign
      and d.category='consumable' and d.name ilike '%potion%'
      and exists (
        select 1 from public.list_character_usable_items(p_character) u
        join public.item_instances i on i.id=u.item_id
        where i.definition_id=d.id and i.campaign_id=v_campaign
      )
  ) then raise exception 'Only potion types present in this character inventory can be assigned'
    using errcode='22023'; end if;
  select coalesce(c.sheet_data->'potion_hotbar','{}'::jsonb)
  into v_current from public.characters c where c.id=p_character;
  v_current=case when p_definition is null
    then v_current-(p_slot::text)
    else jsonb_set(v_current,array[p_slot::text],to_jsonb(p_definition::text),true) end;
  update public.characters c set sheet_data=
    jsonb_set(coalesce(c.sheet_data,'{}'::jsonb),'{potion_hotbar}',v_current,true)
    where c.id=p_character;
  return public.get_character_potion_hotbar(p_character);
end $function$;

revoke all on function public.get_character_potion_hotbar(uuid) from public,anon;
revoke all on function public.set_character_potion_hotbar_slot(uuid,integer,uuid) from public,anon;
grant execute on function public.get_character_potion_hotbar(uuid) to authenticated;
grant execute on function public.set_character_potion_hotbar_slot(uuid,integer,uuid) to authenticated;
