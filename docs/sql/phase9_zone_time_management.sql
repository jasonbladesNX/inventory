-- Phase 9 live migration snapshot; applied in Supabase as phase9_zone_time_management
-- and phase9_fix_zone_action_result. Reapply only to a fresh compatible schema.
create table if not exists public.campaign_zones(
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 100),active boolean not null default true,
 turn_number bigint not null default 0 check(turn_number between 0 and 1000000000),
 version bigint not null default 0,created_at timestamptz not null default now(), unique(id,campaign_id));
create unique index if not exists campaign_zones_name_unique on public.campaign_zones(campaign_id,lower(btrim(name)));
create table if not exists public.character_zone_assignments(
 character_id uuid primary key references public.characters(id) on delete cascade,
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 zone_id uuid not null,assigned_at timestamptz not null default now(),
 foreign key(zone_id,campaign_id) references public.campaign_zones(id,campaign_id) on delete restrict);
create index if not exists character_zone_by_zone on public.character_zone_assignments(zone_id);
create table if not exists public.zone_time_events(
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 zone_id uuid not null,actor_user_id uuid,
 action text not null check(action in ('advance','correct','undo','zone_create','zone_rename','zone_disable','zone_enable','character_move')),
 request_id uuid,turn_before bigint,turn_after bigint,before_data jsonb,after_data jsonb,
 reason text,created_at timestamptz not null default now(),
 foreign key(zone_id,campaign_id) references public.campaign_zones(id,campaign_id) on delete restrict,unique(zone_id,request_id));
create index if not exists zone_time_events_recent on public.zone_time_events(zone_id,created_at desc);
alter table public.campaign_zones enable row level security;
alter table public.character_zone_assignments enable row level security;
alter table public.zone_time_events enable row level security;
revoke all on public.campaign_zones,public.character_zone_assignments,public.zone_time_events from anon,authenticated;
insert into public.campaign_zones(campaign_id,name)
 select c.id,'Default Zone' from public.campaigns c where not exists(select 1 from public.campaign_zones z where z.campaign_id=c.id);
insert into public.character_zone_assignments(character_id,campaign_id,zone_id)
 select c.id,c.campaign_id,z.id from public.characters c
 join lateral(select id from public.campaign_zones z where z.campaign_id=c.campaign_id and z.active order by z.created_at,z.id limit 1) z on true
 where not exists(select 1 from public.character_zone_assignments a where a.character_id=c.id);

CREATE OR REPLACE FUNCTION public.list_campaign_zone_state(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid();
begin
 if v_user is null or not(app_private.is_gm(p_campaign) or exists(
 select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=v_user and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501'; end if;
 return jsonb_build_object(
 'zones',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'active',z.active,'turn',z.turn_number,'version',z.version) order by z.created_at,z.id) from public.campaign_zones z where z.campaign_id=p_campaign),'[]'::jsonb),
 'characters',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'zone_id',a.zone_id) order by c.name) from public.characters c join public.character_zone_assignments a on a.character_id=c.id where c.campaign_id=p_campaign and c.is_active and (app_private.is_gm(p_campaign) or exists(select 1 from public.campaign_members m where m.id=c.member_id and m.user_id=v_user and m.status='active'))),'[]'::jsonb),
 'history',case when app_private.is_gm(p_campaign) then coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'zone_id',e.zone_id,'action',e.action,'turn_before',e.turn_before,'turn_after',e.turn_after,'reason',e.reason,'created_at',e.created_at) order by e.created_at desc) from (select * from public.zone_time_events where campaign_id=p_campaign order by created_at desc limit 50) e),'[]'::jsonb) else '[]'::jsonb end
 );
end $function$
;

CREATE OR REPLACE FUNCTION public.get_character_zone_state(p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid; v_member uuid; v_zone record;
begin
 select c.campaign_id,c.member_id into v_campaign,v_member from public.characters c where c.id=p_character and c.is_active;
 if v_campaign is null or not (app_private.is_gm(v_campaign) or exists(select 1 from public.campaign_members m where m.id=v_member and m.user_id=auth.uid() and m.status='active')) then
 raise exception 'Not authorized' using errcode='42501'; end if;
 select z.* into v_zone from public.character_zone_assignments a join public.campaign_zones z on z.id=a.zone_id where a.character_id=p_character;
 if v_zone.id is null then raise exception 'Character zone missing' using errcode='22023'; end if;
 return jsonb_build_object('id',v_zone.id,'name',v_zone.name,'active',v_zone.active,'turn',v_zone.turn_number,'version',v_zone.version);
end $function$
;

CREATE OR REPLACE FUNCTION public.manage_campaign_zone(p_campaign uuid, p_action text, p_zone uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_character uuid DEFAULT NULL::uuid, p_target uuid DEFAULT NULL::uuid, p_turn bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare z public.campaign_zones%rowtype; target public.campaign_zones%rowtype;
 v_char record; v_new jsonb; v_old jsonb; v_before jsonb:='{}'::jsonb; v_after jsonb:='{}'::jsonb;
 v_temp jsonb; v_entry jsonb; v_out jsonb; v_key text; v_rem int;
 v_turn bigint; v_existing record; v_evt record; v_saved jsonb; v_now jsonb;
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM authorization required' using errcode='42501'; end if;
 if p_action not in ('create','rename','disable','enable','move','advance','correct','undo') then raise exception 'Invalid zone action' using errcode='22023'; end if;
 if p_action='create' then
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'Zone name required (max 100 characters)' using errcode='22023'; end if;
  insert into public.campaign_zones(campaign_id,name) values(p_campaign,btrim(p_name)) returning * into z;
  insert into public.zone_time_events(campaign_id,zone_id,actor_user_id,action,reason) values(p_campaign,z.id,auth.uid(),'zone_create',p_reason);
  return jsonb_build_object('zone_id',z.id,'turn',z.turn_number);
 end if;
 select * into z from public.campaign_zones where id=p_zone and campaign_id=p_campaign for update;
 if z.id is null then raise exception 'Zone not found in campaign' using errcode='22023'; end if;
 if p_action in ('rename','disable','enable') then
  if p_action='rename' then
   if char_length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'Invalid zone name' using errcode='22023'; end if;
   update public.campaign_zones set name=btrim(p_name),version=version+1 where id=z.id;
  elsif p_action='disable' then
   if exists(select 1 from public.character_zone_assignments where zone_id=z.id) then raise exception 'Move characters before disabling this zone' using errcode='22023'; end if;
   if not exists(select 1 from public.campaign_zones where campaign_id=p_campaign and active and id<>z.id) then raise exception 'Cannot disable the last active zone' using errcode='22023'; end if;
   update public.campaign_zones set active=false,version=version+1 where id=z.id;
  else
   update public.campaign_zones set active=true,version=version+1 where id=z.id;
  end if;
  insert into public.zone_time_events(campaign_id,zone_id,actor_user_id,action,reason)
  values(p_campaign,z.id,auth.uid(),'zone_'||p_action,p_reason);
 elsif p_action='move' then
  select * into target from public.campaign_zones where id=p_target and campaign_id=p_campaign and active for update;
  if target.id is null then raise exception 'Target zone unavailable' using errcode='22023'; end if;
  select c.id,c.campaign_id,a.zone_id into v_char from public.characters c join public.character_zone_assignments a on a.character_id=c.id
  where c.id=p_character and c.campaign_id=p_campaign and c.is_active for update of c,a;
  if v_char.id is null then raise exception 'Active character not in campaign' using errcode='22023'; end if;
  update public.character_zone_assignments set zone_id=target.id,assigned_at=now() where character_id=p_character;
  insert into public.zone_time_events(campaign_id,zone_id,actor_user_id,action,reason,before_data,after_data)
  values(p_campaign,target.id,auth.uid(),'character_move',p_reason,jsonb_build_object('character',p_character,'zone',v_char.zone_id),jsonb_build_object('character',p_character,'zone',target.id));
 elsif p_action='advance' then
  if not z.active then raise exception 'Inactive zone' using errcode='22023'; end if;
  if p_request is null then raise exception 'Request ID required for safe advancement' using errcode='22023'; end if;
  select * into v_existing from public.zone_time_events where zone_id=z.id and request_id=p_request;
  if v_existing.id is not null then
   if v_existing.action<>'advance' then raise exception 'Request ID reused' using errcode='22023'; end if;
   return jsonb_build_object('zone_id',z.id,'turn',v_existing.turn_after,'duplicate',true);
  end if;
  if z.turn_number>=1000000000 then raise exception 'Turn limit reached' using errcode='22023'; end if;
  for v_char in select c.id,c.sheet_data from public.characters c join public.character_zone_assignments a on a.character_id=c.id
   where a.zone_id=z.id and c.is_active order by c.id for update of c loop
   v_old:=v_char.sheet_data; v_new:=v_old;
   v_before:=v_before||jsonb_build_object(v_char.id,v_old);
   v_temp:=v_old->'temporary_hp_duration';
   if v_temp->>'unit'='turn' and coalesce((v_old->>'temporary_hp')::int,0)>0 then
    v_rem:=coalesce((v_temp->>'remaining')::int,0)-1;
    if v_rem<=0 then v_new:=jsonb_set(v_new,'{temporary_hp}','0'::jsonb,true)-'temporary_hp_duration';
    else v_new:=jsonb_set(v_new,'{temporary_hp_duration,remaining}',to_jsonb(v_rem),true); end if;
   end if;
   foreach v_key in array array['conditions','timed_effects'] loop
    v_out:='[]'::jsonb;
    for v_entry in select value from jsonb_array_elements(coalesce(v_old->v_key,'[]'::jsonb)) loop
     if v_entry->>'unit'='turn' and v_entry->>'remaining' is not null then
      v_rem:=(v_entry->>'remaining')::int-1;
      if v_rem>0 then v_out:=v_out||jsonb_build_array(jsonb_set(v_entry,'{remaining}',to_jsonb(v_rem),true)); end if;
     else v_out:=v_out||jsonb_build_array(v_entry); end if;
    end loop;
    v_new:=jsonb_set(v_new,array[v_key],v_out,true);
   end loop;
   update public.characters set sheet_data=v_new where id=v_char.id;
   v_after:=v_after||jsonb_build_object(v_char.id,v_new);
  end loop;
  v_turn:=z.turn_number+1;
  update public.campaign_zones set turn_number=v_turn,version=version+1 where id=z.id;
  insert into public.zone_time_events(campaign_id,zone_id,actor_user_id,action,request_id,turn_before,turn_after,before_data,after_data,reason)
  values(p_campaign,z.id,auth.uid(),'advance',p_request,z.turn_number,v_turn,v_before,v_after,p_reason);
 elsif p_action='correct' then
  if p_turn is null or p_turn not between 0 and 1000000000 then raise exception 'Enter a valid turn' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Correction reason required' using errcode='22023'; end if;
  update public.campaign_zones set turn_number=p_turn,version=version+1 where id=z.id;
  insert into public.zone_time_events(campaign_id,zone_id,actor_user_id,action,turn_before,turn_after,reason)
  values(p_campaign,z.id,auth.uid(),'correct',z.turn_number,p_turn,p_reason);
 elsif p_action='undo' then
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Undo reason required' using errcode='22023'; end if;
  select * into v_evt from public.zone_time_events where zone_id=z.id and action in ('advance','correct','undo') order by created_at desc,id desc limit 1 for update;
  if v_evt.action<>'advance' or v_evt.turn_after<>z.turn_number then raise exception 'Only latest advancement can be undone; use a correction for other cases' using errcode='22023'; end if;
  for v_char in select c.id,c.sheet_data from public.characters c join public.character_zone_assignments a on a.character_id=c.id where a.zone_id=z.id and c.is_active order by c.id for update of c loop
   v_saved:=v_evt.after_data->(v_char.id::text);
   if v_saved is null or v_char.sheet_data is distinct from v_saved then raise exception 'Character changed after advancement. Undo blocked; use a documented correction' using errcode='40001'; end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(coalesce(v_evt.after_data,'{}'::jsonb)) k
  where not exists(select 1 from public.character_zone_assignments a join public.characters c on c.id=a.character_id
  where a.zone_id=z.id and c.id::text=k and c.is_active)) then raise exception 'Zone roster changed after advancement. Undo blocked' using errcode='40001'; end if;
  for v_char in select c.id from public.characters c join public.character_zone_assignments a on a.character_id=c.id where a.zone_id=z.id and c.is_active loop
   update public.characters set sheet_data=v_evt.before_data->(v_char.id::text) where id=v_char.id;
  end loop;
  v_turn:=v_evt.turn_before;
  update public.campaign_zones set turn_number=v_evt.turn_before,version=version+1 where id=z.id;
  insert into public.zone_time_events(campaign_id,zone_id,actor_user_id,action,turn_before,turn_after,reason)
  values(p_campaign,z.id,auth.uid(),'undo',z.turn_number,v_evt.turn_before,p_reason);
 end if;
 return jsonb_build_object('zone_id',z.id,'action',p_action,'ok',true,'turn',coalesce(v_turn,p_turn,z.turn_number));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.ensure_zone_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_zone uuid;
begin
 select id into v_zone from public.campaign_zones where campaign_id=new.campaign_id and active order by created_at,id limit 1;
 if v_zone is null then
  insert into public.campaign_zones(campaign_id,name) values(new.campaign_id,'Default Zone') returning id into v_zone;
 end if;
 insert into public.character_zone_assignments(character_id,campaign_id,zone_id) values(new.id,new.campaign_id,v_zone);
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.ensure_campaign_zone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 insert into public.campaign_zones(campaign_id,name) values(new.id,'Default Zone');
 return new;
end $function$
;

drop trigger if exists new_character_zone on public.characters;
create trigger new_character_zone after insert on public.characters for each row execute function app_private.ensure_zone_assignment();
drop trigger if exists new_campaign_default_zone on public.campaigns;
create trigger new_campaign_default_zone after insert on public.campaigns for each row execute function app_private.ensure_campaign_zone();
revoke all on function public.list_campaign_zone_state(uuid),
 public.get_character_zone_state(uuid),
 public.manage_campaign_zone(uuid,text,uuid,text,uuid,uuid,bigint,text,uuid) from public,anon;
grant execute on function public.list_campaign_zone_state(uuid),
 public.get_character_zone_state(uuid),
 public.manage_campaign_zone(uuid,text,uuid,text,uuid,uuid,bigint,text,uuid) to authenticated;
