-- Nexus Multiverse 6.4: read-only known weight summary.
-- Counts owned item instances once, including nested storage by container_id.
-- Unknown weight rows are counted separately, never assumed to weigh zero.
-- No character STR rules/encumbrance movement penalties are implemented here.

CREATE OR REPLACE FUNCTION public.get_character_inventory_weight(p_character uuid)
 RETURNS TABLE(known_weight_lb numeric, carried_weight_lb numeric, stored_weight_lb numeric, unknown_item_count bigint, item_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active;
 if v_campaign is null or not(
  app_private.is_gm(v_campaign) or exists(
   select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=v_campaign and c.is_active
    and m.user_id=(select auth.uid()) and m.status='active'
  )
 ) then raise exception 'Not authorized' using errcode='42501';end if;
 return query
 with weights as (
  select i.id,i.container_id,i.quantity,
    coalesce(i.properties->>'weight',d.default_properties->>'weight') as weight_text
  from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id and h.character_id=p_character
     and h.campaign_id=v_campaign and h.holder_type='character'
  join public.item_definitions d on d.id=i.definition_id
  where i.campaign_id=v_campaign
 )
 select
  coalesce(sum(case when w.weight_text ~ '^[0-9]+([.][0-9]+)?$' then w.weight_text::numeric*w.quantity else 0 end),0)::numeric,
  coalesce(sum(case when w.container_id is null and w.weight_text ~ '^[0-9]+([.][0-9]+)?$' then w.weight_text::numeric*w.quantity else 0 end),0)::numeric,
  coalesce(sum(case when w.container_id is not null and w.weight_text ~ '^[0-9]+([.][0-9]+)?$' then w.weight_text::numeric*w.quantity else 0 end),0)::numeric,
  count(*) filter(where w.weight_text is null or w.weight_text !~ '^[0-9]+([.][0-9]+)?$')::bigint,
  count(*)::bigint
 from weights w;
end $function$
;

revoke all on function public.get_character_inventory_weight(uuid) from public,anon;
grant execute on function public.get_character_inventory_weight(uuid) to authenticated;
