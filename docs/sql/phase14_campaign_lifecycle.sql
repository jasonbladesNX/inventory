
create table public.campaign_archive_snapshots(
 campaign_id uuid primary key references public.campaigns(id) on delete cascade,
 saved_settings jsonb not null,
 archived_at timestamptz not null default now(),
 archived_by uuid not null references auth.users(id)
);
alter table public.campaign_archive_snapshots enable row level security;
revoke all on public.campaign_archive_snapshots from public,anon,authenticated;

create or replace function public.manage_campaign_lifecycle(
 p_campaign uuid,p_action text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();campaign public.campaigns%rowtype;saved jsonb;
begin
 select * into campaign from public.campaigns where id=p_campaign for update;
 if actor is null or campaign.id is null or campaign.owner_user_id<>actor then
  raise exception 'Only the campaign owner may change lifecycle state' using errcode='42501';end if;
 if p_action='archive' then
  if campaign.status<>'active' then raise exception 'Campaign is not active' using errcode='22023';end if;
  insert into public.campaign_archive_snapshots(campaign_id,saved_settings,archived_by)
   values(p_campaign,campaign.settings,actor)
  on conflict(campaign_id) do update set saved_settings=excluded.saved_settings,archived_at=now(),archived_by=excluded.archived_by;
  update public.campaigns set status='archived',
   settings=jsonb_set(jsonb_set(campaign.settings,'{allow_trades}','false'::jsonb,true),'{allow_shops}','false'::jsonb,true)
   where id=p_campaign;
  update public.campaign_session_state set is_running=false,updated_at=now(),updated_by=actor where campaign_id=p_campaign;
 elsif p_action='restore' then
  if campaign.status<>'archived' then raise exception 'Campaign is not archived' using errcode='22023';end if;
  select saved_settings into saved from public.campaign_archive_snapshots where campaign_id=p_campaign;
  update public.campaigns set status='active',settings=coalesce(saved,campaign.settings) where id=p_campaign;
 else raise exception 'Invalid lifecycle action' using errcode='22023';end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,
  before_state,after_state,reason)
 values(p_campaign,actor,'campaign_admin_'||p_action,'campaign',p_campaign,
 jsonb_build_object('status',campaign.status,'settings',campaign.settings),
 jsonb_build_object('status',case when p_action='archive' then 'archived' else 'active' end),coalesce(p_reason,''));
 return jsonb_build_object('ok',true,'status',case when p_action='archive' then 'archived' else 'active' end);
end $$;
revoke all on function public.manage_campaign_lifecycle(uuid,text,text) from public,anon;
grant execute on function public.manage_campaign_lifecycle(uuid,text,text) to authenticated;
