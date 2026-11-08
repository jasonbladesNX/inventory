-- M7.8 Merchant shops use existing character wallets and inventory definitions.
create table if not exists public.campaign_merchants(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 120),
 description text not null default '',
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.merchant_listings(
 id uuid primary key default gen_random_uuid(),
 merchant_id uuid not null references public.campaign_merchants(id) on delete cascade,
 definition_id uuid not null references public.item_definitions(id),
 currency_id uuid not null references public.currencies(id),
 unit_price numeric not null check(unit_price>=0 and unit_price<=1000000000),
 buyback_price numeric not null default 0 check(buyback_price>=0 and buyback_price<=1000000000),
 quantity integer not null default 0 check(quantity between 0 and 1000000),
 buys_from_players boolean not null default false,
 unique(merchant_id,definition_id,currency_id)
);
alter table public.campaign_merchants enable row level security;
alter table public.merchant_listings enable row level security;
revoke all on public.campaign_merchants,public.merchant_listings from public,anon,authenticated;
create index if not exists merchant_listings_merchant_idx on public.merchant_listings(merchant_id);

create or replace function public.save_campaign_merchant(
 p_campaign uuid,p_name text,p_merchant uuid default null,p_description text default '',p_active boolean default true
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Merchant name must be 2–120 characters' using errcode='22023';end if;
 if p_merchant is null then
   insert into public.campaign_merchants(campaign_id,name,description,active)
   values(p_campaign,trim(p_name),left(coalesce(p_description,''),500),coalesce(p_active,true)) returning id into v_id;
 else
   update public.campaign_merchants set name=trim(p_name),description=left(coalesce(p_description,''),500),active=coalesce(p_active,true)
   where id=p_merchant and campaign_id=p_campaign returning id into v_id;
   if v_id is null then raise exception 'Merchant not in this campaign' using errcode='22023';end if;
 end if;
 return v_id;
end $function$;

create or replace function public.save_merchant_listing(
 p_merchant uuid,p_definition uuid,p_currency uuid,p_price numeric,p_buyback numeric,
 p_quantity integer,p_buys boolean default false
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_id uuid;v_precision integer;
begin
 select m.campaign_id into v_campaign from public.campaign_merchants m where m.id=p_merchant;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if not exists(select 1 from public.item_definitions d join public.campaigns c on c.id=v_campaign
 where d.id=p_definition and (d.campaign_id=v_campaign or (d.campaign_id is null and d.ruleset_version_id=c.ruleset_version_id)))
 then raise exception 'Item definition unavailable in campaign' using errcode='22023';end if;
 select c.precision_digits into v_precision from public.currencies c where c.id=p_currency and c.campaign_id=v_campaign;
 if v_precision is null or v_precision not between 0 and 6 or p_price is null or p_buyback is null or
 p_price<0 or p_price>1000000000 or p_buyback<0 or p_buyback>1000000000 or
 round(p_price,v_precision)<>p_price or round(p_buyback,v_precision)<>p_buyback or
 p_quantity is null or p_quantity not between 0 and 1000000 then
 raise exception 'Invalid price, currency precision, or stock' using errcode='22023';end if;
 insert into public.merchant_listings(merchant_id,definition_id,currency_id,unit_price,buyback_price,quantity,buys_from_players)
 values(p_merchant,p_definition,p_currency,p_price,p_buyback,p_quantity,coalesce(p_buys,false))
 on conflict(merchant_id,definition_id,currency_id) do update set unit_price=excluded.unit_price,
 buyback_price=excluded.buyback_price,quantity=excluded.quantity,buys_from_players=excluded.buys_from_players
 returning id into v_id;
 return v_id;
end $function$;

create or replace function public.list_campaign_merchants(p_campaign uuid)
returns table(id uuid,name text,description text,active boolean)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 and not app_private.is_gm(p_campaign) then raise exception 'Not authorized' using errcode='42501';end if;
 return query select m.id,m.name,m.description,m.active from public.campaign_merchants m
 where m.campaign_id=p_campaign and (m.active or app_private.is_gm(p_campaign)) order by m.name,m.id;
end $function$;

create or replace function public.list_merchant_stock(p_merchant uuid)
returns table(listing_id uuid,definition_id uuid,item_name text,category text,currency_id uuid,currency_code text,
 price numeric,buyback numeric,quantity integer,buys_from_players boolean)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select m.campaign_id into v_campaign from public.campaign_merchants m where m.id=p_merchant and (m.active or app_private.is_gm(m.campaign_id));
 if v_campaign is null then raise exception 'Merchant unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.campaign_members x where x.campaign_id=v_campaign and x.user_id=(select auth.uid()) and x.status='active')
 and not app_private.is_gm(v_campaign) then raise exception 'Not authorized' using errcode='42501';end if;
 return query select l.id,l.definition_id,d.name,d.category,l.currency_id,c.code,
 l.unit_price,l.buyback_price,l.quantity,l.buys_from_players
 from public.merchant_listings l join public.item_definitions d on d.id=l.definition_id
 join public.currencies c on c.id=l.currency_id
 where l.merchant_id=p_merchant order by d.name,c.code;
end $function$;

create or replace function public.trade_with_campaign_merchant(
 p_character uuid,p_listing uuid,p_action text,p_quantity integer default 1,p_item uuid default null
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_merchant uuid;
 v_definition uuid;v_currency uuid;v_price numeric;v_buyback numeric;v_stock integer;v_buys boolean;
 v_wallet uuid;v_balance numeric;v_total numeric;v_holder uuid;v_item public.item_instances%rowtype;
 v_new_item uuid;v_item_name text;v_receipt uuid;v_count integer;
begin
 if v_actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action not in ('buy','sell') or p_quantity is null or p_quantity not between 1 and 500 then
 raise exception 'Choose buy/sell and a quantity between 1 and 500' using errcode='22023';end if;
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=v_actor and m.status='active';
 if v_campaign is null then raise exception 'You cannot trade for this character' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select m.id,l.definition_id,l.currency_id,l.unit_price,l.buyback_price,l.quantity,l.buys_from_players,d.name
 into v_merchant,v_definition,v_currency,v_price,v_buyback,v_stock,v_buys,v_item_name
 from public.merchant_listings l join public.campaign_merchants m on m.id=l.merchant_id
 join public.item_definitions d on d.id=l.definition_id
 where l.id=p_listing and m.campaign_id=v_campaign and m.active for update of l;
 if v_merchant is null then raise exception 'Merchant listing unavailable' using errcode='22023';end if;
 select h.id into v_holder from public.inventory_holders h where h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character' order by h.id limit 1;
 if v_holder is null then raise exception 'Character inventory unavailable' using errcode='22023';end if;
 v_wallet:=app_private.ensure_character_wallet(v_campaign,p_character);
 if p_action='buy' then
   if p_item is not null then raise exception 'Do not supply an inventory item when buying' using errcode='22023';end if;
   if v_stock<p_quantity then raise exception 'Merchant is out of stock' using errcode='22023';end if;
   v_total:=v_price*p_quantity;
   insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_wallet,v_currency,0)
   on conflict(wallet_id,currency_id) do nothing;
   select b.amount into v_balance from public.wallet_balances b where b.wallet_id=v_wallet and b.currency_id=v_currency for update;
   if v_balance<v_total then raise exception 'Insufficient funds' using errcode='22023';end if;
   update public.wallet_balances set amount=amount-v_total where wallet_id=v_wallet and currency_id=v_currency;
   update public.merchant_listings set quantity=quantity-p_quantity where id=p_listing;
   -- Use the existing acquisition routine, preserving stackability and item-instance rules.
   v_new_item:=public.add_inventory_item(v_campaign,p_character,v_definition,p_quantity);
 else
   if not v_buys then raise exception 'Merchant does not buy this item' using errcode='22023';end if;
   if p_item is null then raise exception 'Select an item from inventory to sell' using errcode='22023';end if;
   select i.* into v_item from public.item_instances i where i.id=p_item and i.holder_id=v_holder and i.campaign_id=v_campaign for update;
   if not found or v_item.definition_id<>v_definition or v_item.quantity<p_quantity or v_item.quantity<>trunc(v_item.quantity) then
     raise exception 'Item or quantity unavailable for sale' using errcode='22023';end if;
   if v_item.container_id is not null or not v_item.identified or v_item.condition_code<>'normal' or v_item.custom_name is not null
     or v_item.properties<>'{}'::jsonb or v_item.private_properties<>'{}'::jsonb
     or exists(select 1 from public.equipment_assignments a where a.item_instance_id=p_item)
     or exists(select 1 from public.item_instances nested where nested.container_id=p_item)
   then raise exception 'Only identified, unequipped, unmodified, non-container items can be sold' using errcode='22023';end if;
   if v_stock+p_quantity>1000000 then raise exception 'Merchant stock limit exceeded' using errcode='22023';end if;
   v_total:=v_buyback*p_quantity;
   if v_item.quantity=p_quantity then
     delete from public.item_instances where id=p_item;
   else
     update public.item_instances set quantity=quantity-p_quantity,version=version+1 where id=p_item;
   end if;
   update public.merchant_listings set quantity=quantity+p_quantity where id=p_listing;
   insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_wallet,v_currency,v_total)
   on conflict(wallet_id,currency_id) do update set amount=public.wallet_balances.amount+excluded.amount;
 end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_merchant_trade',jsonb_build_object(
 'character_id',p_character,'merchant_id',v_merchant,'listing_id',p_listing,'operation',p_action,
 'item_name',v_item_name,'item_id',case when p_action='buy' then v_new_item else p_item end,
 'currency_id',v_currency,'unit_price',case when p_action='buy' then v_price else v_buyback end,
 'amount',v_total,'quantity',p_quantity)) returning id into v_receipt;
 return jsonb_build_object('transaction_id',v_receipt,'operation',p_action,'quantity',p_quantity,
 'item_name',v_item_name,'amount',v_total,'currency_id',v_currency);
end $function$;

create or replace function public.list_character_merchant_history(p_character uuid,p_limit integer default 30)
returns table(id uuid,merchant_name text,item_name text,operation text,quantity numeric,currency_code text,amount numeric,occurred_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select t.id,coalesce(m.name,'Merchant'),t.details->>'item_name',t.details->>'operation',
 (t.details->>'quantity')::numeric,coalesce(c.code,'—'),(t.details->>'amount')::numeric,t.occurred_at
 from public.inventory_transactions t left join public.campaign_merchants m on m.id=(t.details->>'merchant_id')::uuid
 left join public.currencies c on c.id=(t.details->>'currency_id')::uuid
 where t.campaign_id=v_campaign and t.kind='character_merchant_trade' and t.status='active'
 and t.details->>'character_id'=p_character::text
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,30),100));
end $function$;

revoke all on function public.save_campaign_merchant(uuid,text,uuid,text,boolean) from public,anon;
revoke all on function public.save_merchant_listing(uuid,uuid,uuid,numeric,numeric,integer,boolean) from public,anon;
revoke all on function public.list_campaign_merchants(uuid) from public,anon;
revoke all on function public.list_merchant_stock(uuid) from public,anon;
revoke all on function public.trade_with_campaign_merchant(uuid,uuid,text,integer,uuid) from public,anon;
revoke all on function public.list_character_merchant_history(uuid,integer) from public,anon;
grant execute on function public.save_campaign_merchant(uuid,text,uuid,text,boolean) to authenticated;
grant execute on function public.save_merchant_listing(uuid,uuid,uuid,numeric,numeric,integer,boolean) to authenticated;
grant execute on function public.list_campaign_merchants(uuid) to authenticated;
grant execute on function public.list_merchant_stock(uuid) to authenticated;
grant execute on function public.trade_with_campaign_merchant(uuid,uuid,text,integer,uuid) to authenticated;
grant execute on function public.list_character_merchant_history(uuid,integer) to authenticated;
