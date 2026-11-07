-- Nexus Multiverse 6.24–6.27: individual, per-user bookmarks and safe inventory indicators.
-- No modifications to item ownership, quantities, container assignments, or equip RPCs.
create table if not exists app_private.character_item_favorites (
 user_id uuid not null,
 character_id uuid not null references public.characters(id) on delete cascade,
 item_id uuid not null references public.item_instances(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (user_id,character_id,item_id)
);
revoke all on table app_private.character_item_favorites from public,anon,authenticated;
alter table app_private.character_item_favorites enable row level security;

CREATE OR REPLACE FUNCTION public.list_my_character_item_favorites(p_character uuid)
 RETURNS TABLE(item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 return query
 select f.item_id
 from app_private.character_item_favorites f
 join public.item_instances i on i.id=f.item_id
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 where f.user_id=(select auth.uid()) and f.character_id=p_character
   and h.character_id=p_character and h.holder_type='character'
 order by f.created_at,f.item_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_my_character_item_favorite(p_character uuid, p_item uuid, p_favorite boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());
begin
 if v_actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform 1 from public.list_character_attributes(p_character) limit 1;
 if not exists(
  select 1 from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
  join public.characters c on c.id=p_character and c.campaign_id=i.campaign_id and c.is_active
  where i.id=p_item and h.character_id=p_character and h.holder_type='character'
 ) then raise exception 'Item not accessible for selected character' using errcode='42501';end if;
 if p_favorite is null then raise exception 'Favorite must be true or false' using errcode='22023';end if;
 if p_favorite then
  insert into app_private.character_item_favorites(user_id,character_id,item_id)
  values (v_actor,p_character,p_item) on conflict do nothing;
 else
  delete from app_private.character_item_favorites f
  where f.user_id=v_actor and f.character_id=p_character and f.item_id=p_item;
 end if;
 return p_favorite;
end $function$
;
CREATE OR REPLACE FUNCTION public.list_character_inventory_indicators(p_character uuid)
 RETURNS TABLE(item_id uuid, condition_code text, identified boolean, unit_weight_lb numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 return query
 select i.id,i.condition_code,i.identified,
  case when i.identified and coalesce(i.properties->>'weight',d.default_properties->>'weight') ~ '^[0-9]+([.][0-9]+)?$'
    then (coalesce(i.properties->>'weight',d.default_properties->>'weight'))::numeric
    else null::numeric end
 from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 join public.item_definitions d on d.id=i.definition_id
 join public.characters c on c.id=p_character and c.campaign_id=i.campaign_id and c.is_active
 where h.character_id=p_character and h.holder_type='character'
 order by i.id;
end $function$
;

revoke all on function public.list_my_character_item_favorites(uuid) from public,anon;
revoke all on function public.set_my_character_item_favorite(uuid,uuid,boolean) from public,anon;
revoke all on function public.list_character_inventory_indicators(uuid) from public,anon;
grant execute on function public.list_my_character_item_favorites(uuid) to authenticated;
grant execute on function public.set_my_character_item_favorite(uuid,uuid,boolean) to authenticated;
grant execute on function public.list_character_inventory_indicators(uuid) to authenticated;
