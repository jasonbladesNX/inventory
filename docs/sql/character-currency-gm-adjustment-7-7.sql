-- GM wallet balance adjustments, logged and serialized for campaign integrity.
create or replace function public.adjust_campaign_character_currency(
 p_campaign uuid,p_character uuid,p_currency uuid,p_delta numeric,p_reason text default ''
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid:=(select auth.uid());v_wallet uuid;v_precision integer;v_balance numeric;
begin
 if v_user is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if p_delta is null or p_delta=0 or abs(p_delta)>1000000000 then raise exception 'Enter a nonzero balance adjustment' using errcode='22023';end if;
 if not exists(select 1 from public.characters c where c.id=p_character and c.campaign_id=p_campaign and c.is_active) then
 raise exception 'Character not in this campaign' using errcode='22023';end if;
 select c.precision_digits into v_precision from public.currencies c where c.campaign_id=p_campaign and c.id=p_currency;
 if not found or v_precision not between 0 and 6 or round(p_delta,v_precision)<>p_delta then raise exception 'Invalid currency or precision' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_campaign::text));
 v_wallet:=app_private.ensure_character_wallet(p_campaign,p_character);
 insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_wallet,p_currency,0) on conflict(wallet_id,currency_id) do nothing;
 select b.amount into v_balance from public.wallet_balances b where b.wallet_id=v_wallet and b.currency_id=p_currency for update;
 if v_balance+p_delta<0 then raise exception 'Insufficient funds for a deduction' using errcode='22023';end if;
 update public.wallet_balances b set amount=b.amount+p_delta where b.wallet_id=v_wallet and b.currency_id=p_currency;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,note,details)
 values(p_campaign,v_user,'character_currency_adjustment',left(coalesce(p_reason,''),200),
 jsonb_build_object('character_id',p_character,'currency_id',p_currency,'quantity',abs(p_delta),'amount',p_delta,'previous',v_balance,'new_balance',v_balance+p_delta));
 return jsonb_build_object('new_balance',v_balance+p_delta,'previous',v_balance,'adjustment',p_delta);
end $function$;
revoke all on function public.adjust_campaign_character_currency(uuid,uuid,uuid,numeric,text) from public,anon;
grant execute on function public.adjust_campaign_character_currency(uuid,uuid,uuid,numeric,text) to authenticated;
