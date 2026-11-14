
-- Explicit party leadership. Preserves created_by as an immutable audit of creator.
alter table public.campaign_parties
 add column if not exists leader_character_id uuid references public.characters(id);

-- Existing parties: prefer a character of the creator, otherwise earliest joined member.
with ranked as (
 select p.id party_id,pm.character_id,
 row_number() over(partition by p.id order by
  case when m.user_id=p.created_by then 0 else 1 end,
  pm.joined_at,pm.character_id) rank
 from public.campaign_parties p
 join public.campaign_party_members pm on pm.party_id=p.id
 join public.characters c on c.id=pm.character_id
 join public.campaign_members m on m.id=c.member_id
)
update public.campaign_parties p set leader_character_id=r.character_id
from ranked r where r.party_id=p.id and r.rank=1 and p.leader_character_id is null;

create or replace function app_private.maintain_party_leader()
returns trigger language plpgsql security definer set search_path='' as $$
declare current_leader uuid; other_count integer;
begin
 if tg_op='INSERT' then
  update public.campaign_parties set leader_character_id=new.character_id
    where id=new.party_id and leader_character_id is null;
  return new;
 end if;
 select p.leader_character_id into current_leader from public.campaign_parties p where p.id=old.party_id for update;
 if current_leader=old.character_id then
  select count(*) into other_count from public.campaign_party_members pm
   where pm.party_id=old.party_id and pm.character_id<>old.character_id;
  if other_count>0 then
   raise exception 'Transfer party leadership to another member before the leader leaves'
     using errcode='22023';
  end if;
  update public.campaign_parties set leader_character_id=null where id=old.party_id;
 end if;
 return old;
end $$;

drop trigger if exists sync_party_leader on public.campaign_party_members;
create trigger sync_party_leader before insert or delete on public.campaign_party_members
 for each row execute function app_private.maintain_party_leader();

create or replace function public.transfer_party_leadership(
 p_party uuid,p_target_character uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare party public.campaign_parties%rowtype;actor uuid:=auth.uid();
 v_old uuid; v_running boolean;v_owner uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into party from public.campaign_parties where id=p_party for update;
 if party.id is null then raise exception 'Party not found' using errcode='22023';end if;
 v_old:=party.leader_character_id;
 if v_old is null or not exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=party.id and pm.character_id=v_old and m.user_id=actor
 ) then
  raise exception 'Only the current party leader may transfer leadership' using errcode='42501';
 end if;
 if v_old=p_target_character then raise exception 'Choose another party member' using errcode='22023';end if;
 select m.user_id into v_owner from public.campaign_party_members pm
 join public.characters c on c.id=pm.character_id and c.is_active
 join public.campaign_members m on m.id=c.member_id and m.status='active'
 where pm.party_id=party.id and pm.character_id=p_target_character
  and c.campaign_id=party.campaign_id;
 if v_owner is null then raise exception 'Target must be an active party member' using errcode='22023';end if;
 if not exists(select 1 from public.campaigns c where c.id=party.campaign_id and c.status='active')
 then raise exception 'Campaign is inactive' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select is_running into v_running from public.campaign_session_state where campaign_id=party.campaign_id for update;
 if v_running then raise exception 'Leadership changes are locked during an active game' using errcode='42501';end if;
 update public.campaign_parties set leader_character_id=p_target_character where id=party.id;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,reason)
 values(party.campaign_id,actor,'campaign_admin_party_leadership_transfer','party',party.id,
  jsonb_build_object('leader_character_id',v_old),
  jsonb_build_object('leader_character_id',p_target_character,'leader_user_id',v_owner),
  'Party leader voluntarily transferred leadership');
 return jsonb_build_object('ok',true,'party_id',party.id,'previous_leader',v_old,'leader_character_id',p_target_character);
end $$;
revoke all on function public.transfer_party_leadership(uuid,uuid) from public,anon;
grant execute on function public.transfer_party_leadership(uuid,uuid) to authenticated;
