CREATE OR REPLACE FUNCTION public.claim_loot_qr(p_token text, p_character uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.interaction_tokens%rowtype; l public.loot_sources%rowtype; dest uuid; source_item record; txn uuid; claim uuid; usr uuid:=auth.uid(); existing int; moved int:=0;
  currency_reward record; v_wallet uuid; v_currency_rewards jsonb:='[]'::jsonb;
begin
 if usr is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid claim'; end if;
 select * into t from public.interaction_tokens where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found or t.action_type<>'loot' or t.revoked_at is not null or (t.expires_at is not null and t.expires_at<=now()) or (t.max_uses is not null and t.use_count>=t.max_uses) then raise exception 'Token unavailable';end if;
 select * into l from public.loot_sources where id=t.loot_source_id for update;
 if not found or not l.is_active or l.campaign_id<>t.campaign_id then raise exception 'Loot unavailable';end if;
 if l.scan_behavior<>'instant' or l.gm_approval_required or l.claim_mode not in ('claim_all','first_claim') then raise exception 'This loot needs the interactive claim workflow';end if;
 select h.id into dest from public.characters c join public.campaign_members m on m.id=c.member_id join public.inventory_holders h on h.character_id=c.id and h.campaign_id=c.campaign_id where c.id=p_character and c.campaign_id=t.campaign_id and c.is_active and m.user_id=usr and m.status='active';
 if dest is null then raise exception 'Character unauthorized';end if;
 select count(*) into existing from public.loot_claims where loot_source_id=l.id and character_id=p_character and status='completed';
 if existing>=l.max_claims_per_character then raise exception 'Already claimed';end if;
 if l.claim_mode='first_claim' and exists(select 1 from public.loot_claims where loot_source_id=l.id and status='completed') then raise exception 'Already claimed';end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details) values(t.campaign_id,usr,'loot_claim',jsonb_build_object('loot_source_id',l.id,'character_id',p_character)) returning id into txn;
 insert into public.loot_claims(campaign_id,loot_source_id,character_id,token_id,status,completed_at,transaction_id) values(t.campaign_id,l.id,p_character,t.id,'completed',now(),txn) returning id into claim;
 for source_item in select * from public.item_instances where campaign_id=t.campaign_id and holder_id=l.holder_id order by id for update loop
   insert into public.transaction_lines(transaction_id,item_instance_id,from_holder_id,to_holder_id,quantity_delta,snapshot) values(txn,source_item.id,l.holder_id,dest,source_item.quantity,jsonb_build_object('definition_id',source_item.definition_id,'quantity',source_item.quantity));
   insert into public.loot_claim_items(claim_id,item_instance_id,quantity) values(claim,source_item.id,source_item.quantity);
   update public.item_instances set holder_id=dest,container_id=null,version=version+1 where id=source_item.id;
   moved:=moved+1;
 end loop;
 -- Claim currency within the same locked transaction as physical inventory.
 for currency_reward in
   select q.currency_id,q.amount,c.code from public.qr_loot_currency q
   join public.currencies c on c.id=q.currency_id and c.campaign_id=t.campaign_id
   where q.source_id=l.id order by q.currency_id
 loop
   if v_wallet is null then v_wallet:=app_private.ensure_character_wallet(t.campaign_id,p_character);end if;
   insert into public.wallet_balances(wallet_id,currency_id,amount) values(v_wallet,currency_reward.currency_id,currency_reward.amount)
   on conflict(wallet_id,currency_id) do update set amount=public.wallet_balances.amount+excluded.amount;
   v_currency_rewards:=v_currency_rewards||jsonb_build_array(jsonb_build_object(
     'currency_id',currency_reward.currency_id,'code',currency_reward.code,'amount',currency_reward.amount));
   moved:=moved+1;
 end loop;
 if moved=0 then raise exception 'Loot empty'; end if;
 update public.inventory_transactions set details=details||jsonb_build_object('currency_rewards',v_currency_rewards)
 where id=txn;
 update public.interaction_tokens set use_count=use_count+1 where id=t.id;
 if l.claim_mode='first_claim' then update public.loot_sources set is_active=false where id=l.id;end if;
 return txn;
end $function$;
