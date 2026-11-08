create or replace function public.list_campaign_currency_definitions(p_campaign uuid)
returns table(id uuid,code text,name text,base_factor numeric,precision_digits smallint,is_base boolean)
language sql stable security definer set search_path to ''
as $function$
select c.id,c.code,c.name,c.base_factor,c.precision_digits,c.is_base
from public.currencies c
where c.campaign_id=p_campaign and exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
order by c.base_factor desc,c.code
$function$;
revoke all on function public.list_campaign_currency_definitions(uuid) from public,anon;
grant execute on function public.list_campaign_currency_definitions(uuid) to authenticated;