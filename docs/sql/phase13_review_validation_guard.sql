CREATE OR REPLACE FUNCTION public.save_character_migration_manifest(p_request uuid, p_mapping jsonb, p_review boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.character_transfer_requests%rowtype; v_id uuid;actor uuid:=auth.uid();
begin
 select * into t from public.character_transfer_requests where id=p_request for update;
 if actor is null or t.id is null or not app_private.is_gm(t.target_campaign_id) or t.status<>'approved_pending_migration'
 then raise exception 'Destination GM and dual approval required' using errcode='42501';end if;
 if jsonb_typeof(p_mapping)<>'object' or length(p_mapping::text)>100000 then
  raise exception 'Mapping must be an object below 100kb' using errcode='22023';end if;
 if p_review and not (public.validate_character_migration_manifest(p_request,p_mapping)->>'valid')::boolean then
  raise exception 'Cannot mark migration mapping as reviewed: resolve all missing or invalid destinations' using errcode='22023';
 end if;
 insert into public.character_migration_manifests(request_id,source_campaign_id,target_campaign_id,mapping,status,created_by,reviewed_by)
 values(t.id,t.source_campaign_id,t.target_campaign_id,p_mapping,
  case when p_review then 'reviewed' else 'draft' end,actor,case when p_review then actor else null end)
 on conflict(request_id) do update set mapping=excluded.mapping,status=excluded.status,
 reviewed_by=excluded.reviewed_by,updated_at=now()
 returning id into v_id;
 return jsonb_build_object('id',v_id,'status',case when p_review then 'reviewed' else 'draft' end);
end $function$
;
