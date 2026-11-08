create or replace function public.list_campaign_shop_item_definitions(p_campaign uuid)
returns table(id uuid,name text,category text)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_ruleset uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM required' using errcode='42501';end if;
 select c.ruleset_version_id into v_ruleset from public.campaigns c where c.id=p_campaign;
 if not found then raise exception 'Campaign unavailable' using errcode='22023';end if;
 return query select d.id,d.name,d.category from public.item_definitions d
 where d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=v_ruleset)
 order by d.name,d.id;
end $function$;
revoke all on function public.list_campaign_shop_item_definitions(uuid) from public,anon;
grant execute on function public.list_campaign_shop_item_definitions(uuid) to authenticated;