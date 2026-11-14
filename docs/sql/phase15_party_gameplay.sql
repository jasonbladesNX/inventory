
-- Phase 15: GM party gameplay orchestration reuses battle/rest/zone/message RPCs.
create or replace function public.get_party_gameplay_summary(p_party uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.campaign_parties%rowtype;actor uuid:=auth.uid();
begin
 select * into p from public.campaign_parties where id=p_party;
 if actor is null or p.id is null or not (
   app_private.is_gm(p.campaign_id) or exists(
    select 1 from public.campaign_party_members pm
    join public.characters c on c.id=pm.character_id and c.is_active
    join public.campaign_members m on m.id=c.member_id
    where pm.party_id=p.id and m.user_id=actor and m.status='active'))
 then raise exception 'Party access required' using errcode='42501';end if;
 return jsonb_build_object('party_id',p.id,'name',p.name,
  'members',coalesce((select jsonb_agg(jsonb_build_object(
   'character_id',c.id,'name',c.name,'zone_id',z.id,'zone_name',z.name,
   'hp',c.sheet_data->'hp','initiative_roll',i.roll,'initiative_score',i.score,'initiative_position',i.position)
   order by c.name,c.id)
   from public.campaign_party_members pm join public.characters c on c.id=pm.character_id and c.is_active
   left join public.character_zone_assignments a on a.character_id=c.id
   left join public.campaign_zones z on z.id=a.zone_id
   left join public.zone_initiative_entries i on i.character_id=c.id and i.zone_id=z.id
   where pm.party_id=p.id),'[]'::jsonb));
end $$;
revoke all on function public.get_party_gameplay_summary(uuid) from public,anon;
grant execute on function public.get_party_gameplay_summary(uuid) to authenticated;

create or replace function public.manage_party_gameplay(
 p_party uuid,p_action text,p_zone uuid default null,p_kind text default null,
 p_hours integer default 0,p_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.campaign_parties%rowtype;member record;old_zone uuid;
 processed int:=0;v_result jsonb:='[]'::jsonb;target record;
begin
 select * into p from public.campaign_parties where id=p_party for update;
 if auth.uid() is null or p.id is null or not app_private.is_gm(p.campaign_id) then
  raise exception 'GM party access required' using errcode='42501';end if;
 if p_action not in('move','rest','message') then raise exception 'Invalid party gameplay action' using errcode='22023';end if;
 if p_action='move' then
  select id into target from public.campaign_zones where id=p_zone and campaign_id=p.campaign_id and active;
  if target.id is null then raise exception 'Target zone unavailable' using errcode='22023';end if;
 elsif p_action='rest' then
  if p_kind not in ('short','long') or p_hours not between 0 and 24 then
   raise exception 'Invalid group rest' using errcode='22023';end if;
 elsif p_action='message' then
  if length(trim(coalesce(p_message,''))) not between 1 and 4000 then
   raise exception 'Message text required (1–4000 characters)' using errcode='22023';end if;
 end if;
 for member in
  select c.id,c.name,m.user_id from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=p.id
  order by c.id
 loop
  if p_action='move' then
   select zone_id into old_zone from public.character_zone_assignments where character_id=member.id;
   if old_zone is null then raise exception 'Party member is not assigned a zone' using errcode='22023';end if;
   if old_zone<>p_zone then
    perform public.manage_campaign_zone(p.campaign_id,'move',old_zone,null,member.id,p_zone,null,'Party group move',null);
   end if;
  elsif p_action='rest' then
   perform public.take_character_rest(member.id,p_kind,0,p_hours);
  elsif p_action='message' then
   if member.user_id<>auth.uid() and not exists(
    select 1 from jsonb_array_elements(v_result) r where r->>'user_id'=member.user_id::text) then
    perform public.send_campaign_message(p.campaign_id,'direct',trim(p_message),'Party: '||left(p.name,100),null,member.user_id);
   end if;
  end if;
  processed:=processed+1;
  v_result:=v_result||jsonb_build_array(jsonb_build_object('character_id',member.id,'name',member.name,'user_id',member.user_id));
 end loop;
 if processed=0 then raise exception 'Party has no active characters' using errcode='22023';end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(p.campaign_id,auth.uid(),'campaign_admin_party_'||p_action,'party',p.id,
  jsonb_build_object('participants',processed,'zone_id',p_zone,'rest_kind',p_kind,'hours',p_hours,
   'recipient_count',processed),'GM party action');
 return jsonb_build_object('ok',true,'action',p_action,'members',processed);
end $$;
revoke all on function public.manage_party_gameplay(uuid,text,uuid,text,integer,text) from public,anon;
grant execute on function public.manage_party_gameplay(uuid,text,uuid,text,integer,text) to authenticated;
