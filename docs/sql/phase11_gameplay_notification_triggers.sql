
create or replace function app_private.notify_initiative_event() returns trigger language plpgsql security definer set search_path='' as $$
declare settings record; receiver record; msg text; v_kind text;
begin
 if new.action not in ('request','next','next_with_zone_turn','start') then return new;end if;
 if not coalesce((select alerts_initiative from public.campaign_notification_settings where campaign_id=new.campaign_id),true) then return new;end if;
 if new.action='request' then
  for receiver in
   select distinct m.user_id from public.zone_initiative_entries e
   join public.characters c on c.id=e.character_id
   join public.campaign_members m on m.id=c.member_id
   where e.zone_id=new.zone_id and m.status='active'
  loop
   perform app_private.notify_campaign_user(new.campaign_id,receiver.user_id,'initiative',
   'Roll initiative','Your GM has requested a d20 initiative roll.',null,'initiative:request:'||new.id::text||':'||receiver.user_id::text);
  end loop;
 elsif new.action in ('next','next_with_zone_turn','start') then
  select m.user_id into receiver from public.zone_initiative_sessions s
   join public.zone_initiative_entries e on e.zone_id=s.zone_id and e.position=s.active_position
   join public.characters c on c.id=e.character_id
   join public.campaign_members m on m.id=c.member_id and m.status='active'
   where s.zone_id=new.zone_id;
  if receiver.user_id is not null then
   perform app_private.notify_campaign_user(new.campaign_id,receiver.user_id,'turn',
    'Your turn','You are the active participant in your zone.',null,'initiative:turn:'||new.id::text);
  end if;
 end if;
 return new;
end $$;
drop trigger if exists phase11_initiative_notifications on public.zone_initiative_events;
create trigger phase11_initiative_notifications after insert on public.zone_initiative_events
for each row execute function app_private.notify_initiative_event();

create or replace function app_private.notify_trade_change() returns trigger language plpgsql security definer set search_path='' as $$
declare receiver record; participant uuid;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new;end if;
 if not coalesce((select alerts_trades from public.campaign_notification_settings where campaign_id=new.campaign_id),true) then return new;end if;
 for receiver in
  select distinct m.user_id from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id in(new.proposer_character_id,new.recipient_character_id)
    and c.campaign_id=new.campaign_id and m.status='active'
 loop
  perform app_private.notify_campaign_user(new.campaign_id,receiver.user_id,'trade',
    'Trade updated','A campaign trade is now '||coalesce(new.status,'updated')||'.',null,
    'trade:'||new.id::text||':'||new.status||':'||receiver.user_id::text);
 end loop;
 return new;
end $$;
drop trigger if exists phase11_trade_notifications on public.trade_offers;
create trigger phase11_trade_notifications after insert or update of status on public.trade_offers
for each row execute function app_private.notify_trade_change();

create or replace function app_private.notify_approval_change() returns trigger language plpgsql security definer set search_path='' as $$
declare receiver record;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new;end if;
 if not coalesce((select alerts_approvals from public.campaign_notification_settings where campaign_id=new.campaign_id),true) then return new;end if;
 if new.status='pending' then
  for receiver in
   select distinct user_id from (
    select owner_user_id as user_id from public.campaigns where id=new.campaign_id
    union all select user_id from public.campaign_members where campaign_id=new.campaign_id and role='gm' and status='active'
   ) staff
  loop
   perform app_private.notify_campaign_user(new.campaign_id,receiver.user_id,'approval',
    'Approval requested','A campaign request needs GM attention.',null,'approval:'||new.id::text||':pending:'||receiver.user_id::text);
  end loop;
 elsif new.requested_by is not null then
  perform app_private.notify_campaign_user(new.campaign_id,new.requested_by,'approval',
   'Approval updated','Your request is now '||coalesce(new.status,'updated')||'.',null,
   'approval:'||new.id::text||':'||new.status);
 end if;
 return new;
end $$;
drop trigger if exists phase11_approval_notifications on public.approval_requests;
create trigger phase11_approval_notifications after insert or update of status on public.approval_requests
for each row execute function app_private.notify_approval_change();
revoke all on function app_private.notify_initiative_event(),app_private.notify_trade_change(),app_private.notify_approval_change() from public,anon,authenticated;
