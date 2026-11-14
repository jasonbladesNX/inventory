
alter table public.campaign_parties
 add column if not exists bank_withdrawal_policy text not null default 'direct'
 check(bank_withdrawal_policy in ('direct','approval'));

create or replace function public.set_party_bank_withdrawal_policy(p_party uuid,p_policy text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_party public.campaign_parties%rowtype;v_running boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into v_party from public.campaign_parties where id=p_party for update;
 if v_party.id is null or not app_private.is_gm(v_party.campaign_id)
 then raise exception 'GM permission required' using errcode='42501';end if;
 if p_policy not in ('direct','approval') then raise exception 'Unsupported withdrawal policy' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(v_party.campaign_id) on conflict do nothing;
 select is_running into v_running from public.campaign_session_state where campaign_id=v_party.campaign_id for update;
 if v_running then raise exception 'Cannot change withdrawal policy during a game' using errcode='42501';end if;
 update public.campaign_parties set bank_withdrawal_policy=p_policy where id=p_party;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(v_party.campaign_id,auth.uid(),'campaign_admin_party_bank_policy','party',p_party,
 jsonb_build_object('withdrawal_policy',p_policy),'GM updated party withdrawal policy');
 return jsonb_build_object('ok',true,'policy',p_policy);
end $$;
revoke all on function public.set_party_bank_withdrawal_policy(uuid,text) from public,anon,authenticated;
grant execute on function public.set_party_bank_withdrawal_policy(uuid,text) to authenticated;


CREATE OR REPLACE FUNCTION public.manage_bank_item(p_character uuid, p_bank uuid, p_item uuid, p_action text, p_quantity numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ch public.characters%rowtype;b public.campaign_banks%rowtype;
 i public.item_instances%rowtype; source_holder uuid; destination_holder uuid;
 v_id uuid;v_name text;session_running boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.id=p_character and m.user_id=auth.uid() and m.status='active' and c.is_active;
 if ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select is_running into session_running from public.campaign_session_state where campaign_id=ch.campaign_id for update;
 if session_running then raise exception 'Banks are locked while the GM session is running' using errcode='42501';end if;
 select * into b from public.campaign_banks where id=p_bank and campaign_id=ch.campaign_id;
 if b.id is null or not ((b.bank_type='personal' and b.character_id=ch.id)
 or (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
  where pm.party_id=b.party_id and pm.character_id=ch.id)))
 then raise exception 'Bank access denied' using errcode='42501';end if;
 if p_action='withdraw' and b.bank_type='party' and exists(
  select 1 from public.campaign_parties cp where cp.id=b.party_id and cp.bank_withdrawal_policy='approval'
 ) then
  raise exception 'Party bank withdrawals require leader or GM approval; use Party Loot Requests' using errcode='42501';
 end if;
 if p_action not in ('deposit','withdraw') or p_quantity is null or p_quantity<=0 or p_quantity>1000000
 then raise exception 'Invalid bank transfer' using errcode='22023';end if;
 select h.id into source_holder from public.inventory_holders h
 where h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character';
 if source_holder is null then raise exception 'Character inventory unavailable';end if;
 select * into i from public.item_instances where id=p_item for update;
 if i.id is null or i.campaign_id<>ch.campaign_id then raise exception 'Item unavailable';end if;
 if p_action='deposit' then
  if i.holder_id<>source_holder then raise exception 'Item is not carried by this character' using errcode='42501';end if;
  destination_holder:=b.holder_id;
 else
  if i.holder_id<>b.holder_id then raise exception 'Item is not stored in this bank' using errcode='42501';end if;
  destination_holder:=source_holder;
 end if;
 if i.quantity<p_quantity or i.container_id is not null or
  exists(select 1 from public.equipment_assignments ea where ea.item_instance_id=i.id) or
  exists(select 1 from public.containers co where co.id=i.id or co.properties->>'source_item_id'=i.id::text) or
  exists(select 1 from public.item_effects eff where eff.item_instance_id=i.id) or
  exists(select 1 from public.item_definitions d where d.id=i.definition_id and d.category='container') or
  exists(select 1 from public.trade_offers t where t.status in('proposed','countered','accepted')
    and position(i.id::text in t.offer::text)>0)
 then raise exception 'Item is equipped, nested, a container, reserved in an active trade, or has insufficient quantity' using errcode='22023';end if;
 select coalesce(i.custom_name,d.name) into v_name from public.item_definitions d where d.id=i.definition_id;
 if i.quantity=p_quantity then
  update public.item_instances set holder_id=destination_holder where id=i.id;
  v_id:=i.id;
 else
  update public.item_instances set quantity=quantity-p_quantity where id=i.id;
  insert into public.item_instances(campaign_id,definition_id,holder_id,container_id,quantity,
    condition_code,identified,custom_name,properties,private_properties,version)
  values(i.campaign_id,i.definition_id,destination_holder,null,p_quantity,
   i.condition_code,i.identified,i.custom_name,i.properties,i.private_properties,i.version)
  returning id into v_id;
 end if;
 insert into public.campaign_bank_activity(campaign_id,bank_id,character_id,actor_user_id,action,item_instance_id,item_name,quantity)
 values(ch.campaign_id,b.id,ch.id,auth.uid(),p_action,v_id,v_name,p_quantity);
 return jsonb_build_object('ok',true,'item_id',v_id,'quantity',p_quantity,'action',p_action);
end $function$
;

CREATE OR REPLACE FUNCTION public.manage_bank_currency(p_character uuid, p_bank uuid, p_currency uuid, p_action text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ch public.characters%rowtype;b public.campaign_banks%rowtype;
 carried_holder uuid;currency_precision int;source_wallet uuid;dest_wallet uuid;
 bank_wallet uuid;player_wallet uuid;running boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=auth.uid() and m.status='active';
 if ch.id is null then raise exception 'Character unavailable' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state where campaign_id=ch.campaign_id for update;
 if running then raise exception 'Bank treasury locked during the game' using errcode='42501';end if;
 select * into b from public.campaign_banks where id=p_bank and campaign_id=ch.campaign_id;
 if b.id is null or not ((b.bank_type='personal' and b.character_id=ch.id) or
 (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm where pm.party_id=b.party_id and pm.character_id=ch.id)))
 then raise exception 'Bank access denied' using errcode='42501';end if;
 if p_action='withdraw' and b.bank_type='party' and exists(
  select 1 from public.campaign_parties cp where cp.id=b.party_id and cp.bank_withdrawal_policy='approval'
 ) then
  raise exception 'Party bank withdrawals require leader or GM approval; use Party Loot Requests' using errcode='42501';
 end if;
 select precision_digits into currency_precision from public.currencies where id=p_currency and campaign_id=ch.campaign_id;
 if currency_precision is null or p_action not in('deposit','withdraw') or p_amount is null
 or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,currency_precision)
 then raise exception 'Invalid currency amount' using errcode='22023';end if;
 select id into carried_holder from public.inventory_holders
 where campaign_id=ch.campaign_id and character_id=ch.id and holder_type='character' limit 1;
 if carried_holder is null then raise exception 'Character inventory unavailable';end if;
 insert into public.wallets(campaign_id,holder_id) values(ch.campaign_id,carried_holder)
  on conflict(campaign_id,holder_id) do update set holder_id=excluded.holder_id returning id into player_wallet;
 insert into public.wallets(campaign_id,holder_id) values(ch.campaign_id,b.holder_id)
  on conflict(campaign_id,holder_id) do update set holder_id=excluded.holder_id returning id into bank_wallet;
 if p_action='deposit' then source_wallet:=player_wallet;dest_wallet:=bank_wallet;
 else source_wallet:=bank_wallet;dest_wallet:=player_wallet;end if;
 perform app_private.move_wallet_amount(source_wallet,dest_wallet,p_currency,p_amount);
 insert into public.campaign_bank_currency_activity(campaign_id,bank_id,character_id,actor_user_id,action,currency_id,amount)
 values(ch.campaign_id,b.id,ch.id,auth.uid(),p_action,p_currency,p_amount);
 return jsonb_build_object('ok',true,'action',p_action,'amount',p_amount,'currency_id',p_currency);
end $function$
;

CREATE OR REPLACE FUNCTION public.list_character_banks(p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ch public.characters%rowtype;actor uuid:=auth.uid(); h uuid;v_bank uuid;
begin
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=actor and m.status='active';
 if actor is null or ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select id into v_bank from public.campaign_banks where character_id=ch.id and bank_type='personal';
 if v_bank is null then
  insert into public.inventory_holders(campaign_id,holder_type,name)
    values(ch.campaign_id,'gm',ch.name||' — Home Bank') returning id into h;
  insert into public.campaign_banks(campaign_id,bank_type,character_id,holder_id)
    values(ch.campaign_id,'personal',ch.id,h) returning id into v_bank;
 end if;
 return jsonb_build_object(
  'is_running',coalesce((select is_running from public.campaign_session_state where campaign_id=ch.campaign_id),false),
  'banks',coalesce((select jsonb_agg(jsonb_build_object(
   'id',b.id,'type',b.bank_type,'withdrawal_policy',coalesce(p.bank_withdrawal_policy,'direct'),'name',case when b.bank_type='personal' then 'Personal Bank' else p.name||' Party Bank' end,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',case when i.identified then coalesce(i.custom_name,d.name) else 'Unidentified Item' end,
      'quantity',i.quantity,'category',d.category,'identified',i.identified) order by d.name,i.id)
    from public.item_instances i join public.item_definitions d on d.id=i.definition_id where i.holder_id=b.holder_id),'[]'::jsonb))
   order by b.bank_type,b.created_at)
   from public.campaign_banks b left join public.campaign_parties p on p.id=b.party_id
   where b.campaign_id=ch.campaign_id and
    ((b.bank_type='personal' and b.character_id=ch.id) or
     (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
      where pm.party_id=b.party_id and pm.character_id=ch.id)))),'[]'::jsonb)
 );
end $function$
;

CREATE OR REPLACE FUNCTION public.list_campaign_parties(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'join_policy',p.join_policy,'bank_withdrawal_policy',p.bank_withdrawal_policy,'leader_character_id',p.leader_character_id,'members',coalesce((
   select jsonb_agg(jsonb_build_object('character_id',c.id,'name',c.name) order by c.name)
   from public.campaign_party_members pm join public.characters c on c.id=pm.character_id
   where pm.party_id=p.id),'[]'::jsonb))
  order by p.name,p.id) from public.campaign_parties p where p.campaign_id=p_campaign),'[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.list_party_loot_requests(p_party uuid, p_character uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_party public.campaign_parties%rowtype;actor uuid:=auth.uid();is_leader boolean;is_gm boolean;
begin
 select * into v_party from public.campaign_parties where id=p_party;
 if actor is null or v_party.id is null then raise exception 'Party unavailable' using errcode='42501';end if;
 is_gm:=app_private.is_gm(v_party.campaign_id);
 is_leader:=exists(select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=v_party.id and pm.character_id=v_party.leader_character_id and m.user_id=actor);
 if not (is_gm or is_leader or exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=v_party.id and pm.character_id=p_character and m.user_id=actor
 )) then raise exception 'Active party membership required' using errcode='42501';end if;
 return jsonb_build_object(
 'can_review',is_gm or is_leader,
 'withdrawal_policy',v_party.bank_withdrawal_policy,
 'is_running',coalesce((select is_running from public.campaign_session_state s where s.campaign_id=v_party.campaign_id),false),
 'items',coalesce((
  select jsonb_agg(jsonb_build_object('id',i.id,'name',
    case when i.identified then coalesce(i.custom_name,d.name) else 'Unidentified Item' end,
    'quantity',i.quantity) order by d.name,i.id)
  from public.campaign_banks b join public.item_instances i on i.holder_id=b.holder_id
  join public.item_definitions d on d.id=i.definition_id
  where b.party_id=p_party and b.bank_type='party'),'[]'::jsonb),
 'requests',coalesce((
  select jsonb_agg(jsonb_build_object(
    'id',r.id,'item_id',r.item_instance_id,'item_name',
    case when i.identified then coalesce(i.custom_name,d.name) else coalesce(
      (select 'Unidentified Item'), 'Unidentified Item') end,
    'character_id',r.character_id,'character_name',c.name,'quantity',r.quantity,
    'status',r.status,'created_at',r.created_at,
    'can_cancel',r.status='pending' and r.requested_by=actor,
    'can_review',r.status='pending' and (is_leader or is_gm))
   order by r.created_at desc,r.id desc)
  from public.party_loot_requests r
  join public.characters c on c.id=r.character_id
  left join public.item_instances i on i.id=r.item_instance_id
  left join public.item_definitions d on d.id=i.definition_id
  where r.party_id=p_party and (is_leader or is_gm or r.requested_by=actor)
 ),'[]'::jsonb));
end $function$
;