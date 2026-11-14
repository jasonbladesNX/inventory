CREATE OR REPLACE FUNCTION public.configure_party(p_party uuid, p_name text DEFAULT NULL::text, p_policy text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.campaign_parties%rowtype;actor uuid:=auth.uid();
 organizer boolean;running boolean;previous jsonb;
begin
 select * into party from public.campaign_parties where id=p_party for update;
 if actor is null or party.id is null then raise exception 'Party not found or no session' using errcode='42501';end if;
 organizer:=party.created_by=actor and exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=party.id and m.user_id=actor
 );
 if not (organizer or app_private.is_gm(party.campaign_id)) then
  raise exception 'Only the current party leader or campaign GM may configure the party' using errcode='42501';end if;
 if not exists(select 1 from public.campaigns where id=party.campaign_id and status='active') then
  raise exception 'Campaign is inactive' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state where campaign_id=party.campaign_id for update;
 if running then raise exception 'Party configuration is locked during an active game' using errcode='42501';end if;
 if p_name is null and p_policy is null then raise exception 'No changes supplied' using errcode='22023';end if;
 if p_name is not null and char_length(btrim(p_name)) not between 1 and 100 then
  raise exception 'Party name must have 1 to 100 characters' using errcode='22023';end if;
 if p_policy is not null and p_policy not in('open','approval') then
  raise exception 'Join policy must be open or approval' using errcode='22023';end if;
 previous:=jsonb_build_object('name',party.name,'join_policy',party.join_policy);
 update public.campaign_parties
  set name=coalesce(btrim(p_name),name),join_policy=coalesce(p_policy,join_policy)
  where id=party.id;
 -- Keep the bank's label consistent without moving its contents.
 if p_name is not null then
  update public.inventory_holders h set name=btrim(p_name)||' Bank'
  from public.campaign_banks b
  where b.party_id=party.id and b.holder_id=h.id and b.bank_type='party';
 end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_configure','party',party.id,
  previous,jsonb_build_object('name',coalesce(btrim(p_name),party.name),'join_policy',coalesce(p_policy,party.join_policy)),
  'Party settings edited');
 return jsonb_build_object('ok',true,'id',party.id,'name',coalesce(btrim(p_name),party.name),
 'join_policy',coalesce(p_policy,party.join_policy));
end $function$
;

CREATE OR REPLACE FUNCTION public.remove_party_member(p_party uuid, p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.campaign_parties%rowtype;actor uuid:=auth.uid();organizer boolean;running boolean;
begin
 select * into party from public.campaign_parties where id=p_party for update;
 if actor is null or party.id is null then raise exception 'Party not found' using errcode='42501';end if;
 organizer:=party.leader_character_id in (
 select lc.id from public.characters lc
 join public.campaign_members lm on lm.id=lc.member_id and lm.status='active'
 where lc.id=party.leader_character_id and lc.is_active and lm.user_id=actor);
 if not (organizer or app_private.is_gm(party.campaign_id)) then
  raise exception 'Party leader or GM required' using errcode='42501';end if;
 if not exists(select 1 from public.campaign_party_members where party_id=p_party and character_id=p_character)
 then raise exception 'Character is not a party member' using errcode='22023';end if;
 if organizer and exists(
  select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.id=p_character and m.user_id=actor)
 then raise exception 'Use Leave Party to remove yourself' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state
 where campaign_id=party.campaign_id for update;
 if running then raise exception 'Cannot remove members during an active game' using errcode='42501';end if;
 delete from public.campaign_party_members where party_id=party.id and character_id=p_character;
 update public.party_membership_requests set status='cancelled',decided_by=actor,decided_at=now()
 where character_id=p_character and party_id=party.id and status='pending';
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_remove_member','party',party.id,
  jsonb_build_object('character_id',p_character),'Party member removed');
 return jsonb_build_object('ok',true,'removed_character_id',p_character);
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
 creator:=app_private.is_gm(party.campaign_id) or (
  party.created_by=actor and exists(
   select 1 from public.campaign_party_members pm
   join public.characters own on own.id=pm.character_id
   join public.campaign_members mem on mem.id=own.member_id
   where pm.party_id=party.id and mem.user_id=actor and mem.status='active'
  ));
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
   if request_row.requested_by<>actor and not creator then raise exception 'Cannot cancel this request' using errcode='42501';end if;
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
  'can_cancel',r.requested_by=actor)
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

CREATE OR REPLACE FUNCTION public.list_party_invitable_characters(p_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.campaign_parties%rowtype;
begin
 select * into p from public.campaign_parties where id=p_party;
 if auth.uid() is null or p.id is null or not (app_private.is_gm(p.campaign_id) or p.leader_character_id in (
 select lc.id from public.characters lc
 join public.campaign_members lm on lm.id=lc.member_id and lm.status='active'
 where lc.id=p.leader_character_id and lc.is_active and lm.user_id=auth.uid()))
 then raise exception 'Organizer or GM required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)
  order by c.name,c.id)
  from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.campaign_id=p.campaign_id and c.is_active and m.status='active'
  and not exists(select 1 from public.campaign_party_members pm where pm.character_id=c.id)
  and not exists(select 1 from public.party_membership_requests r
    where r.character_id=c.id and r.party_id=p.id and r.status='pending')
 ),'[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.list_player_party_options(p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;v_actor uuid:=auth.uid();v_party uuid;
begin
 select c.campaign_id into v_campaign from public.characters c
 join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=v_actor and m.status='active';
 if v_actor is null or v_campaign is null then
  raise exception 'Active owned character required' using errcode='42501';end if;
 select pm.party_id into v_party from public.campaign_party_members pm
 where pm.campaign_id=v_campaign and pm.character_id=p_character;
 return jsonb_build_object(
  'campaign_id',v_campaign,
  'is_running',coalesce((select s.is_running from public.campaign_session_state s
   where s.campaign_id=v_campaign),false),
  'current_party_id',v_party,
  'parties',coalesce((select jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'join_policy',p.join_policy,'is_organizer',(p.leader_character_id in (
 select lc.id from public.characters lc
 join public.campaign_members lm on lm.id=lc.member_id and lm.status='active'
 where lc.id=p.leader_character_id and lc.is_active and lm.user_id=v_actor)),'leader_character_id',p.leader_character_id,'member_count',(select count(*) from public.campaign_party_members pm where pm.party_id=p.id),
     'members',coalesce((select jsonb_agg(jsonb_build_object('name',c.name,'character_id',c.id,'is_leader',(c.id=p.leader_character_id))
      order by c.name,c.id) from public.campaign_party_members pm
      join public.characters c on c.id=pm.character_id
      where pm.party_id=p.id),'[]'::jsonb))
     order by p.name,p.id)
    from public.campaign_parties p where p.campaign_id=v_campaign),'[]'::jsonb)
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
  'id',p.id,'name',p.name,'join_policy',p.join_policy,'leader_character_id',p.leader_character_id,'members',coalesce((
   select jsonb_agg(jsonb_build_object('character_id',c.id,'name',c.name) order by c.name)
   from public.campaign_party_members pm join public.characters c on c.id=pm.character_id
   where pm.party_id=p.id),'[]'::jsonb))
  order by p.name,p.id) from public.campaign_parties p where p.campaign_id=p_campaign),'[]'::jsonb);
end $function$
;
