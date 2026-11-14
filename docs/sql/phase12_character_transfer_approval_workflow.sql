-- Phase 12 cross-campaign transfer approval workflow. Approvals do NOT move character or inventory rows.
create table public.character_transfer_requests(
 id uuid primary key default gen_random_uuid(),
 character_id uuid not null references public.characters(id) on delete cascade,
 source_campaign_id uuid not null references public.campaigns(id) on delete cascade,
 target_campaign_id uuid not null references public.campaigns(id) on delete cascade,
 requested_by uuid not null references auth.users(id),
 reason text not null default '' check(char_length(reason)<=1000),
 status text not null default 'requested' check(status in ('requested','awaiting_target','approved_pending_migration','rejected','cancelled')),
 source_approved_by uuid references auth.users(id),
 target_approved_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(source_campaign_id<>target_campaign_id)
);
create unique index unique_open_character_transfer on public.character_transfer_requests(character_id)
 where status in ('requested','awaiting_target','approved_pending_migration');
alter table public.character_transfer_requests enable row level security;
revoke all on public.character_transfer_requests from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.list_character_transfer_requests(p_campaign uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'id',t.id,'character_id',t.character_id,'character_name',c.name,
 'source_campaign_id',t.source_campaign_id,'source_campaign',src.name,
 'target_campaign_id',t.target_campaign_id,'target_campaign',dest.name,
 'status',t.status,'reason',t.reason,'created_at',t.created_at,
 'can_approve_source',app_private.is_gm(t.source_campaign_id) and t.status='requested',
 'can_approve_target',app_private.is_gm(t.target_campaign_id) and t.status='awaiting_target',
 'can_cancel',t.requested_by=actor and t.status in ('requested','awaiting_target')
 ) order by t.created_at desc,t.id desc)
 from public.character_transfer_requests t
 join public.characters c on c.id=t.character_id
 join public.campaigns src on src.id=t.source_campaign_id
 join public.campaigns dest on dest.id=t.target_campaign_id
 where (p_campaign is null or p_campaign in (t.source_campaign_id,t.target_campaign_id))
 and (t.requested_by=actor or app_private.is_gm(t.source_campaign_id) or app_private.is_gm(t.target_campaign_id))
 ),'[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.list_character_transfer_targets(p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); ch record;
begin
 select c.campaign_id,m.user_id into ch from public.characters c
 join public.campaign_members m on m.id=c.member_id and m.campaign_id=c.campaign_id
 where c.id=p_character and c.is_active and m.status='active';
 if actor is null or ch.campaign_id is null or ch.user_id<>actor then
 raise exception 'Character not authorized' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',cp.id,'name',cp.name) order by cp.name)
 from public.campaigns cp
 join public.campaign_members m on m.campaign_id=cp.id and m.user_id=actor and m.status='active'
 where cp.id<>ch.campaign_id and cp.status='active'), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.manage_character_transfer(p_action text, p_character uuid DEFAULT NULL::uuid, p_target_campaign uuid DEFAULT NULL::uuid, p_request uuid DEFAULT NULL::uuid, p_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();ch record;t public.character_transfer_requests%rowtype;rid uuid; staff record;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action='request' then
  select c.id,c.campaign_id,m.user_id,c.is_active into ch
  from public.characters c join public.campaign_members m on m.id=c.member_id and m.campaign_id=c.campaign_id
  where c.id=p_character and m.status='active' for update of c;
  if ch.id is null or not ch.is_active or ch.user_id<>actor
  then raise exception 'Only character owner may request a transfer' using errcode='42501';end if;
  if p_target_campaign is null or p_target_campaign=ch.campaign_id
   or not exists(select 1 from public.campaigns cp join public.campaign_members m on m.campaign_id=cp.id
     where cp.id=p_target_campaign and cp.status='active' and m.user_id=actor and m.status='active')
  then raise exception 'Destination must be a campaign you belong to' using errcode='22023';end if;
  if exists(select 1 from public.character_transfer_requests
   where character_id=p_character and status in('requested','awaiting_target','approved_pending_migration'))
  then raise exception 'A transfer request is already pending' using errcode='22023';end if;
  insert into public.character_transfer_requests(character_id,source_campaign_id,target_campaign_id,requested_by,reason)
   values(p_character,ch.campaign_id,p_target_campaign,actor,coalesce(p_reason,'')) returning id into rid;
  for staff in
   select distinct u.user_id from (
    select cp.owner_user_id user_id from public.campaigns cp where cp.id=ch.campaign_id
    union all select m.user_id from public.campaign_members m where m.campaign_id=ch.campaign_id and m.status='active' and m.role='gm'
   ) u
  loop perform app_private.notify_campaign_user(ch.campaign_id,staff.user_id,'approval',
   'Character transfer requested','Review a character transfer request.',null,'transfer:'||rid::text||':source:'||staff.user_id::text);
  end loop;
  return jsonb_build_object('id',rid,'status','requested');
 end if;
 select * into t from public.character_transfer_requests where id=p_request for update;
 if t.id is null then raise exception 'Transfer not found' using errcode='22023';end if;
 if p_action='cancel' then
  if t.requested_by<>actor or t.status not in ('requested','awaiting_target') then raise exception 'Cannot cancel transfer' using errcode='42501';end if;
  update public.character_transfer_requests set status='cancelled',updated_at=now() where id=t.id;
 elsif p_action='approve_source' then
  if not app_private.is_gm(t.source_campaign_id) or t.status<>'requested' then raise exception 'Source GM approval unavailable' using errcode='42501';end if;
  update public.character_transfer_requests set status='awaiting_target',source_approved_by=actor,updated_at=now() where id=t.id;
  for staff in
   select distinct u.user_id from (
    select owner_user_id user_id from public.campaigns where id=t.target_campaign_id
    union all select user_id from public.campaign_members where campaign_id=t.target_campaign_id and role='gm' and status='active'
   ) u
  loop perform app_private.notify_campaign_user(t.target_campaign_id,staff.user_id,'approval',
    'Incoming character transfer','Review the incoming transfer request.',null,
    'transfer:'||t.id::text||':target:'||staff.user_id::text);
  end loop;
 elsif p_action='approve_target' then
  if not app_private.is_gm(t.target_campaign_id) or t.status<>'awaiting_target' then raise exception 'Target GM approval unavailable' using errcode='42501';end if;
  if not exists(select 1 from public.campaign_members where campaign_id=t.target_campaign_id and user_id=t.requested_by and status='active')
   then raise exception 'Requester is no longer a member of destination' using errcode='40001';end if;
  update public.character_transfer_requests set status='approved_pending_migration',target_approved_by=actor,updated_at=now() where id=t.id;
 elsif p_action='reject' then
  if t.status not in ('requested','awaiting_target') or not
   (app_private.is_gm(t.source_campaign_id) or app_private.is_gm(t.target_campaign_id))
  then raise exception 'Rejection unavailable' using errcode='42501';end if;
  update public.character_transfer_requests set status='rejected',updated_at=now() where id=t.id;
 else raise exception 'Invalid transfer action' using errcode='22023';end if;
 perform app_private.notify_campaign_user(t.source_campaign_id,t.requested_by,'approval',
   'Character transfer updated',case p_action
    when 'approve_target' then 'Both GMs approved. Safe character migration is still pending.'
    when 'approve_source' then 'Source GM approved. Awaiting destination GM.'
    when 'reject' then 'Character transfer rejected.'
    else 'Character transfer cancelled.' end,
   null,'transfer:'||t.id::text||':'||p_action);
 return jsonb_build_object('id',t.id,'action',p_action,'ok',true);
end $function$
;
revoke all on function public.list_character_transfer_requests(uuid),public.list_character_transfer_targets(uuid),
 public.manage_character_transfer(text,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.list_character_transfer_requests(uuid),public.list_character_transfer_targets(uuid),
 public.manage_character_transfer(text,uuid,uuid,uuid,text) to authenticated;
