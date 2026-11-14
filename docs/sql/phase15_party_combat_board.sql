
-- Phase 15 party encounter board: read-only player scoped projection of the
-- authoritative Phase 10 zone initiative tracker. No GM turn mutations.
create or replace function public.get_party_combat_board(p_party uuid,p_character uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_party public.campaign_parties%rowtype;v_actor uuid:=auth.uid();
begin
 select * into v_party from public.campaign_parties where id=p_party;
 if v_actor is null or v_party.id is null then
  raise exception 'Party unavailable' using errcode='42501';end if;
 if not (app_private.is_gm(v_party.campaign_id) or exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=p_party and pm.character_id=p_character and m.user_id=v_actor
 )) then
  raise exception 'Only party members and campaign GMs may view party combat'
    using errcode='42501';
 end if;
 return jsonb_build_object(
  'party_id',v_party.id,
  'party_name',v_party.name,
  'zones',coalesce((
   select jsonb_agg(jsonb_build_object(
    'zone_id',z.id,'zone_name',z.name,
    'phase',coalesce(s.phase,'none'),'round',coalesce(s.round_number,0),
    'active_position',coalesce(s.active_position,0),
    'active_party_character',(
      select jsonb_build_object('character_id',ac.id,'name',ac.name)
      from public.zone_initiative_entries ae
      join public.characters ac on ac.id=ae.character_id
      join public.campaign_party_members apm on apm.character_id=ac.id and apm.party_id=v_party.id
      where ae.zone_id=z.id and ae.position=s.active_position and s.phase='active'
      limit 1
    ),
    'party_members',coalesce((
     select jsonb_agg(jsonb_build_object(
       'character_id',c.id,'name',c.name,'is_leader',c.id=v_party.leader_character_id,
       'hp',c.sheet_data->'hp',
       'modifier',e.modifier,'roll',e.roll,'score',e.score,'position',e.position,
       'is_acting',coalesce(s.phase='active' and e.position=s.active_position,false)
      ) order by e.position nulls last,e.score desc nulls last,c.name,c.id)
     from public.campaign_party_members pm
     join public.characters c on c.id=pm.character_id and c.is_active
     join public.campaign_members cm on cm.id=c.member_id and cm.status='active'
     join public.character_zone_assignments a on a.character_id=c.id and a.zone_id=z.id
     left join public.zone_initiative_entries e on e.character_id=c.id and e.zone_id=z.id
     where pm.party_id=v_party.id
    ),'[]'::jsonb)
   ) order by z.name,z.id)
   from public.campaign_zones z
   left join public.zone_initiative_sessions s on s.zone_id=z.id
   where z.campaign_id=v_party.campaign_id and z.active and exists(
    select 1 from public.campaign_party_members pm
    join public.characters c on c.id=pm.character_id and c.is_active
    join public.campaign_members cm on cm.id=c.member_id and cm.status='active'
    join public.character_zone_assignments a on a.character_id=c.id and a.zone_id=z.id
    where pm.party_id=v_party.id
   )
  ),'[]'::jsonb)
 );
end $$;
revoke all on function public.get_party_combat_board(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_party_combat_board(uuid,uuid) to authenticated;
