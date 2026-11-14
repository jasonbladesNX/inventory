
-- Phase 14 campaign administration: existing account invites and protected GM controls.
create or replace function public.list_campaign_administration(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 return jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object(
  'member_id',m.id,'user_id',m.user_id,'display_name',coalesce(p.display_name,'Player'),
  'role',m.role,'status',m.status,'character_count',(select count(*) from public.characters c where c.member_id=m.id),
  'active_character_count',(select count(*) from public.characters c where c.member_id=m.id and c.is_active))
  order by m.role,m.status,p.display_name,m.id)
  from public.campaign_members m left join public.profiles p on p.id=m.user_id
  where m.campaign_id=p_campaign),'[]'::jsonb),
  'characters',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c.id,'name',c.name,'member_id',c.member_id,'is_active',c.is_active)
   order by c.name,c.id) from public.characters c where c.campaign_id=p_campaign),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(jsonb_build_object(
   'event_type',a.event_type,'entity_type',a.entity_type,'reason',a.reason,'created_at',a.created_at,
   'actor_user_id',a.actor_user_id) order by a.created_at desc)
  from (select * from public.audit_events where campaign_id=p_campaign
   and event_type like 'campaign_admin_%' order by created_at desc limit 50) a),'[]'::jsonb)
 );
end $$;
revoke all on function public.list_campaign_administration(uuid) from public,anon;
grant execute on function public.list_campaign_administration(uuid) to authenticated;

create or replace function public.manage_campaign_administration(
 p_campaign uuid,p_action text,p_user uuid default null,p_member uuid default null,
 p_character uuid default null,p_role text default null,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.campaign_members%rowtype;
 owner_id uuid;selected public.characters%rowtype;to_member public.campaign_members%rowtype;
 resulting uuid;old jsonb;new_state jsonb;
begin
 if actor is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 select owner_user_id into owner_id from public.campaigns where id=p_campaign for update;
 if owner_id is null then raise exception 'Campaign not found' using errcode='22023';end if;
 if p_action='invite' then
  if p_user is null or not exists(select 1 from public.profiles where id=p_user) then
    raise exception 'Invitee must have an existing Nexus account' using errcode='22023';end if;
  if p_user=owner_id then raise exception 'Campaign owner already has access' using errcode='22023';end if;
  insert into public.campaign_members(campaign_id,user_id,role,status)
  values(p_campaign,p_user,'player','invited')
  on conflict(campaign_id,user_id) do update
    set status=case when public.campaign_members.status='removed' then 'invited' else public.campaign_members.status end
  returning id into resulting;
  new_state:=jsonb_build_object('status','invited_or_existing','user_id',p_user);
  perform app_private.notify_campaign_user(p_campaign,p_user,'message',
    'Campaign invitation','A Game Master has invited you to join a campaign.',null,
    'campaign-admin-invite:'||p_campaign::text||':'||p_user::text);
 elsif p_action in ('promote','demote','remove','reinstate') then
  select * into target from public.campaign_members where id=p_member and campaign_id=p_campaign for update;
  if target.id is null then raise exception 'Member not found' using errcode='22023';end if;
  if target.user_id=owner_id then raise exception 'Cannot modify campaign owner' using errcode='42501';end if;
  old:=jsonb_build_object('role',target.role,'status',target.status);
  if p_action='promote' then
    if actor<>owner_id or target.status<>'active' then raise exception 'Only owner promotes active members' using errcode='42501';end if;
    update public.campaign_members set role='gm' where id=target.id;
  elsif p_action='demote' then
    if actor<>owner_id then raise exception 'Only owner demotes GMs' using errcode='42501';end if;
    update public.campaign_members set role='player' where id=target.id;
  elsif p_action='remove' then
    if target.status='removed' then raise exception 'Member already removed' using errcode='22023';end if;
    if exists(select 1 from public.characters where member_id=target.id and is_active) then
      raise exception 'Reassign or deactivate active characters before removing this player' using errcode='22023';end if;
    update public.campaign_members set status='removed' where id=target.id;
  else
    update public.campaign_members set status='active' where id=target.id;
  end if;
  resulting:=target.id;
  select jsonb_build_object('role',m.role,'status',m.status) into new_state from public.campaign_members m where m.id=resulting;
 elsif p_action='reassign_character' then
  select * into selected from public.characters where id=p_character and campaign_id=p_campaign for update;
  select * into to_member from public.campaign_members where id=p_member and campaign_id=p_campaign and status='active' for update;
  if selected.id is null or to_member.id is null then raise exception 'Character or destination invalid' using errcode='22023';end if;
  if exists(select 1 from public.characters where member_id=to_member.id and is_active and id<>selected.id) and selected.is_active then
    raise exception 'Target player already has an active character' using errcode='22023';end if;
  if exists(select 1 from public.trade_offers where status in('proposed','countered','accepted')
   and (proposer_character_id=selected.id or recipient_character_id=selected.id)) then
   raise exception 'Resolve open trades before changing character owner' using errcode='22023';end if;
  old:=jsonb_build_object('member_id',selected.member_id);
  update public.characters set member_id=to_member.id where id=selected.id;
  resulting:=selected.id;new_state:=jsonb_build_object('member_id',to_member.id);
 else raise exception 'Invalid administration action' using errcode='22023';end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,reason)
 values(p_campaign,actor,'campaign_admin_'||p_action,
  case when p_action='reassign_character' then 'character' else 'member' end,
  resulting,coalesce(old,'{}'::jsonb),coalesce(new_state,'{}'::jsonb),coalesce(p_reason,''));
 return jsonb_build_object('ok',true,'id',resulting,'action',p_action);
end $$;
revoke all on function public.manage_campaign_administration(uuid,text,uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.manage_campaign_administration(uuid,text,uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.respond_to_campaign_invitation(p_campaign uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.campaign_members%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into m from public.campaign_members where campaign_id=p_campaign and user_id=auth.uid() for update;
 if m.id is null or m.status<>'invited' then raise exception 'No pending invitation' using errcode='22023';end if;
 update public.campaign_members set status=case when p_accept then 'active' else 'removed' end where id=m.id;
 return jsonb_build_object('ok',true,'status',case when p_accept then 'active' else 'removed' end);
end $$;
revoke all on function public.respond_to_campaign_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_to_campaign_invitation(uuid,boolean) to authenticated;

create or replace function public.list_my_campaign_invitations()
returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('campaign_id',c.id,'campaign_name',c.name)
 order by c.name),'[]'::jsonb)
from public.campaign_members m join public.campaigns c on c.id=m.campaign_id
where m.user_id=auth.uid() and m.status='invited';
$$;
revoke all on function public.list_my_campaign_invitations() from public,anon;
grant execute on function public.list_my_campaign_invitations() to authenticated;
