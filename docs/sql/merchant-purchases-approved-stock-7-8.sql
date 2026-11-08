CREATE OR REPLACE FUNCTION public.trade_with_campaign_merchant(p_character uuid, p_listing uuid, p_action text, p_quantity integer DEFAULT 1, p_item uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_merchant uuid;
 v_definition uuid;v_currency uuid;v_price numeric;v_buyback numeric;v_stock integer;v_buys boolean;
 v_wallet uuid;v_balance numeric;v_total numeric;v_holder uuid;v_item public.item_instances%rowtype;
 v_new_item uuid;v_item_name text;v_receipt uuid;v_count integer;v_index integer;
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
   if app_private.item_can_auto_stack(v_definition) then
     insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
     values(v_campaign,v_definition,v_holder,p_quantity) returning id into v_new_item;
     v_new_item:=app_private.consolidate_item_location(v_new_item);
   else
     for v_index in 1..p_quantity loop
       insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
       values(v_campaign,v_definition,v_holder,1) returning id into v_new_item;
     end loop;
   end if;
   insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
   values(v_campaign,v_actor,'acquisition',
    jsonb_build_object('item_id',v_new_item,'quantity',p_quantity,'character_id',p_character,'source','merchant','merchant_id',v_merchant));
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
