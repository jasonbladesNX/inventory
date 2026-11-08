-- Milestone 7.7: campaign currency wallet operations and audit.
-- Retain existing wallets, wallet_balances and currencies. Serialize balance mutations per campaign.
create or replace function app_private.ensure_character_wallet(p_campaign uuid,p_character uuid)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_holder uuid;v_wallet uuid;
begin
 select h.id into v_holder from public.inventory_holders h
 where h.campaign_id=p_campaign and h.character_id=p_character and h.holder_type='character'
 order by h.id limit 1;
 if v_holder is null then raise exception 'Character inventory holder not found' using errcode='22023';end if;
 insert into public.wallets(campaign_id,holder_id) values(p_campaign,v_holder)
 on conflict(campaign_id,holder_id) do update set holder_id=excluded.holder_id returning id into v_wallet;
 return v_wallet;
end $function$;
revoke all on function app_private.ensure_character_wallet(uuid,uuid) from public,anon,authenticated;

create or replace function public.transfer_character_currency(
 p_from uuid,p_to uuid,p_currency uuid,p_amount numeric
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid:=(select auth.uid());v_campaign uuid;v_target_campaign uuid;
v_from_wallet uuid;v_to_wallet uuid;v_precision integer;v_before numeric;v_target_name text;
begin
 if v_user is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from=p_to then raise exception 'Select another character' using errcode='22023';end if;
 if p_amount is null or p_amount<=0 or p_amount>1000000000 then raise exception 'Enter a positive amount' using errcode='22023';end if;
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_from and ch.is_active and m.user_id=v_user and m.status='active';
 if v_campaign is null then raise exception 'You cannot send funds from this character' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select ch.campaign_id,ch.name into v_target_campaign,v_target_name from public.characters ch
 join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_to and ch.is_active and m.status='active' limit 1;
 if v_target_campaign is distinct from v_campaign then raise exception 'Recipient must be active in the same campaign' using errcode='22023';end if;
 select c.precision_digits into v_precision from public.currencies c where c.id=p_currency and c.campaign_id=v_campaign;
 if not found then raise exception 'Currency is not in this campaign' using errcode='22023';end if;
 if v_precision not between 0 and 6 or round(p_amount,v_precision)<>p_amount then raise exception 'Invalid currency precision' using errcode='22023';end if;
 v_from_wallet:=app_private.ensure_character_wallet(v_campaign,p_from);
 v_to_wallet:=app_private.ensure_character_wallet(v_campaign,p_to);
 insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_from_wallet,p_currency,0)
 on conflict(wallet_id,currency_id) do nothing;
 select b.amount into v_before from public.wallet_balances b where b.wallet_id=v_from_wallet and b.currency_id=p_currency for update;
 if v_before<p_amount then raise exception 'Insufficient funds' using errcode='22023';end if;
 update public.wallet_balances b set amount=b.amount-p_amount where b.wallet_id=v_from_wallet and b.currency_id=p_currency;
 insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_to_wallet,p_currency,p_amount)
 on conflict(wallet_id,currency_id) do update set amount=public.wallet_balances.amount+excluded.amount;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_user,'character_currency_transfer',
 jsonb_build_object('character_id',p_from,'from_character',p_from,'to_character',p_to,
 'recipient_name',v_target_name,'currency_id',p_currency,'quantity',p_amount,'amount',p_amount))
 ;
 return jsonb_build_object('sent',p_amount,'currency_id',p_currency,'remaining',v_before-p_amount,'recipient',v_target_name);
end $function$;

create or replace function public.exchange_character_currency(
 p_character uuid,p_from_currency uuid,p_to_currency uuid,p_amount numeric
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid:=(select auth.uid());v_campaign uuid;v_wallet uuid;
v_source_factor numeric;v_target_factor numeric;v_precision integer;v_source_precision integer;
v_output numeric;v_before numeric;
begin
 if v_user is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_from_currency=p_to_currency then raise exception 'Select two different denominations' using errcode='22023';end if;
 if p_amount is null or p_amount<=0 or p_amount>1000000000 then raise exception 'Enter a positive amount' using errcode='22023';end if;
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=v_user and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select c.base_factor,c.precision_digits into v_source_factor,v_source_precision from public.currencies c where c.id=p_from_currency and c.campaign_id=v_campaign;
 if not found then raise exception 'Source denomination unavailable' using errcode='22023';end if;
 select c.base_factor,c.precision_digits into v_target_factor,v_precision from public.currencies c where c.id=p_to_currency and c.campaign_id=v_campaign;
 if not found then raise exception 'Target denomination unavailable' using errcode='22023';end if;
 if v_source_precision not between 0 and 6 or v_precision not between 0 and 6 or round(p_amount,v_source_precision)<>p_amount
 then raise exception 'Invalid currency precision' using errcode='22023';end if;
 v_output:=p_amount*v_source_factor/v_target_factor;
 if v_output<=0 or round(v_output,v_precision)<>v_output then
 raise exception 'Exchange would require a fractional denomination; choose an exact convertible amount' using errcode='22023';end if;
 v_wallet:=app_private.ensure_character_wallet(v_campaign,p_character);
 insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_wallet,p_from_currency,0) on conflict(wallet_id,currency_id) do nothing;
 select amount into v_before from public.wallet_balances where wallet_id=v_wallet and currency_id=p_from_currency for update;
 if v_before<p_amount then raise exception 'Insufficient funds' using errcode='22023';end if;
 update public.wallet_balances set amount=amount-p_amount where wallet_id=v_wallet and currency_id=p_from_currency;
 insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_wallet,p_to_currency,v_output)
 on conflict(wallet_id,currency_id) do update set amount=public.wallet_balances.amount+excluded.amount;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_user,'character_currency_exchange',
 jsonb_build_object('character_id',p_character,'from_currency',p_from_currency,'to_currency',p_to_currency,'amount',p_amount,'received',v_output,'quantity',p_amount));
 return jsonb_build_object('spent',p_amount,'received',v_output,'remaining',v_before-p_amount);
end $function$;

create or replace function public.list_character_currency_history(p_character uuid,p_limit integer default 40)
returns table(event_id uuid,operation text,currency_code text,amount numeric,other_character text,occurred_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;v_user uuid:=(select auth.uid());
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=v_user and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query
 select t.id,
 case when t.kind='character_currency_exchange' then 'Exchange'
 when t.details->>'from_character'=p_character::text then 'Sent'
 else 'Received' end::text,
 coalesce(c.code,'—')::text,
 (t.details->>'amount')::numeric,
 case when t.kind='character_currency_transfer' then
 (select ch.name from public.characters ch where ch.id=
 case when t.details->>'from_character'=p_character::text then (t.details->>'to_character')::uuid else (t.details->>'from_character')::uuid end)
 else coalesce(d.code,'—') end::text,
 t.occurred_at
 from public.inventory_transactions t
 left join public.currencies c on c.id=
 case when t.kind='character_currency_exchange' then (t.details->>'from_currency')::uuid else (t.details->>'currency_id')::uuid end
 left join public.currencies d on d.id=(case when t.kind='character_currency_exchange' then (t.details->>'to_currency')::uuid else null::uuid end)
 where t.campaign_id=v_campaign and t.status='active'
 and t.kind in ('character_currency_transfer','character_currency_exchange')
 and (t.details->>'character_id'=p_character::text or t.details->>'to_character'=p_character::text)
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,40),100));
end $function$;

create or replace function public.upsert_campaign_currency(
 p_campaign uuid,p_code text,p_name text,p_factor numeric,p_precision smallint default 0
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;v_code text:=upper(trim(coalesce(p_code,'')));
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if v_code !~ '^[A-Z][A-Z0-9]{0,7}$' or length(trim(coalesce(p_name,''))) not between 2 and 60
 or p_factor is null or p_factor<=0 or p_factor>1000000000 or p_precision not between 0 and 6
 then raise exception 'Invalid denomination settings' using errcode='22023';end if;
 insert into public.currencies(campaign_id,code,name,base_factor,precision_digits,is_base)
 values(p_campaign,v_code,trim(p_name),p_factor,p_precision,false)
 on conflict(campaign_id,code) do update set name=excluded.name,base_factor=excluded.base_factor,precision_digits=excluded.precision_digits
 returning id into v_id;
 return v_id;
end $function$;

revoke all on function public.transfer_character_currency(uuid,uuid,uuid,numeric) from public,anon;
revoke all on function public.exchange_character_currency(uuid,uuid,uuid,numeric) from public,anon;
revoke all on function public.list_character_currency_history(uuid,integer) from public,anon;
revoke all on function public.upsert_campaign_currency(uuid,text,text,numeric,smallint) from public,anon;
grant execute on function public.transfer_character_currency(uuid,uuid,uuid,numeric) to authenticated;
grant execute on function public.exchange_character_currency(uuid,uuid,uuid,numeric) to authenticated;
grant execute on function public.list_character_currency_history(uuid,integer) to authenticated;
grant execute on function public.upsert_campaign_currency(uuid,text,text,numeric,smallint) to authenticated;
