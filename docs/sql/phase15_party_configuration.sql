
-- Phase 15: party settings for the current player organizer and campaign GMs.
create or replace function public.configure_party(
 p_party uuid,p_name text default null,p_policy text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare party public.campaign_parties%rowtype;actor uuid:=auth.uid();
 organizer boolean;running boolean;previous jsonb;
begin
 select * into party from public.campaign_parties where id=p_party for update;
 if actor is null or party.id is null then raise exception 'Party not found or no session' using errcode='42501';end if;
 organizer:=party.created_by=actor and exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=party.id and m.user_id=actor
 );
 if not (organizer or app_private.is_gm(party.campaign_id)) then
  raise exception 'Only a current party organizer or campaign GM may configure the party' using errcode='42501';end if;
 if not exists(select 1 from public.campaigns where id=party.campaign_id and status='active') then
  raise exception 'Campaign is inactive' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state where campaign_id=party.campaign_id for update;
 if running then raise exception 'Party configuration is locked during an active game' using errcode='42501';end if;
 if p_name is null and p_policy is null then raise exception 'No changes supplied' using errcode='22023';end if;
 if p_name is not null and char_length(btrim(p_name)) not between 1 and 100 then
  raise exception 'Party name must have 1 to 100 characters' using errcode='22023';end if;
 if p_policy is not null and p_policy not in('open','approval') then
  raise exception 'Join policy must be open or approval' using errcode='22023';end if;
 previous:=jsonb_build_object('name',party.name,'join_policy',party.join_policy);
 update public.campaign_parties
  set name=coalesce(btrim(p_name),name),join_policy=coalesce(p_policy,join_policy)
  where id=party.id;
 -- Keep the bank's label consistent without moving its contents.
 if p_name is not null then
  update public.inventory_holders h set name=btrim(p_name)||' Bank'
  from public.campaign_banks b
  where b.party_id=party.id and b.holder_id=h.id and b.bank_type='party';
 end if;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_configure','party',party.id,
  previous,jsonb_build_object('name',coalesce(btrim(p_name),party.name),'join_policy',coalesce(p_policy,party.join_policy)),
  'Party settings edited');
 return jsonb_build_object('ok',true,'id',party.id,'name',coalesce(btrim(p_name),party.name),
 'join_policy',coalesce(p_policy,party.join_policy));
end $$;
revoke all on function public.configure_party(uuid,text,text) from public,anon;
grant execute on function public.configure_party(uuid,text,text) to authenticated;

create or replace function public.remove_party_member(
 p_party uuid,p_character uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare party public.campaign_parties%rowtype;actor uuid:=auth.uid();organizer boolean;running boolean;
begin
 select * into party from public.campaign_parties where id=p_party for update;
 if actor is null or party.id is null then raise exception 'Party not found' using errcode='42501';end if;
 organizer:=party.created_by=actor and exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=party.id and m.user_id=actor);
 if not (organizer or app_private.is_gm(party.campaign_id)) then
  raise exception 'Organizer or GM required' using errcode='42501';end if;
 if not exists(select 1 from public.campaign_party_members where party_id=p_party and character_id=p_character)
 then raise exception 'Character is not a party member' using errcode='22023';end if;
 if organizer and exists(
  select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.id=p_character and m.user_id=actor)
 then raise exception 'Use Leave Party to remove yourself' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state
 where campaign_id=party.campaign_id for update;
 if running then raise exception 'Cannot remove members during an active game' using errcode='42501';end if;
 delete from public.campaign_party_members where party_id=party.id and character_id=p_character;
 update public.party_membership_requests set status='cancelled',decided_by=actor,decided_at=now()
 where character_id=p_character and party_id=party.id and status='pending';
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_remove_member','party',party.id,
  jsonb_build_object('character_id',p_character),'Party member removed');
 return jsonb_build_object('ok',true,'removed_character_id',p_character);
end $$;
revoke all on function public.remove_party_member(uuid,uuid) from public,anon;
grant execute on function public.remove_party_member(uuid,uuid) to authenticated;
