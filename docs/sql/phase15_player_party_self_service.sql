
-- Phase 15 follow-up: secure player self-service party creation, joining, and leaving.
-- Membership changes are only possible between sessions, so bank access cannot
-- be gained or removed after the GM starts the game.
create or replace function public.list_player_party_options(p_character uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
     'id',p.id,'name',p.name,'member_count',(select count(*) from public.campaign_party_members pm where pm.party_id=p.id),
     'members',coalesce((select jsonb_agg(jsonb_build_object('name',c.name,'character_id',c.id)
      order by c.name,c.id) from public.campaign_party_members pm
      join public.characters c on c.id=pm.character_id
      where pm.party_id=p.id),'[]'::jsonb))
     order by p.name,p.id)
    from public.campaign_parties p where p.campaign_id=v_campaign),'[]'::jsonb)
 );
end $$;
revoke all on function public.list_player_party_options(uuid) from public,anon;
grant execute on function public.list_player_party_options(uuid) to authenticated;

create or replace function public.manage_player_party(
 p_character uuid,p_action text,p_party uuid default null,p_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_campaign uuid;v_party uuid;v_bank uuid;v_holder uuid;
 v_existing uuid;v_running boolean;v_result jsonb;
begin
 if p_action not in ('create','join','leave') then
  raise exception 'Invalid party operation' using errcode='22023';end if;
 select c.campaign_id into v_campaign from public.characters c
 join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=v_actor and m.status='active' for update of c;
 if v_actor is null or v_campaign is null then
  raise exception 'Active owned character required' using errcode='42501';end if;
 if not exists(select 1 from public.campaigns c where c.id=v_campaign and c.status='active') then
  raise exception 'Campaign is not active' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(v_campaign)
 on conflict do nothing;
 select s.is_running into v_running from public.campaign_session_state s
 where s.campaign_id=v_campaign for update;
 if v_running then raise exception 'Party membership is locked while the GM game is running'
  using errcode='42501';end if;
 select pm.party_id into v_existing from public.campaign_party_members pm
 where pm.campaign_id=v_campaign and pm.character_id=p_character for update;
 if p_action='create' then
  if v_existing is not null then raise exception 'Leave your current party before creating another'
   using errcode='22023';end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
   raise exception 'Party name must have 1 to 100 characters' using errcode='22023';end if;
  insert into public.campaign_parties(campaign_id,name,created_by)
   values(v_campaign,btrim(p_name),v_actor) returning id into v_party;
  insert into public.inventory_holders(campaign_id,holder_type,name)
   values(v_campaign,'party',btrim(p_name)||' Bank') returning id into v_holder;
  insert into public.campaign_banks(campaign_id,bank_type,party_id,holder_id)
   values(v_campaign,'party',v_party,v_holder) returning id into v_bank;
  insert into public.campaign_party_members(party_id,campaign_id,character_id)
   values(v_party,v_campaign,p_character);
 elsif p_action='join' then
  if v_existing is not null then raise exception 'Leave your current party before joining another'
   using errcode='22023';end if;
  select p.id into v_party from public.campaign_parties p
   where p.id=p_party and p.campaign_id=v_campaign for update;
  if v_party is null then raise exception 'Party not found in this campaign'
    using errcode='22023';end if;
  insert into public.campaign_party_members(party_id,campaign_id,character_id)
   values(v_party,v_campaign,p_character);
 else
  if v_existing is null then raise exception 'You are not in a party'
   using errcode='22023';end if;
  if p_party is not null and p_party<>v_existing then
   raise exception 'This is not your current party' using errcode='42501';end if;
  v_party:=v_existing;
  delete from public.campaign_party_members where party_id=v_party and character_id=p_character;
 end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,
  after_state,reason)
 values(v_campaign,v_actor,'campaign_admin_party_self_'||p_action,
  'party',v_party,jsonb_build_object('character_id',p_character,'party_id',v_party),
  'Player party self-service');
 return jsonb_build_object('ok',true,'action',p_action,'party_id',v_party);
end $$;
revoke all on function public.manage_player_party(uuid,text,uuid,text) from public,anon;
grant execute on function public.manage_player_party(uuid,text,uuid,text) to authenticated;
