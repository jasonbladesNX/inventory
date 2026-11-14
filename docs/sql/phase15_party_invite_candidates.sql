
create or replace function public.list_party_invitable_characters(p_party uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.campaign_parties%rowtype;
begin
 select * into p from public.campaign_parties where id=p_party;
 if auth.uid() is null or p.id is null or not (p.created_by=auth.uid() or app_private.is_gm(p.campaign_id))
 then raise exception 'Organizer or GM required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)
  order by c.name,c.id)
  from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.campaign_id=p.campaign_id and c.is_active and m.status='active'
  and not exists(select 1 from public.campaign_party_members pm where pm.character_id=c.id)
  and not exists(select 1 from public.party_membership_requests r
    where r.character_id=c.id and r.party_id=p.id and r.status='pending')
 ),'[]'::jsonb);
end $$;
revoke all on function public.list_party_invitable_characters(uuid) from public,anon;
grant execute on function public.list_party_invitable_characters(uuid) to authenticated;
