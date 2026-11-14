CREATE OR REPLACE FUNCTION public.list_character_transfer_requests(p_campaign uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'id',t.id,'character_id',t.character_id,'character_name',c.name,
 'source_campaign_id',t.source_campaign_id,'source_campaign',src.name,
 'target_campaign_id',t.target_campaign_id,'target_campaign',dest.name,
 'status',t.status,'reason',t.reason,'created_at',t.created_at,
 'can_approve_source',app_private.is_gm(t.source_campaign_id) and t.status='requested',
 'can_approve_target',app_private.is_gm(t.target_campaign_id) and t.status='awaiting_target',
 'can_finalize_target',app_private.is_gm(t.target_campaign_id) and t.status='approved_pending_migration',
 'can_cancel',t.requested_by=actor and t.status in ('requested','awaiting_target')
 ) order by t.created_at desc,t.id desc)
 from public.character_transfer_requests t
 join public.characters c on c.id=t.character_id
 join public.campaigns src on src.id=t.source_campaign_id
 join public.campaigns dest on dest.id=t.target_campaign_id
 where (p_campaign is null or p_campaign in (t.source_campaign_id,t.target_campaign_id))
 and (t.requested_by=actor or app_private.is_gm(t.source_campaign_id) or app_private.is_gm(t.target_campaign_id))
 ),'[]'::jsonb);
end $function$
;
