CREATE OR REPLACE FUNCTION public.list_character_currency_history(p_character uuid, p_limit integer DEFAULT 40)
 RETURNS TABLE(event_id uuid, operation text, currency_code text, amount numeric, other_character text, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;v_user uuid:=(select auth.uid());
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=v_user and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query
 select t.id,
 case when t.kind='character_currency_adjustment' then 'GM Adjustment'
 when t.kind='character_currency_exchange' then 'Exchange'
 when t.details->>'from_character'=p_character::text then 'Sent'
 else 'Received' end::text,
 coalesce(c.code,'—')::text,
 (t.details->>'amount')::numeric,
 case when t.kind='character_currency_transfer' then
 (select ch.name from public.characters ch where ch.id=
 case when t.details->>'from_character'=p_character::text then (t.details->>'to_character')::uuid else (t.details->>'from_character')::uuid end)
 else case when t.kind='character_currency_adjustment' then null else coalesce(d.code,'—') end end::text,
 t.occurred_at
 from public.inventory_transactions t
 left join public.currencies c on c.id=
 case when t.kind='character_currency_exchange' then (t.details->>'from_currency')::uuid else (t.details->>'currency_id')::uuid end
 left join public.currencies d on d.id=(case when t.kind='character_currency_exchange' then (t.details->>'to_currency')::uuid else null::uuid end)
 where t.campaign_id=v_campaign and t.status='active'
 and t.kind in ('character_currency_transfer','character_currency_exchange','character_currency_adjustment')
 and (t.details->>'character_id'=p_character::text or t.details->>'to_character'=p_character::text)
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,40),100));
end $function$;
