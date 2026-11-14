
create table public.character_initiative_preferences(
 character_id uuid primary key references public.characters(id) on delete cascade,
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 modifier integer not null default 0 check(modifier between -100 and 100),
 updated_at timestamptz not null default now());
create table public.zone_initiative_sessions(
 zone_id uuid primary key,campaign_id uuid not null,
 phase text not null default 'rolling' check(phase in ('rolling','active','complete')),
 round_number bigint not null default 0 check(round_number between 0 and 1000000000),
 active_position integer not null default 0 check(active_position>=0),
 version bigint not null default 0,updated_at timestamptz not null default now(),
 foreign key(zone_id,campaign_id) references public.campaign_zones(id,campaign_id) on delete cascade);
create table public.zone_initiative_entries(
 zone_id uuid not null references public.zone_initiative_sessions(zone_id) on delete cascade,
 character_id uuid not null references public.characters(id) on delete cascade,
 modifier integer not null check(modifier between -100 and 100),
 roll integer check(roll between 1 and 20),score integer check(score between -1000 and 1000),
 position integer check(position>=1),
 primary key(zone_id,character_id));
create unique index zone_initiative_position_unique on public.zone_initiative_entries(zone_id,position) where position is not null;
create table public.zone_initiative_events(
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.campaigns(id) on delete cascade,
 zone_id uuid not null,actor_user_id uuid,action text not null,request_id uuid,
 details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),
 foreign key(zone_id,campaign_id) references public.campaign_zones(id,campaign_id) on delete cascade,
 unique(zone_id,request_id));
create index zone_initiative_event_recent on public.zone_initiative_events(zone_id,created_at desc);
alter table public.character_initiative_preferences enable row level security;
alter table public.zone_initiative_sessions enable row level security;
alter table public.zone_initiative_entries enable row level security;
alter table public.zone_initiative_events enable row level security;
revoke all on public.character_initiative_preferences,public.zone_initiative_sessions,public.zone_initiative_entries,public.zone_initiative_events from anon,authenticated;

create or replace function public.set_character_initiative_modifier(p_character uuid,p_modifier integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_campaign uuid;v_member uuid;
begin
 select campaign_id,member_id into v_campaign,v_member from public.characters where id=p_character and is_active;
 if v_campaign is null or auth.uid() is null or not(app_private.is_gm(v_campaign)
 or exists(select 1 from public.campaign_members m where m.id=v_member and m.user_id=auth.uid() and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 if p_modifier is null or p_modifier not between -100 and 100 then raise exception 'Modifier out of range' using errcode='22023';end if;
 insert into public.character_initiative_preferences(character_id,campaign_id,modifier)
 values(p_character,v_campaign,p_modifier)
 on conflict(character_id) do update set modifier=excluded.modifier,updated_at=now();
 return jsonb_build_object('modifier',p_modifier);
end $$;

create or replace function public.get_character_initiative(p_character uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c record; z record; s record;e record;v_current text;
begin
 select campaign_id,member_id into c from public.characters where id=p_character and is_active;
 if c.campaign_id is null or auth.uid() is null or not(app_private.is_gm(c.campaign_id)
 or exists(select 1 from public.campaign_members m where m.id=c.member_id and m.user_id=auth.uid() and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 select cz.id,cz.name into z from public.character_zone_assignments a
 join public.campaign_zones cz on cz.id=a.zone_id where a.character_id=p_character;
 if z.id is null then raise exception 'Missing zone' using errcode='22023';end if;
 select * into s from public.zone_initiative_sessions where zone_id=z.id;
 select * into e from public.zone_initiative_entries where zone_id=z.id and character_id=p_character;
 select c2.name into v_current from public.zone_initiative_entries ie
 join public.characters c2 on c2.id=ie.character_id
 where ie.zone_id=z.id and ie.position=s.active_position and s.phase='active';
 return jsonb_build_object('zone_id',z.id,'zone_name',z.name,'phase',coalesce(s.phase,'none'),
 'round',coalesce(s.round_number,0),'active_position',coalesce(s.active_position,0),
 'active_character',v_current,'my_modifier',coalesce((select modifier from public.character_initiative_preferences where character_id=p_character),0),
 'my_roll',e.roll,'my_score',e.score,'my_position',e.position,
 'participant_count',(select count(*) from public.zone_initiative_entries where zone_id=z.id),
 'ready_count',(select count(*) from public.zone_initiative_entries where zone_id=z.id and roll is not null));
end $$;

create or replace function public.get_zone_initiative(p_campaign uuid,p_zone uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
 if v_user is null or not app_private.is_gm(p_campaign)
 or not exists(select 1 from public.campaign_zones where id=p_zone and campaign_id=p_campaign)
 then raise exception 'GM authorization required' using errcode='42501';end if;
 return jsonb_build_object('phase',coalesce((select phase from public.zone_initiative_sessions where zone_id=p_zone),'none'),
 'round',coalesce((select round_number from public.zone_initiative_sessions where zone_id=p_zone),0),
 'active_position',coalesce((select active_position from public.zone_initiative_sessions where zone_id=p_zone),0),
 'entries',coalesce((select jsonb_agg(jsonb_build_object('character_id',e.character_id,'name',c.name,
  'modifier',e.modifier,'roll',e.roll,'score',e.score,'position',e.position)
  order by e.position nulls last,e.score desc nulls last,c.name,c.id)
  from public.zone_initiative_entries e join public.characters c on c.id=e.character_id
  where e.zone_id=p_zone),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,'created_at',ev.created_at,
    'details',ev.details - 'effect_snapshot_before' - 'effect_snapshot_after')
    order by ev.created_at desc,ev.id desc)
   from(select * from public.zone_initiative_events where zone_id=p_zone order by created_at desc,id desc limit 30) ev),'[]'::jsonb));
end $$;

create or replace function public.manage_zone_initiative(
 p_campaign uuid,p_zone uuid,p_action text,p_character uuid default null,
 p_roll integer default null,p_score integer default null,p_position integer default null,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare z public.campaign_zones%rowtype;s public.zone_initiative_sessions%rowtype;
 v_actor uuid:=auth.uid();v_gm boolean;v_char record;v_count integer;v_ready integer;
 v_old_position integer;v_new_position integer;v_round bigint;v_event record;v_result jsonb;
 v_sheet jsonb;v_before_sheet jsonb;v_item jsonb;v_out jsonb;v_temp jsonb;
 v_key text;v_rem integer;v_before jsonb:='{}'::jsonb;v_after jsonb:='{}'::jsonb;
 v_order uuid[];v_other uuid;v_i integer;v_target integer;
begin
 if v_actor is null or p_action not in ('request','roll','start','adjust','reorder','next','close') then
 raise exception 'Invalid initiative action' using errcode='42501';end if;
 v_gm:=app_private.is_gm(p_campaign);
 if p_action<>'roll' and not v_gm then raise exception 'GM required' using errcode='42501';end if;
 select * into z from public.campaign_zones where id=p_zone and campaign_id=p_campaign for update;
 if z.id is null or not z.active then raise exception 'Active zone required' using errcode='22023';end if;
 if p_action<>'roll' and p_request is null then raise exception 'Request ID required' using errcode='22023';end if;
 if p_request is not null then
 select * into v_event from public.zone_initiative_events where zone_id=p_zone and request_id=p_request;
 if v_event.id is not null then
  if v_event.action<>p_action then raise exception 'Request ID reused' using errcode='22023';end if;
  return jsonb_build_object('duplicate',true,'action',p_action,'zone_id',p_zone);
 end if;end if;
 select * into s from public.zone_initiative_sessions where zone_id=p_zone for update;
 if p_action='request' then
  insert into public.zone_initiative_sessions(zone_id,campaign_id,phase,round_number,active_position,version)
   values(p_zone,p_campaign,'rolling',0,0,0)
   on conflict(zone_id) do update set phase='rolling',round_number=0,active_position=0,version=public.zone_initiative_sessions.version+1,updated_at=now();
  delete from public.zone_initiative_entries where zone_id=p_zone;
  insert into public.zone_initiative_entries(zone_id,character_id,modifier)
   select p_zone,c.id,coalesce(pref.modifier,0) from public.characters c
   join public.character_zone_assignments a on a.character_id=c.id and a.zone_id=p_zone
   left join public.character_initiative_preferences pref on pref.character_id=c.id
   where c.campaign_id=p_campaign and c.is_active;
  select count(*) into v_count from public.zone_initiative_entries where zone_id=p_zone;
  if v_count=0 then raise exception 'Empty zone' using errcode='22023';end if;
  v_result:=jsonb_build_object('participants',v_count);
 elsif p_action='roll' then
  if s.phase is distinct from 'rolling' then raise exception 'No roll request' using errcode='22023';end if;
  if p_roll is null or p_roll not between 1 and 20 then raise exception 'd20 roll must be 1–20' using errcode='22023';end if;
  select c.id into v_char from public.characters c
   join public.zone_initiative_entries e on e.character_id=c.id
   join public.character_zone_assignments a on a.character_id=c.id and a.zone_id=e.zone_id
   join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=p_campaign and c.is_active and e.zone_id=p_zone
   and (v_gm or (m.user_id=v_actor and m.status='active')) for update of c;
  if v_char.id is null then raise exception 'Character not in zone or not authorized' using errcode='42501';end if;
  update public.zone_initiative_entries set roll=p_roll,score=p_roll+modifier where zone_id=p_zone and character_id=p_character;
  v_result:=jsonb_build_object('character_id',p_character,'roll',p_roll);
 elsif p_action='start' then
  if s.phase is distinct from 'rolling' then raise exception 'Request rolls first' using errcode='22023';end if;
  select count(*),count(roll) into v_count,v_ready from public.zone_initiative_entries where zone_id=p_zone;
  if v_count=0 or v_ready<>v_count then raise exception 'Awaiting all rolls' using errcode='22023';end if;
  if (select count(*) from public.characters c join public.character_zone_assignments a on a.character_id=c.id where a.zone_id=p_zone and c.is_active)<>v_count
   or exists(select 1 from public.zone_initiative_entries e left join public.character_zone_assignments a on a.character_id=e.character_id
    where e.zone_id=p_zone and a.zone_id is distinct from p_zone) then raise exception 'Roster changed; request fresh rolls' using errcode='40001';end if;
  -- Null all positions before setting sorted ranks to satisfy partial unique index.
  with ranks as(select character_id,row_number() over(order by score desc,modifier desc,roll desc,character_id)::integer pos
   from public.zone_initiative_entries where zone_id=p_zone)
  select array_agg(character_id order by pos) into v_order from ranks;
  for v_i in 1..array_length(v_order,1) loop
   update public.zone_initiative_entries set position=v_i where zone_id=p_zone and character_id=v_order[v_i];
  end loop;
  update public.zone_initiative_sessions set phase='active',round_number=1,active_position=1,version=version+1,updated_at=now() where zone_id=p_zone;
  v_result:=jsonb_build_object('round',1,'active_position',1);
 elsif p_action='adjust' then
  if s.phase is distinct from 'active' then raise exception 'Encounter not active' using errcode='22023';end if;
  if p_score is null or p_score not between -1000 and 1000 then raise exception 'Score out of range' using errcode='22023';end if;
  update public.zone_initiative_entries set score=p_score where zone_id=p_zone and character_id=p_character;
  if not found then raise exception 'Unknown participant' using errcode='22023';end if;
  update public.zone_initiative_sessions set version=version+1,updated_at=now() where zone_id=p_zone;
  v_result:=jsonb_build_object('character_id',p_character,'score',p_score);
 elsif p_action='reorder' then
  if s.phase is distinct from 'active' then raise exception 'Encounter not active' using errcode='22023';end if;
  select array_agg(character_id order by position) into v_order from public.zone_initiative_entries where zone_id=p_zone;
  v_count:=coalesce(array_length(v_order,1),0);
  if p_position is null or p_position not between 1 and v_count then raise exception 'Invalid position' using errcode='22023';end if;
  select position into v_old_position from public.zone_initiative_entries where zone_id=p_zone and character_id=p_character;
  if v_old_position is null then raise exception 'Unknown participant' using errcode='22023';end if;
  if v_old_position<>p_position then
   if v_old_position<p_position then
    for v_i in v_old_position..(p_position-1) loop v_order[v_i]:=v_order[v_i+1];end loop;
   else
    for v_i in reverse v_old_position..(p_position+1) loop v_order[v_i]:=v_order[v_i-1];end loop;
   end if;
   v_order[p_position]:=p_character;
   select character_id into v_other from public.zone_initiative_entries where zone_id=p_zone and position=s.active_position;
   update public.zone_initiative_entries set position=null where zone_id=p_zone;
   for v_i in 1..v_count loop
    update public.zone_initiative_entries set position=v_i where zone_id=p_zone and character_id=v_order[v_i];
   end loop;
   select position into v_new_position from public.zone_initiative_entries where zone_id=p_zone and character_id=v_other;
   update public.zone_initiative_sessions set active_position=v_new_position,version=version+1,updated_at=now() where zone_id=p_zone;
  end if;
  v_result:=jsonb_build_object('character_id',p_character,'position',p_position);
 elsif p_action='next' then
  if s.phase is distinct from 'active' then raise exception 'Encounter not active' using errcode='22023';end if;
  select count(*) into v_count from public.zone_initiative_entries where zone_id=p_zone;
  if v_count=0 or (select count(*) from public.characters c join public.character_zone_assignments a on a.character_id=c.id
    where a.zone_id=p_zone and c.is_active)<>v_count or exists
   (select 1 from public.zone_initiative_entries e left join public.character_zone_assignments a on a.character_id=e.character_id
    where e.zone_id=p_zone and a.zone_id is distinct from p_zone)
  then raise exception 'Roster changed; request fresh initiative' using errcode='40001';end if;
  if s.active_position<v_count then v_new_position:=s.active_position+1;v_round:=s.round_number;
  else
   v_new_position:=1;v_round:=s.round_number+1;
   if v_round>1000000000 then raise exception 'Round limit reached' using errcode='22023';end if;
   for v_char in select c.id,c.sheet_data from public.characters c
    join public.character_zone_assignments a on a.character_id=c.id and a.zone_id=p_zone
    where c.is_active order by c.id for update of c loop
    v_before_sheet:=v_char.sheet_data;v_sheet:=v_before_sheet;
    v_before:=v_before||jsonb_build_object(v_char.id,v_before_sheet);
    v_temp:=v_before_sheet->'temporary_hp_duration';
    if v_temp->>'unit'='round' and coalesce((v_before_sheet->>'temporary_hp')::int,0)>0 then
     v_rem:=(v_temp->>'remaining')::int-1;
     if v_rem<=0 then v_sheet:=jsonb_set(v_sheet,'{temporary_hp}','0'::jsonb,true)-'temporary_hp_duration';
     else v_sheet:=jsonb_set(v_sheet,'{temporary_hp_duration,remaining}',to_jsonb(v_rem),true);end if;
    end if;
    foreach v_key in array array['conditions','timed_effects'] loop
     v_out:='[]'::jsonb;
     for v_item in select value from jsonb_array_elements(coalesce(v_before_sheet->v_key,'[]'::jsonb)) loop
      if v_item->>'unit'='round' and v_item->>'remaining' is not null then
       v_rem:=(v_item->>'remaining')::integer-1;
       if v_rem>0 then v_out:=v_out||jsonb_build_array(jsonb_set(v_item,'{remaining}',to_jsonb(v_rem),true));end if;
      else v_out:=v_out||jsonb_build_array(v_item);end if;
     end loop;
     v_sheet:=jsonb_set(v_sheet,array[v_key],v_out,true);
    end loop;
    update public.characters set sheet_data=v_sheet where id=v_char.id;
    v_after:=v_after||jsonb_build_object(v_char.id,v_sheet);
   end loop;
  end if;
  update public.zone_initiative_sessions set active_position=v_new_position,round_number=v_round,
   version=version+1,updated_at=now() where zone_id=p_zone;
  v_result:=jsonb_build_object('position',v_new_position,'round',v_round);
 elsif p_action='close' then
  if s.zone_id is null or s.phase='complete' then raise exception 'No encounter to close' using errcode='22023';end if;
  update public.zone_initiative_sessions set phase='complete',active_position=0,version=version+1,updated_at=now() where zone_id=p_zone;
  v_result:=jsonb_build_object('closed',true);
 end if;
 insert into public.zone_initiative_events(campaign_id,zone_id,actor_user_id,action,request_id,details)
 values(p_campaign,p_zone,v_actor,p_action,p_request,coalesce(v_result,'{}'::jsonb)||
 case when p_action='next' and v_before<>'{}'::jsonb then jsonb_build_object('effect_snapshot_before',v_before,'effect_snapshot_after',v_after) else '{}'::jsonb end);
 return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('action',p_action,'zone_id',p_zone);
end $$;
revoke all on function public.set_character_initiative_modifier(uuid,integer),public.get_character_initiative(uuid),
public.get_zone_initiative(uuid,uuid),public.manage_zone_initiative(uuid,uuid,text,uuid,integer,integer,integer,uuid) from public,anon;
grant execute on function public.set_character_initiative_modifier(uuid,integer),public.get_character_initiative(uuid),
public.get_zone_initiative(uuid,uuid),public.manage_zone_initiative(uuid,uuid,text,uuid,integer,integer,integer,uuid) to authenticated;
