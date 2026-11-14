CREATE OR REPLACE FUNCTION public.send_campaign_message(p_campaign uuid, p_audience text, p_body text, p_subject text DEFAULT ''::text, p_zone uuid DEFAULT NULL::uuid, p_user uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 -- A GM may also have a player character in this campaign. Keep that character's
 -- player-facing notification even when the GM and player use the same login.
 if p_audience in ('all','zone') and exists(
  select 1 from public.characters c
  join public.campaign_members cm on cm.id=c.member_id
  left join public.character_zone_assignments a on a.character_id=c.id
  where c.campaign_id=p_campaign and c.is_active and cm.user_id=sender and cm.status='active'
   and (p_audience='all' or a.zone_id=p_zone)
 ) then
  perform app_private.notify_campaign_user(p_campaign,sender,'announcement',
   coalesce(nullif(btrim(p_subject),''),'GM announcement'),btrim(p_body),
   msg,'message:'||msg::text);
 end if;
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
end $function$
;

-- Restore notifications for previously delivered announcements to dual-role GM/players.
insert into public.notification_inbox(campaign_id,user_id,kind,title,body,message_id,source_key,created_at)
select m.campaign_id,m.sender_user_id,'announcement',
 coalesce(nullif(btrim(m.subject),''),'GM announcement'),left(m.body,500),
 m.id,'message:'||m.id::text,m.created_at
from public.campaign_messages m
where m.audience in ('all','zone')
 and exists(
 select 1 from public.campaign_message_recipients r where r.message_id=m.id and r.user_id=m.sender_user_id)
 and exists(
 select 1 from public.characters c
 join public.campaign_members cm on cm.id=c.member_id
 left join public.character_zone_assignments a on a.character_id=c.id
 where c.campaign_id=m.campaign_id and c.is_active
 and cm.user_id=m.sender_user_id and cm.status='active'
 and (m.audience='all' or a.zone_id=m.target_zone_id))
 and coalesce((select announcements from public.member_notification_preferences pref
 where pref.campaign_id=m.campaign_id and pref.user_id=m.sender_user_id),true)
on conflict(user_id,source_key) do nothing;