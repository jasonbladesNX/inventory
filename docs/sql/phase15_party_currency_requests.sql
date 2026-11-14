
-- Phase 15: party bank currency requests, reviewed by current leader / GM.
create table if not exists public.party_currency_requests(
 id uuid primary key default gen_random_uuid(),
 party_id uuid not null references public.campaign_parties(id) on delete cascade,
 character_id uuid not null references public.characters(id),
 currency_id uuid not null references public.currencies(id),
 requested_by uuid not null references auth.users(id),
 amount numeric not null check(amount>0),
 status text not null default 'pending'
   check(status in ('pending','approved','declined','cancelled')),
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index if not exists party_currency_request_pending_unique
 on public.party_currency_requests(party_id,character_id,currency_id)
 where status='pending';
create index if not exists party_currency_request_recent
 on public.party_currency_requests(party_id,created_at desc,id desc);
alter table public.party_currency_requests enable row level security;
revoke all on public.party_currency_requests from public,anon,authenticated;

create or replace function public.list_party_currency_requests(
 p_party uuid,p_character uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_party public.campaign_parties%rowtype;actor uuid:=auth.uid();
 v_gm boolean;v_leader boolean;
begin
 select * into v_party from public.campaign_parties where id=p_party;
 if actor is null or v_party.id is null then raise exception 'Party unavailable' using errcode='42501';end if;
 v_gm:=app_private.is_gm(v_party.campaign_id);
 v_leader:=exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=p_party and pm.character_id=v_party.leader_character_id and m.user_id=actor);
 if not (v_gm or v_leader or exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=p_party and pm.character_id=p_character and m.user_id=actor))
 then raise exception 'Party membership required' using errcode='42501';end if;
 return jsonb_build_object(
  'can_review',v_gm or v_leader,
  'is_running',coalesce((select is_running from public.campaign_session_state
    where campaign_id=v_party.campaign_id),false),
  'policy',v_party.bank_withdrawal_policy,
  'currencies',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',cu.id,'name',cu.name,'code',cu.code,'precision',cu.precision_digits,
      'amount',wb.amount) order by cu.code)
    from public.campaign_banks b
    join public.wallets w on w.holder_id=b.holder_id
    join public.wallet_balances wb on wb.wallet_id=w.id and wb.amount>0
    join public.currencies cu on cu.id=wb.currency_id and cu.campaign_id=v_party.campaign_id
    where b.party_id=p_party and b.bank_type='party'
   ),'[]'::jsonb),
  'requests',coalesce((
    select jsonb_agg(jsonb_build_object(
     'id',r.id,'character_id',r.character_id,'character_name',ch.name,
     'currency_id',r.currency_id,'currency_code',cu.code,'currency_name',cu.name,
     'amount',r.amount,'status',r.status,'created_at',r.created_at,
     'can_review',r.status='pending' and (v_gm or v_leader),
     'can_cancel',r.status='pending' and r.requested_by=actor)
    order by r.created_at desc,r.id desc)
    from public.party_currency_requests r
    join public.characters ch on ch.id=r.character_id
    join public.currencies cu on cu.id=r.currency_id
    where r.party_id=p_party and (v_gm or v_leader or r.requested_by=actor)
   ),'[]'::jsonb));
end $$;
revoke all on function public.list_party_currency_requests(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_party_currency_requests(uuid,uuid) to authenticated;

create or replace function public.manage_party_currency_request(
 p_party uuid,p_action text,p_character uuid default null,p_currency uuid default null,
 p_amount numeric default null,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();v_party public.campaign_parties%rowtype;
 v_bank public.campaign_banks%rowtype;v_request public.party_currency_requests%rowtype;
 v_precision integer;v_is_running boolean;v_reviewer boolean;v_owner boolean;
 v_bank_wallet uuid;v_target_holder uuid;v_target_wallet uuid;v_balance numeric;v_id uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into v_party from public.campaign_parties where id=p_party for update;
 if v_party.id is null then raise exception 'Party not found' using errcode='22023';end if;
 if not exists(select 1 from public.campaigns c
  where c.id=v_party.campaign_id and c.status='active') then
  raise exception 'Campaign inactive' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id)
  values(v_party.campaign_id) on conflict do nothing;
 select is_running into v_is_running from public.campaign_session_state
  where campaign_id=v_party.campaign_id for update;
 if v_is_running then raise exception 'Currency requests locked during an active game' using errcode='42501';end if;
 select * into v_bank from public.campaign_banks
  where party_id=p_party and bank_type='party';
 if v_bank.id is null then raise exception 'Party bank unavailable' using errcode='22023';end if;
 v_reviewer:=app_private.is_gm(v_party.campaign_id) or exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=p_party and pm.character_id=v_party.leader_character_id and m.user_id=actor);
 if p_action='request' then
  if p_character is null or p_currency is null or p_amount is null or p_amount<=0
  then raise exception 'Character, currency and positive amount required' using errcode='22023';end if;
  v_owner:=exists(
   select 1 from public.campaign_party_members pm
   join public.characters c on c.id=pm.character_id and c.is_active
   join public.campaign_members m on m.id=c.member_id and m.status='active'
   where pm.party_id=p_party and pm.character_id=p_character and m.user_id=actor);
  if not v_owner then raise exception 'Only your own active party character can request currency' using errcode='42501';end if;
  select precision_digits into v_precision from public.currencies
   where id=p_currency and campaign_id=v_party.campaign_id;
  if v_precision is null or p_amount>1000000000 or p_amount<>round(p_amount,v_precision) then
   raise exception 'Currency amount or denomination precision invalid' using errcode='22023';end if;
  select wb.amount into v_balance
    from public.wallets w join public.wallet_balances wb on wb.wallet_id=w.id
    where w.holder_id=v_bank.holder_id and wb.currency_id=p_currency;
  if v_balance is null or v_balance<p_amount then
   raise exception 'Insufficient party currency available' using errcode='22023';end if;
  if exists(select 1 from public.party_currency_requests r
   where r.party_id=p_party and r.character_id=p_character
   and r.currency_id=p_currency and r.status='pending') then
   raise exception 'You already have a pending request for this currency' using errcode='22023';end if;
  insert into public.party_currency_requests(
   party_id,character_id,currency_id,requested_by,amount)
   values(p_party,p_character,p_currency,actor,p_amount) returning id into v_id;
 elsif p_action in ('approve','decline','cancel') then
  if p_request is null then raise exception 'Request id is required' using errcode='22023';end if;
  select * into v_request from public.party_currency_requests
   where id=p_request and party_id=p_party for update;
  if v_request.id is null or v_request.status<>'pending' then
   raise exception 'Pending request unavailable' using errcode='22023';end if;
  if p_action='cancel' then
   if actor<>v_request.requested_by then raise exception 'Only requester may cancel' using errcode='42501';end if;
  elsif not v_reviewer then
   raise exception 'Only current leader or campaign GM may approve currency' using errcode='42501';end if;
  if p_action='approve' then
   if not exists(
    select 1 from public.campaign_party_members pm
    join public.characters c on c.id=pm.character_id and c.is_active
    join public.campaign_members m on m.id=c.member_id and m.status='active'
    where pm.party_id=p_party and pm.character_id=v_request.character_id
   ) then raise exception 'Recipient is no longer a party member' using errcode='42501';end if;
   select h.id into v_target_holder from public.inventory_holders h
    where h.campaign_id=v_party.campaign_id
      and h.character_id=v_request.character_id and h.holder_type='character';
   if v_target_holder is null then raise exception 'Recipient inventory unavailable' using errcode='22023';end if;
   select precision_digits into v_precision from public.currencies
    where id=v_request.currency_id and campaign_id=v_party.campaign_id;
   if v_precision is null or v_request.amount<>round(v_request.amount,v_precision)
   then raise exception 'Currency denomination invalid' using errcode='22023';end if;
   select id into v_bank_wallet from public.wallets
    where holder_id=v_bank.holder_id and campaign_id=v_party.campaign_id;
   if v_bank_wallet is null then raise exception 'Party bank wallet unavailable' using errcode='22023';end if;
   insert into public.wallets(campaign_id,holder_id)
    values(v_party.campaign_id,v_target_holder)
    on conflict(campaign_id,holder_id) do update set holder_id=excluded.holder_id
    returning id into v_target_wallet;
   perform app_private.move_wallet_amount(v_bank_wallet,v_target_wallet,
     v_request.currency_id,v_request.amount);
   insert into public.campaign_bank_currency_activity(
     campaign_id,bank_id,character_id,actor_user_id,action,currency_id,amount)
    values(v_party.campaign_id,v_bank.id,v_request.character_id,actor,
     'withdraw',v_request.currency_id,v_request.amount);
  end if;
  update public.party_currency_requests set
    status=case p_action when 'approve' then 'approved'
     when 'decline' then 'declined' else 'cancelled' end,
    decided_by=actor,decided_at=now() where id=v_request.id;
  v_id:=v_request.id;
 else
  raise exception 'Unsupported currency request action' using errcode='22023';
 end if;
 insert into public.audit_events(
  campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(v_party.campaign_id,actor,'campaign_admin_party_currency_'||p_action,
   'party',p_party,jsonb_build_object('request_id',v_id),
   'Party currency withdrawal request');
 return jsonb_build_object('ok',true,'action',p_action,'request_id',v_id);
end $$;
revoke all on function public.manage_party_currency_request(uuid,text,uuid,uuid,numeric,uuid)
 from public,anon,authenticated;
grant execute on function public.manage_party_currency_request(uuid,text,uuid,uuid,numeric,uuid)
 to authenticated;
