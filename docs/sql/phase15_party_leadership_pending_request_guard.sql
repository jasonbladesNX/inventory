CREATE OR REPLACE FUNCTION public.list_party_membership_requests(p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ch public.characters%rowtype;actor uuid:=auth.uid();
begin
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=actor and m.status='active';
 if actor is null or ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',r.id,'party_id',p.id,'party_name',p.name,'character_id',c.id,'character_name',c.name,
  'request_type',r.request_type,'created_at',r.created_at,
  'can_respond',case when r.request_type='invite' then c.id=ch.id
     else app_private.is_gm(p.campaign_id) or p.leader_character_id in (
 select lc.id from public.characters lc
 join public.campaign_members lm on lm.id=lc.member_id and lm.status='active'
 where lc.id=p.leader_character_id and lc.is_active and lm.user_id=actor) end,
  'can_cancel',(r.request_type='join' and r.requested_by=actor) or
    app_private.is_gm(p.campaign_id) or
    (p.leader_character_id in (
      select lc.id from public.characters lc
      join public.campaign_members lm on lm.id=lc.member_id and lm.status='active'
      where lc.id=p.leader_character_id and lc.is_active and lm.user_id=actor)))
  order by r.created_at desc)
 from public.party_membership_requests r
 join public.campaign_parties p on p.id=r.party_id
 join public.characters c on c.id=r.character_id
 where r.status='pending' and p.campaign_id=ch.campaign_id
 and (c.id=ch.id or app_private.is_gm(p.campaign_id) or p.leader_character_id in (
 select lc.id from public.characters lc
 join public.campaign_members lm on lm.id=lc.member_id and lm.status='active'
 where lc.id=p.leader_character_id and lc.is_active and lm.user_id=actor))),'[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.manage_party_membership_request(p_character uuid, p_party uuid, p_action text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();ch public.characters%rowtype;
 party public.campaign_parties%rowtype;request_row public.party_membership_requests%rowtype;
 running boolean;creator boolean;member_owner boolean;result_id uuid;existing_party uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into ch from public.characters where id=p_character and is_active;
 if ch.id is null then raise exception 'Character missing' using errcode='22023';end if;
 select * into party from public.campaign_parties where id=p_party and campaign_id=ch.campaign_id for update;
 if party.id is null then raise exception 'Party missing' using errcode='22023';end if;
 creator:=app_private.is_gm(party.campaign_id) or party.leader_character_id in (select lc.id from public.characters lc join public.campaign_members lm on lm.id=lc.member_id and lm.status='active' where lc.id=party.leader_character_id and lc.is_active and lm.user_id=actor);
 member_owner:=exists(select 1 from public.campaign_members m where m.id=ch.member_id and m.user_id=actor and m.status='active');
 if not (creator or member_owner) then raise exception 'Not authorized' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state where campaign_id=party.campaign_id for update;
 if running then raise exception 'Party changes locked during game' using errcode='42501';end if;
 select party_id into existing_party from public.campaign_party_members where character_id=ch.id and campaign_id=party.campaign_id;
 if p_action in('request','invite') then
  if existing_party is not null then raise exception 'Character already belongs to a party' using errcode='22023';end if;
  if p_action='request' and not member_owner then raise exception 'Only character owner can request membership' using errcode='42501';end if;
  if p_action='invite' and not creator then raise exception 'Only party leader or GM may invite' using errcode='42501';end if;
  if p_action='invite' and not exists(select 1 from public.campaign_members where id=ch.member_id and status='active')
    then raise exception 'Target must be an active campaign member' using errcode='22023';end if;
  if exists(select 1 from public.party_membership_requests where party_id=party.id and character_id=ch.id and status='pending')
    then raise exception 'A request is already pending' using errcode='22023';end if;
  insert into public.party_membership_requests(party_id,character_id,requested_by,request_type)
   values(party.id,ch.id,actor,case when p_action='invite' then 'invite' else 'join' end)
   returning id into result_id;
 elsif p_action in('accept','decline','cancel') then
  select * into request_row from public.party_membership_requests
    where id=p_request and party_id=party.id and character_id=ch.id for update;
  if request_row.id is null or request_row.status<>'pending' then raise exception 'Pending request not found' using errcode='22023';end if;
  if p_action='cancel' then
   if not (creator or (request_row.request_type='join' and request_row.requested_by=actor)) then raise exception 'Cannot cancel this request' using errcode='42501';end if;
  elsif request_row.request_type='invite' and not member_owner then
   raise exception 'Only invited player can respond' using errcode='42501';
  elsif request_row.request_type='join' and not creator then
   raise exception 'Only party leader or GM can respond' using errcode='42501';
  end if;
  if p_action='accept' then
   if existing_party is not null then raise exception 'Character already has a party' using errcode='22023';end if;
   if not exists(select 1 from public.campaign_members where id=ch.member_id and status='active')
    then raise exception 'Character campaign membership inactive' using errcode='22023';end if;
   insert into public.campaign_party_members(party_id,campaign_id,character_id)
    values(party.id,party.campaign_id,ch.id);
   update public.party_membership_requests set status='cancelled',decided_by=actor,decided_at=now()
    where character_id=ch.id and status='pending' and id<>request_row.id;
  end if;
  update public.party_membership_requests set status=
    case when p_action='accept' then 'accepted' when p_action='decline' then 'declined' else 'cancelled' end,
    decided_by=actor,decided_at=now() where id=request_row.id;
  result_id:=request_row.id;
 else raise exception 'Invalid request action' using errcode='22023';end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_request_'||p_action,
  'party',party.id,jsonb_build_object('character_id',ch.id,'request_id',result_id),'Party membership');
 return jsonb_build_object('ok',true,'request_id',result_id,'action',p_action);
end $function$
;
