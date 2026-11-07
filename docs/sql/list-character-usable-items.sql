-- Return only item IDs eligible for one-click use by this authorized character.
-- Mirrors the consumption RPC's category, instance, and equipment safeguards.
create or replace function public.list_character_usable_items(p_character uuid)
returns table(item_id uuid)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
  select c.campaign_id into v_campaign from public.characters c
  where c.id=p_character and c.is_active;
  if v_campaign is null or not (
    app_private.is_gm(v_campaign) or exists (
      select 1 from public.characters c
      join public.campaign_members m on m.id=c.member_id
      where c.id=p_character and c.campaign_id=v_campaign and c.is_active
        and m.user_id=(select auth.uid()) and m.status='active'
    )
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  return query
  select i.id from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id
    and h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character'
  join public.item_definitions d on d.id=i.definition_id
  where i.campaign_id=v_campaign and i.identified and i.quantity >= 1
    and (d.category in ('consumable','ammunition') or d.default_properties->>'consumable'='true')
    and coalesce(d.default_properties->>'consumable','true') <> 'false'
    and coalesce(i.properties->>'consumable','true') <> 'false'
    and coalesce(d.default_properties->>'unique','false') <> 'true'
    and coalesce(d.default_properties->>'equippable','false') <> 'true'
    and app_private.item_can_auto_stack(i.definition_id)
    and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
    and not exists(select 1 from public.item_effects e where e.item_instance_id=i.id)
    and not exists(select 1 from public.containers b where b.properties->>'source_item_id'=i.id::text);
end
$function$;
revoke all on function public.list_character_usable_items(uuid) from public,anon;
grant execute on function public.list_character_usable_items(uuid) to authenticated;
