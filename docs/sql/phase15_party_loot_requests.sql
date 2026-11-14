
-- Party item requests, with leader review and atomic claim to the requesting character.
create table if not exists public.party_loot_requests(
 id uuid primary key default gen_random_uuid(),
 party_id uuid not null references public.campaign_parties(id) on delete cascade,
 item_instance_id uuid not null references public.item_instances(id) on delete cascade,
 character_id uuid not null references public.characters(id),
 requested_by uuid not null references auth.users(id),
 quantity numeric not null check(quantity>0),
 expected_quantity numeric not null check(expected_quantity>0),
 status text not null default 'pending' check(status in ('pending','approved','declined','cancelled')),
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 distributed_item_id uuid,
 created_at timestamptz not null default now()
);
create index if not exists party_loot_requests_party_recent on public.party_loot_requests(party_id,created_at desc);
create unique index if not exists party_loot_requests_one_pending
 on public.party_loot_requests(party_id,item_instance_id,character_id)
 where status='pending';
alter table public.party_loot_requests enable row level security;
revoke all on public.party_loot_requests from public,anon,authenticated;

create or replace function public.list_party_loot_requests(p_party uuid,p_character uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
end $$;
revoke all on function public.list_party_loot_requests(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_party_loot_requests(uuid,uuid) to authenticated;

create or replace function public.manage_party_loot_request(
 p_party uuid,p_action text,p_character uuid default null,p_item uuid default null,
 p_quantity numeric default null,p_request uuid default null,p_expected_quantity numeric default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();party public.campaign_parties%rowtype;
 bank public.campaign_banks%rowtype;item public.item_instances%rowtype;
 req public.party_loot_requests%rowtype;dest uuid;v_name text;new_id uuid;running boolean;
 reviewer boolean;member_owner boolean;v_id uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into party from public.campaign_parties where id=p_party for update;
 if party.id is null then raise exception 'Party unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.campaigns where id=party.campaign_id and status='active')
 then raise exception 'Campaign inactive' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state where campaign_id=party.campaign_id for update;
 if running then raise exception 'Party loot requests are locked during active gameplay' using errcode='42501';end if;
 reviewer:=app_private.is_gm(party.campaign_id) or exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=party.id and pm.character_id=party.leader_character_id and m.user_id=actor);
 select * into bank from public.campaign_banks where party_id=party.id and bank_type='party';
 if bank.id is null then raise exception 'Party bank unavailable' using errcode='22023';end if;
 if p_action='request' then
  if p_character is null or p_item is null or p_quantity is null or p_quantity<=0 or p_expected_quantity is null or p_expected_quantity<=0
  then raise exception 'Item, character and positive quantity/stock required' using errcode='22023';end if;
  member_owner:=exists(select 1 from public.campaign_party_members pm
   join public.characters c on c.id=pm.character_id and c.is_active
   join public.campaign_members m on m.id=c.member_id and m.status='active'
   where pm.party_id=party.id and c.id=p_character and m.user_id=actor);
  if not member_owner then raise exception 'Only the owning party character can request loot' using errcode='42501';end if;
  select * into item from public.item_instances where id=p_item and holder_id=bank.holder_id and campaign_id=party.campaign_id for update;
  if item.id is null or item.quantity<>p_expected_quantity or item.quantity<p_quantity then
   raise exception 'Shared bank item changed or unavailable; refresh before requesting' using errcode='22023';end if;
  if exists(select 1 from public.party_loot_requests where party_id=party.id and item_instance_id=p_item
   and character_id=p_character and status='pending') then
   raise exception 'Request already pending for this item' using errcode='22023';end if;
  insert into public.party_loot_requests(party_id,item_instance_id,character_id,requested_by,quantity,expected_quantity)
   values(party.id,p_item,p_character,actor,p_quantity,p_expected_quantity) returning id into v_id;
 elsif p_action in('approve','decline','cancel') then
  select * into req from public.party_loot_requests where id=p_request and party_id=party.id for update;
  if req.id is null or req.status<>'pending' then raise exception 'Pending request not found' using errcode='22023';end if;
  if p_action='cancel' then
   if req.requested_by<>actor then raise exception 'Only requester can cancel' using errcode='42501';end if;
  elsif not reviewer then raise exception 'Only current party leader or GM can review loot requests' using errcode='42501';end if;
  if p_action='approve' then
   if not exists(select 1 from public.campaign_party_members pm
    join public.characters c on c.id=pm.character_id and c.is_active
    join public.campaign_members m on m.id=c.member_id and m.status='active'
    where pm.party_id=party.id and pm.character_id=req.character_id)
   then raise exception 'Requester is no longer an active party member' using errcode='42501';end if;
   select id into dest from public.inventory_holders
    where character_id=req.character_id and holder_type='character' and campaign_id=party.campaign_id;
   if dest is null then raise exception 'Recipient inventory unavailable' using errcode='22023';end if;
   select * into item from public.item_instances where id=req.item_instance_id for update;
   if item.id is null or item.holder_id<>bank.holder_id or item.campaign_id<>party.campaign_id or
    item.quantity is distinct from req.expected_quantity or item.quantity<req.quantity then
    raise exception 'Bank stock changed; request must be cancelled and recreated' using errcode='22023';end if;
   if item.container_id is not null or
    exists(select 1 from public.equipment_assignments ea where ea.item_instance_id=item.id) or
    exists(select 1 from public.item_effects e where e.item_instance_id=item.id) or
    exists(select 1 from public.containers co where co.id=item.id or co.properties->>'source_item_id'=item.id::text) or
    exists(select 1 from public.item_definitions d where d.id=item.definition_id and d.category='container') or
    exists(select 1 from public.trade_offers t where t.status in('proposed','countered','accepted')
      and position(item.id::text in t.offer::text)>0)
   then raise exception 'Item is not eligible for transfer' using errcode='22023';end if;
   select case when item.identified then coalesce(item.custom_name,d.name) else 'Unidentified Item' end into v_name
    from public.item_definitions d where d.id=item.definition_id;
   if item.quantity=req.quantity then
    update public.item_instances set holder_id=dest where id=item.id;
    new_id:=item.id;
   else
    update public.item_instances set quantity=quantity-req.quantity where id=item.id;
    insert into public.item_instances(campaign_id,definition_id,holder_id,quantity,condition_code,identified,
      custom_name,properties,private_properties,version)
    values(item.campaign_id,item.definition_id,dest,req.quantity,item.condition_code,item.identified,
      item.custom_name,item.properties,item.private_properties,item.version) returning id into new_id;
   end if;
   insert into public.campaign_bank_activity(campaign_id,bank_id,character_id,actor_user_id,
    action,item_instance_id,item_name,quantity)
   values(party.campaign_id,bank.id,req.character_id,actor,'withdraw',new_id,v_name,req.quantity);
  end if;
  update public.party_loot_requests set status=case p_action when 'approve' then 'approved'
   when 'decline' then 'declined' else 'cancelled' end,
   decided_by=actor,decided_at=now(),distributed_item_id=case when p_action='approve' then new_id else null end
   where id=req.id;
  v_id:=req.id;
 else raise exception 'Unsupported request action' using errcode='22023';end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_loot_'||p_action,'party',party.id,
 jsonb_build_object('request_id',v_id,'item_id',coalesce(req.item_instance_id,p_item),
 'character_id',coalesce(req.character_id,p_character)),'Party loot request');
 return jsonb_build_object('ok',true,'action',p_action,'request_id',v_id,'distributed_item_id',new_id);
end $$;
revoke all on function public.manage_party_loot_request(uuid,text,uuid,uuid,numeric,uuid,numeric) from public,anon,authenticated;
grant execute on function public.manage_party_loot_request(uuid,text,uuid,uuid,numeric,uuid,numeric) to authenticated;
