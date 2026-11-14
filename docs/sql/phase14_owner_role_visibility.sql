CREATE OR REPLACE FUNCTION public.list_campaign_administration(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 return jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object(
  'member_id',m.id,'user_id',m.user_id,'display_name',coalesce(p.display_name,'Player'),
  'role',m.role,'status',m.status,
  'is_owner',m.user_id=(select owner_user_id from public.campaigns where id=p_campaign),'character_count',(select count(*) from public.characters c where c.member_id=m.id),
  'active_character_count',(select count(*) from public.characters c where c.member_id=m.id and c.is_active))
  order by m.role,m.status,p.display_name,m.id)
  from public.campaign_members m left join public.profiles p on p.id=m.user_id
  where m.campaign_id=p_campaign),'[]'::jsonb),
  'characters',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c.id,'name',c.name,'member_id',c.member_id,'is_active',c.is_active)
   order by c.name,c.id) from public.characters c where c.campaign_id=p_campaign),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(jsonb_build_object(
   'event_type',a.event_type,'entity_type',a.entity_type,'reason',a.reason,'created_at',a.created_at,
   'actor_user_id',a.actor_user_id) order by a.created_at desc)
  from (select * from public.audit_events where campaign_id=p_campaign
   and event_type like 'campaign_admin_%' order by created_at desc limit 50) a),'[]'::jsonb)
 );
end $function$
;
