-- QR loot currency denominations are granted with items in the same atomic claim.
create table if not exists public.qr_loot_currency(
 source_id uuid not null references public.loot_sources(id) on delete cascade,
 currency_id uuid not null references public.currencies(id),
 amount numeric not null check(amount>0 and amount<=1000000000),
 primary key(source_id,currency_id)
);
alter table public.qr_loot_currency enable row level security;
revoke all on public.qr_loot_currency from public,anon,authenticated;

create or replace function public.set_qr_loot_currency(p_source uuid,p_currency uuid,p_amount numeric)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_active boolean;v_precision integer;
begin
 select l.campaign_id,l.is_active into v_campaign,v_active
 from public.loot_sources l where l.id=p_source for update;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then
 raise exception 'GM required' using errcode='42501';end if;
 if not v_active or exists(select 1 from public.loot_claims where loot_source_id=p_source and status='completed')
 then raise exception 'Container already claimed or inactive' using errcode='22023';end if;
 select c.precision_digits into v_precision from public.currencies c where c.id=p_currency and c.campaign_id=v_campaign;
 if v_precision is null or v_precision not between 0 and 6 then raise exception 'Invalid campaign currency' using errcode='22023';end if;
 if p_amount is null or p_amount<0 or p_amount>1000000000 or round(p_amount,v_precision)<>p_amount then
 raise exception 'Invalid amount or currency precision' using errcode='22023';end if;
 if p_amount=0 then
   delete from public.qr_loot_currency where source_id=p_source and currency_id=p_currency;
 else
   insert into public.qr_loot_currency(source_id,currency_id,amount) values(p_source,p_currency,p_amount)
   on conflict(source_id,currency_id) do update set amount=excluded.amount;
 end if;
 return true;
end $function$;

create or replace function public.list_gm_qr_loot_currency(p_source uuid)
returns table(currency_id uuid,code text,name text,amount numeric,precision_digits smallint)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select l.campaign_id into v_campaign from public.loot_sources l where l.id=p_source;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then
 raise exception 'GM required' using errcode='42501';end if;
 return query select c.id,c.code,c.name,q.amount,c.precision_digits
 from public.qr_loot_currency q join public.currencies c on c.id=q.currency_id
 where q.source_id=p_source and c.campaign_id=v_campaign order by c.code;
end $function$;
revoke all on function public.set_qr_loot_currency(uuid,uuid,numeric) from public,anon;
revoke all on function public.list_gm_qr_loot_currency(uuid) from public,anon;
grant execute on function public.set_qr_loot_currency(uuid,uuid,numeric) to authenticated;
grant execute on function public.list_gm_qr_loot_currency(uuid) to authenticated;
