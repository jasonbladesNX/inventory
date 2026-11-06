-- Nexus Multiverse M6.10 GM campaign equipment effect editor.
-- GM/owner authorization via app_private.is_gm. Authenticated-only RPC grants.
-- Effect writes are restricted to campaign-created catalog definitions, excluding
-- imported SRD definitions and item-instance-level effects.
-- Operations and conditions are bounded by versioned ruleset configuration.
-- New/edit/delete actions do not change equipment assignments, inventory or containers.

CREATE OR REPLACE FUNCTION public.list_campaign_item_effects(p_campaign uuid)
 RETURNS TABLE(effect_id uuid, item_definition_id uuid, item_name text, attribute_code text, operation text, effect_value numeric, stacking_group text, requires_equipped_category text, visibility text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not app_private.is_gm(p_campaign) then
  raise exception 'GM required' using errcode='42501';
 end if;
 return query
 select e.id,d.id,d.name,e.attribute_code,e.operation,
   case when jsonb_typeof(e.value)='number' then (e.value #>> '{}')::numeric else null::numeric end,
   e.stacking_group,e.conditions->>'requires_equipped_category',e.visibility
 from public.item_effects e
 join public.item_definitions d on d.id=e.item_definition_id and d.campaign_id=p_campaign
 where e.item_instance_id is null and coalesce(d.source_info->>'import_batch','')='' and coalesce(d.code,'') !~* '^srd'
 order by d.name,e.attribute_code,e.operation,e.id;
end $function$
;
CREATE OR REPLACE FUNCTION public.save_campaign_item_effect(p_campaign uuid, p_definition uuid, p_effect uuid, p_attribute text, p_operation text, p_value numeric, p_group text, p_requires_category text, p_visibility text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_version uuid;v_config jsonb;v_attr text;v_op text;v_group text;v_condition text;v_visibility text;v_effect uuid;v_conditions jsonb;
begin
 if not app_private.is_gm(p_campaign) then
  raise exception 'GM required' using errcode='42501';
 end if;
 select cp.ruleset_version_id,coalesce(cp.ruleset_overrides #> '{effect_resolution,numeric_operations}',rv.configuration #> '{effect_resolution,numeric_operations}','["add","set"]'::jsonb)
 into v_version,v_config
 from public.campaigns cp join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 where cp.id=p_campaign;
 if v_version is null or not exists(
  select 1 from public.item_definitions d where d.id=p_definition and d.campaign_id=p_campaign and coalesce(d.source_info->>'import_batch','')='' and coalesce(d.code,'') !~* '^srd'
 ) then raise exception 'Choose a campaign-created item' using errcode='22023';end if;
 v_attr:=upper(trim(coalesce(p_attribute,'')));
 if length(v_attr)<1 or length(v_attr)>32
    or not exists(
     select 1 from public.ruleset_versions rv,jsonb_array_elements_text(coalesce(rv.configuration->'attributes','[]'::jsonb)) a(code)
     where rv.id=v_version and upper(a.code)=v_attr
    ) then raise exception 'Attribute is not configured for the ruleset' using errcode='22023';end if;
 v_op:=lower(trim(coalesce(p_operation,'')));
 if v_op not in ('add','set','multiply','min','max') or not (v_config ? v_op) then
   raise exception 'Effect operation is not enabled for the ruleset' using errcode='22023';end if;
 if p_value is null or p_value < -1000 or p_value > 1000 or
   (v_op='multiply' and (p_value < 0 or p_value > 100)) then
   raise exception 'Effect value is outside the permitted range' using errcode='22023';end if;
 v_visibility:=lower(trim(coalesce(p_visibility,'')));
 if v_visibility not in ('public','identified') then
   raise exception 'Choose public or identified visibility' using errcode='22023';end if;
 v_group:=nullif(trim(coalesce(p_group,'')),'');
 if v_group is not null and (length(v_group)>60 or v_group !~ '^[a-zA-Z0-9_-]+$') then
   raise exception 'Stacking group must be 1–60 letters, digits, underscores or hyphens' using errcode='22023';end if;
 v_condition:=nullif(lower(trim(coalesce(p_requires_category,''))),'');
 if v_condition is not null then
   if v_condition not in ('weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','gear','container') then
      raise exception 'Unsupported equipped category' using errcode='22023';end if;
   if not exists(
     select 1 from public.campaigns cp join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
     where cp.id=p_campaign and coalesce(cp.ruleset_overrides #> '{effect_resolution,supported_conditions}',rv.configuration #> '{effect_resolution,supported_conditions}','[]'::jsonb) ? 'requires_equipped_category'
   ) then raise exception 'Conditions are not enabled for this ruleset' using errcode='22023';end if;
 end if;
 v_conditions:=case when v_condition is null then '{}'::jsonb else jsonb_build_object('requires_equipped_category',v_condition) end;
 if p_effect is null then
  insert into public.item_effects(item_definition_id,attribute_code,operation,value,stacking_group,conditions,visibility)
  values(p_definition,v_attr,v_op,to_jsonb(p_value),v_group,v_conditions,v_visibility) returning id into v_effect;
 else
  update public.item_effects e
   set attribute_code=v_attr,operation=v_op,value=to_jsonb(p_value),
       stacking_group=v_group,conditions=v_conditions,visibility=v_visibility
   where e.id=p_effect and e.item_definition_id=p_definition and e.item_instance_id is null
     and exists(select 1 from public.item_definitions d where d.id=e.item_definition_id and d.campaign_id=p_campaign and coalesce(d.source_info->>'import_batch','')='' and coalesce(d.code,'') !~* '^srd')
   returning e.id into v_effect;
  if v_effect is null then raise exception 'Campaign item effect not found' using errcode='22023';end if;
 end if;
 return v_effect;
end $function$
;
CREATE OR REPLACE FUNCTION public.delete_campaign_item_effect(p_campaign uuid, p_effect uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not app_private.is_gm(p_campaign) then
  raise exception 'GM required' using errcode='42501';end if;
 delete from public.item_effects e where e.id=p_effect and e.item_instance_id is null
   and exists(select 1 from public.item_definitions d where d.id=e.item_definition_id and d.campaign_id=p_campaign and coalesce(d.source_info->>'import_batch','')='' and coalesce(d.code,'') !~* '^srd');
 if not found then raise exception 'Campaign item effect not found' using errcode='22023';end if;
end $function$
;

revoke all on function public.list_campaign_item_effects(uuid) from public,anon;
revoke all on function public.save_campaign_item_effect(uuid,uuid,uuid,text,text,numeric,text,text,text) from public,anon;
revoke all on function public.delete_campaign_item_effect(uuid,uuid) from public,anon;
grant execute on function public.list_campaign_item_effects(uuid) to authenticated;
grant execute on function public.save_campaign_item_effect(uuid,uuid,uuid,text,text,numeric,text,text,text) to authenticated;
grant execute on function public.delete_campaign_item_effect(uuid,uuid) to authenticated;
