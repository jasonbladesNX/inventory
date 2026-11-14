
create table public.campaign_messages(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 sender_user_id uuid not null references auth.users(id),
 audience text not null check(audience in ('all','zone','direct')),
 target_zone_id uuid,
 target_user_id uuid,
 subject text not null default '' check(char_length(subject)<=160),
 body text not null check(char_length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now(),
 foreign key(target_zone_id,campaign_id) references public.campaign_zones(id,campaign_id)
);
create index campaign_messages_latest on public.campaign_messages(campaign_id,created_at desc);
create table public.campaign_message_recipients(
 message_id uuid not null references public.campaign_messages(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_at timestamptz,
 primary key(message_id,user_id)
);
create index message_recipients_by_user on public.campaign_message_recipients(user_id,message_id);
create table public.campaign_notification_settings(
 campaign_id uuid primary key references public.campaigns(id) on delete cascade,
 allow_direct_messages boolean not null default true,
 alerts_initiative boolean not null default true,
 alerts_trades boolean not null default true,
 alerts_approvals boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.member_notification_preferences(
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 announcements boolean not null default true,
 direct_messages boolean not null default true,
 gameplay boolean not null default true,
 primary key(campaign_id,user_id)
);
create table public.notification_inbox(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('announcement','direct','initiative','turn','trade','approval')),
 title text not null check(char_length(title)<=160),
 body text not null default '' check(char_length(body)<=500),
 message_id uuid references public.campaign_messages(id) on delete cascade,
 source_key text,
 read_at timestamptz,
 created_at timestamptz not null default now(),
 unique(user_id,source_key)
);
create index notification_inbox_user_recent on public.notification_inbox(user_id,created_at desc);
create table public.notification_device_tokens(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 platform text not null check(platform in ('ios','android')),
 provider text not null check(provider in ('apns','fcm')),
 token text not null check(char_length(token) between 24 and 1024),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 unique(user_id,provider,token)
);
alter table public.campaign_messages enable row level security;
alter table public.campaign_message_recipients enable row level security;
alter table public.campaign_notification_settings enable row level security;
alter table public.member_notification_preferences enable row level security;
alter table public.notification_inbox enable row level security;
alter table public.notification_device_tokens enable row level security;
revoke all on public.campaign_messages,public.campaign_message_recipients,
 public.campaign_notification_settings,public.member_notification_preferences,public.notification_device_tokens from anon,authenticated;
revoke all on public.notification_inbox from anon,authenticated;
grant select on public.notification_inbox to authenticated;
create policy notification_owner_read on public.notification_inbox for select to authenticated
 using (user_id=(select auth.uid()));
-- Only notifications are Realtime published: all private message bodies stay out of the client publication.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notification_inbox') then
   alter publication supabase_realtime add table public.notification_inbox;
  end if;
 end if;
end $$;

create or replace function app_private.has_campaign_access(p_campaign uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and
 (exists(select 1 from public.campaigns c where c.id=p_campaign and c.owner_user_id=p_user)
 or exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=p_user and m.status='active'))
$$;
create or replace function app_private.notify_campaign_user(p_campaign uuid,p_user uuid,p_kind text,p_title text,p_body text,p_message uuid default null,p_source text default null)
returns void language plpgsql security definer set search_path='' as $$
declare allowed boolean:=true;
begin
 if p_user is null or not app_private.has_campaign_access(p_campaign,p_user) then return; end if;
 if p_kind in ('initiative','turn','trade','approval') then
  select coalesce((select gameplay from public.member_notification_preferences where campaign_id=p_campaign and user_id=p_user),true) into allowed;
 elsif p_kind='announcement' then
  select coalesce((select announcements from public.member_notification_preferences where campaign_id=p_campaign and user_id=p_user),true) into allowed;
 elsif p_kind='direct' then
  select coalesce((select direct_messages from public.member_notification_preferences where campaign_id=p_campaign and user_id=p_user),true) into allowed;
 end if;
 if not allowed then return; end if;
 insert into public.notification_inbox(campaign_id,user_id,kind,title,body,message_id,source_key)
 values(p_campaign,p_user,p_kind,left(p_title,160),left(p_body,500),p_message,p_source)
 on conflict(user_id,source_key) do nothing;
end $$;

create or replace function public.send_campaign_message(
 p_campaign uuid,p_audience text,p_body text,p_subject text default '',
 p_zone uuid default null,p_user uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare sender uuid:=auth.uid();gm boolean; rec record;msg uuid;n integer:=0; title text;
begin
 if sender is null or not app_private.has_campaign_access(p_campaign,sender) then raise exception 'Not authorized' using errcode='42501';end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 or char_length(coalesce(p_subject,''))>160
 then raise exception 'Invalid message length' using errcode='22023';end if;
 gm:=app_private.is_gm(p_campaign);
 if p_audience not in ('all','zone','direct') then raise exception 'Invalid audience' using errcode='22023';end if;
 if p_audience in ('all','zone') and not gm then raise exception 'GM required for announcements' using errcode='42501';end if;
 if p_audience='zone' and not exists(select 1 from public.campaign_zones where id=p_zone and campaign_id=p_campaign and active)
 then raise exception 'Zone unavailable' using errcode='22023';end if;
 if p_audience='direct' then
  if p_user is null or p_user=sender or not app_private.has_campaign_access(p_campaign,p_user)
   then raise exception 'Recipient unavailable' using errcode='22023';end if;
  if not coalesce((select allow_direct_messages from public.campaign_notification_settings where campaign_id=p_campaign),true)
   then raise exception 'Direct messaging disabled' using errcode='22023';end if;
  if not gm and not (exists(select 1 from public.campaigns where id=p_campaign and owner_user_id=p_user)
   or exists(select 1 from public.campaign_members where campaign_id=p_campaign and user_id=p_user and role='gm' and status='active'))
  then raise exception 'Players may message only campaign GMs' using errcode='42501';end if;
 end if;
 insert into public.campaign_messages(campaign_id,sender_user_id,audience,target_zone_id,target_user_id,subject,body)
 values(p_campaign,sender,p_audience,case when p_audience='zone' then p_zone end,
 case when p_audience='direct' then p_user end,coalesce(p_subject,''),btrim(p_body)) returning id into msg;
 insert into public.campaign_message_recipients(message_id,user_id) values(msg,sender);
 for rec in
  select distinct u.user_id from (
    select c.owner_user_id as user_id from public.campaigns c where c.id=p_campaign
    union all
    select m.user_id from public.campaign_members m where m.campaign_id=p_campaign and m.status='active'
  ) u
  where u.user_id<>sender and (
    (p_audience='all') or
    (p_audience='direct' and u.user_id=p_user) or
    (p_audience='zone' and exists(
      select 1 from public.characters c
      join public.campaign_members m on m.id=c.member_id
      join public.character_zone_assignments a on a.character_id=c.id
      where c.campaign_id=p_campaign and c.is_active and m.user_id=u.user_id and m.status='active' and a.zone_id=p_zone))
  )
 loop
  insert into public.campaign_message_recipients(message_id,user_id) values(msg,rec.user_id) on conflict do nothing;
  perform app_private.notify_campaign_user(p_campaign,rec.user_id,
   case when p_audience='direct' then 'direct' else 'announcement' end,
   case when p_audience='direct' then 'New direct message' else coalesce(nullif(btrim(p_subject),''),'GM announcement') end,
   btrim(p_body),msg,'message:'||msg::text);
  n:=n+1;
 end loop;
 return msg;
end $$;

create or replace function public.list_campaign_messages(p_campaign uuid,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.has_campaign_access(p_campaign,auth.uid()) then raise exception 'Not authorized' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'sender',x.sender_user_id,
 'sender_label',case when x.sender_user_id=(select auth.uid()) then 'You'
  when x.sender_user_id=(select owner_user_id from public.campaigns where id=p_campaign) then 'Campaign GM'
  when exists(select 1 from public.campaign_members where campaign_id=p_campaign and user_id=x.sender_user_id and role='gm' and status='active') then 'GM'
  else 'Player' end,
 'audience',x.audience,'subject',x.subject,'body',x.body,'created_at',x.created_at,
 'read_at',x.read_at) order by x.created_at desc,x.id desc)
 from (
  select m.*,r.read_at from public.campaign_messages m
  join public.campaign_message_recipients r on r.message_id=m.id and r.user_id=auth.uid()
  where m.campaign_id=p_campaign
  order by m.created_at desc,m.id desc limit least(greatest(coalesce(p_limit,50),1),100)
 ) x),'[]'::jsonb);
end $$;

create or replace function public.list_campaign_message_targets(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare gm boolean;
begin
 if auth.uid() is null or not app_private.has_campaign_access(p_campaign,auth.uid()) then raise exception 'Not authorized' using errcode='42501';end if;
 gm:=app_private.is_gm(p_campaign);
 return jsonb_build_object(
 'users',coalesce((select jsonb_agg(jsonb_build_object('id',x.user_id,'label',x.label) order by x.label)
 from (select distinct m.user_id,coalesce((select min(c.name) from public.characters c
 join public.campaign_members cm on cm.id=c.member_id
 where c.campaign_id=p_campaign and cm.user_id=m.user_id),case when m.role='gm' then 'Game Master' else 'Player' end) label
 from public.campaign_members m where m.campaign_id=p_campaign and m.status='active' and m.user_id<>auth.uid()
 and (gm or m.role='gm')
 union
 select c.owner_user_id,'Campaign Owner' from public.campaigns c
 where c.id=p_campaign and c.owner_user_id<>auth.uid()) x),'[]'::jsonb),
 'zones',case when gm then coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'name',z.name) order by z.name)
 from public.campaign_zones z where z.campaign_id=p_campaign and z.active),'[]'::jsonb)
 else '[]'::jsonb end,
 'is_gm',gm);
end $$;

create or replace function public.manage_campaign_notifications(
 p_campaign uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();gm boolean; v_id uuid;v_bool boolean;
begin
 if actor is null or not app_private.has_campaign_access(p_campaign,actor) then raise exception 'Not authorized' using errcode='42501';end if;
 gm:=app_private.is_gm(p_campaign);
 if p_action='read' then
  v_id:=nullif(p_payload->>'id','')::uuid;
  update public.notification_inbox set read_at=coalesce(read_at,now())
  where id=v_id and user_id=actor and campaign_id=p_campaign;
 elsif p_action='read_all' then
  update public.notification_inbox set read_at=now() where campaign_id=p_campaign and user_id=actor and read_at is null;
 elsif p_action='preferences' then
  insert into public.member_notification_preferences(campaign_id,user_id,announcements,direct_messages,gameplay)
  values(p_campaign,actor,coalesce((p_payload->>'announcements')::boolean,true),
   coalesce((p_payload->>'direct_messages')::boolean,true),coalesce((p_payload->>'gameplay')::boolean,true))
  on conflict(campaign_id,user_id) do update set announcements=excluded.announcements,
   direct_messages=excluded.direct_messages,gameplay=excluded.gameplay;
 elsif p_action='settings' then
  if not gm then raise exception 'GM required' using errcode='42501';end if;
  insert into public.campaign_notification_settings(campaign_id,allow_direct_messages,alerts_initiative,alerts_trades,alerts_approvals)
  values(p_campaign,coalesce((p_payload->>'allow_direct_messages')::boolean,true),
   coalesce((p_payload->>'alerts_initiative')::boolean,true),
   coalesce((p_payload->>'alerts_trades')::boolean,true),coalesce((p_payload->>'alerts_approvals')::boolean,true))
  on conflict(campaign_id) do update set allow_direct_messages=excluded.allow_direct_messages,
   alerts_initiative=excluded.alerts_initiative,alerts_trades=excluded.alerts_trades,
   alerts_approvals=excluded.alerts_approvals,updated_at=now();
 elsif p_action='message_read' then
  v_id:=nullif(p_payload->>'id','')::uuid;
  update public.campaign_message_recipients r set read_at=coalesce(read_at,now())
  from public.campaign_messages m where r.message_id=v_id and m.id=r.message_id and m.campaign_id=p_campaign and r.user_id=actor;
 else raise exception 'Unknown action' using errcode='22023';end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.get_campaign_notification_state(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not app_private.has_campaign_access(p_campaign,actor) then raise exception 'Not authorized' using errcode='42501';end if;
 return jsonb_build_object(
 'inbox',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'title',x.title,'body',x.body,
  'message_id',x.message_id,'read_at',x.read_at,'created_at',x.created_at) order by x.created_at desc,x.id desc)
  from (select * from public.notification_inbox where campaign_id=p_campaign and user_id=actor order by created_at desc,id desc limit 100) x),'[]'::jsonb),
 'unread',(select count(*) from public.notification_inbox where campaign_id=p_campaign and user_id=actor and read_at is null),
 'preferences',coalesce((select jsonb_build_object('announcements',announcements,'direct_messages',direct_messages,'gameplay',gameplay)
  from public.member_notification_preferences where campaign_id=p_campaign and user_id=actor),
  '{"announcements":true,"direct_messages":true,"gameplay":true}'::jsonb),
 'settings',case when app_private.is_gm(p_campaign) then
 coalesce((select jsonb_build_object('allow_direct_messages',allow_direct_messages,
  'alerts_initiative',alerts_initiative,'alerts_trades',alerts_trades,'alerts_approvals',alerts_approvals)
 from public.campaign_notification_settings where campaign_id=p_campaign),
 '{"allow_direct_messages":true,"alerts_initiative":true,"alerts_trades":true,"alerts_approvals":true}'::jsonb)
 else '{}'::jsonb end);
end $$;

create or replace function public.register_notification_device(
 p_platform text,p_provider text,p_token text,p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Auth required' using errcode='42501';end if;
 if p_platform not in ('ios','android') or p_provider not in ('apns','fcm')
 or char_length(coalesce(p_token,'')) not between 24 and 1024 then raise exception 'Invalid device' using errcode='22023';end if;
 insert into public.notification_device_tokens(user_id,platform,provider,token,enabled)
 values(auth.uid(),p_platform,p_provider,p_token,p_enabled)
 on conflict(user_id,provider,token) do update set enabled=excluded.enabled;
 return jsonb_build_object('registered',true);
end $$;

revoke all on function public.send_campaign_message(uuid,text,text,text,uuid,uuid),
 public.list_campaign_messages(uuid,integer),public.list_campaign_message_targets(uuid),
 public.manage_campaign_notifications(uuid,text,jsonb),public.get_campaign_notification_state(uuid),
 public.register_notification_device(text,text,text,boolean) from public,anon;
grant execute on function public.send_campaign_message(uuid,text,text,text,uuid,uuid),
 public.list_campaign_messages(uuid,integer),public.list_campaign_message_targets(uuid),
 public.manage_campaign_notifications(uuid,text,jsonb),public.get_campaign_notification_state(uuid),
 public.register_notification_device(text,text,text,boolean) to authenticated;
revoke all on function app_private.has_campaign_access(uuid,uuid),app_private.notify_campaign_user(uuid,uuid,text,text,text,uuid,text) from public,anon,authenticated;
