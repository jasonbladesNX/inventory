
create or replace function public.get_campaign_session_state(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (
  app_private.is_gm(p_campaign) or exists(select 1 from public.campaign_members m
   where m.campaign_id=p_campaign and m.user_id=auth.uid() and m.status='active'))
 then raise exception 'Not in campaign' using errcode='42501';end if;
 return jsonb_build_object('is_running',coalesce(
  (select s.is_running from public.campaign_session_state s where s.campaign_id=p_campaign),false));
end $$;
revoke all on function public.get_campaign_session_state(uuid) from public,anon;
grant execute on function public.get_campaign_session_state(uuid) to authenticated;

create or replace function public.list_campaign_parties(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'members',coalesce((
   select jsonb_agg(jsonb_build_object('character_id',c.id,'name',c.name) order by c.name)
   from public.campaign_party_members pm join public.characters c on c.id=pm.character_id
   where pm.party_id=p.id),'[]'::jsonb))
  order by p.name,p.id) from public.campaign_parties p where p.campaign_id=p_campaign),'[]'::jsonb);
end $$;
revoke all on function public.list_campaign_parties(uuid) from public,anon;
grant execute on function public.list_campaign_parties(uuid) to authenticated;
