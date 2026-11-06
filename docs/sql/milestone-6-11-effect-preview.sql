-- Nexus Multiverse Milestone 6.11 — effect preview.
-- Shared resolver ensures live Character attributes and hypothetical GM previews
-- obey identical stacking, score-set, numeric and conditional rules.
-- Preview simulates one identified equipped instance when no copy of the
-- selected definition is already equipped. It does not validate equip slots.
-- Existing effect edits replace the matching effect ID for the simulation.
-- No effects, attributes, assignments, inventory or currency are written.
-- Public preview has GM/owner and campaign/character/definition validation.
-- Direct helper execution is disallowed for client roles.
CREATE OR REPLACE FUNCTION app_private.character_effect_projection(p_character uuid, p_preview_definition uuid DEFAULT NULL::uuid, p_preview_effect uuid DEFAULT NULL::uuid, p_proposed jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(attribute_code text, attribute_label text, base_score integer, equipment_bonus numeric, effective_score numeric, effective_modifier integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with attrs as (
 select a.attribute_code,a.attribute_label,a.score,a.modifier
 from public.list_character_attributes(p_character) a
), policy as (
 select coalesce(cp.ruleset_overrides #> '{effect_resolution,numeric_operations}',rv.configuration #> '{effect_resolution,numeric_operations}','["add","set"]'::jsonb) enabled_ops,
        coalesce(cp.ruleset_overrides #> '{effect_resolution,supported_conditions}',rv.configuration #> '{effect_resolution,supported_conditions}','[]'::jsonb) enabled_conditions
 from public.characters c
 join public.campaigns cp on cp.id=c.campaign_id
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 where c.id=p_character and c.is_active
), equipped as (
 select a.item_instance_id as instance_id,i.definition_id,i.identified,i.container_id
 from public.equipment_assignments a
 join public.item_instances i on i.id=a.item_instance_id and i.campaign_id=a.campaign_id
 where a.character_id=p_character
 union all
 select p_preview_definition,p_preview_definition,true,null::uuid
 where p_preview_definition is not null and not exists(
   select 1 from public.equipment_assignments a
   join public.item_instances i on i.id=a.item_instance_id and i.campaign_id=a.campaign_id
   where a.character_id=p_character and i.definition_id=p_preview_definition
 )
), candidate_effects as (
 select e.id effect_id,eq.instance_id,eq.identified,eq.container_id,
   upper(e.attribute_code) code,e.operation,e.value,e.stacking_group,e.conditions,e.visibility
 from equipped eq
 join public.item_effects e on e.item_instance_id=eq.instance_id or e.item_definition_id=eq.definition_id
 where p_preview_effect is null or e.id<>p_preview_effect
 union all
 select coalesce(p_preview_effect,'00000000-0000-0000-0000-000000000001'::uuid),
   eq.instance_id,eq.identified,eq.container_id,
   upper(p_proposed->>'attribute_code'),p_proposed->>'operation',p_proposed->'value',
   p_proposed->>'stacking_group',coalesce(p_proposed->'conditions','{}'::jsonb),p_proposed->>'visibility'
 from equipped eq
 where p_proposed is not null and eq.definition_id=p_preview_definition
), eligible as (
 select distinct e.effect_id,e.instance_id,e.code,e.operation,
  (e.value #>> '{}')::numeric amount,
  nullif(btrim(e.stacking_group),'') group_name
 from candidate_effects e cross join policy pol
 where e.identified and e.container_id is null
  and e.visibility in ('public','identified')
  and e.operation in ('add','set','multiply','min','max')
  and pol.enabled_ops ? e.operation
  and jsonb_typeof(e.value)='number'
  and (e.value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
  and (e.operation <> 'multiply' or (e.value #>> '{}')::numeric between 0 and 100)
  and (
    coalesce(e.conditions,'{}'::jsonb)='{}'::jsonb or (
      pol.enabled_conditions ? 'requires_equipped_category'
      and jsonb_typeof(e.conditions)='object'
      and e.conditions=jsonb_build_object('requires_equipped_category',e.conditions->>'requires_equipped_category')
      and exists (
       select 1 from equipped req join public.item_definitions d on d.id=req.definition_id
       where req.identified and req.container_id is null
         and lower(d.category)=lower(e.conditions->>'requires_equipped_category')
      )
    )
  )
), ranked as (
 select e.*,row_number() over (
  partition by e.code,e.operation,
    case when e.group_name is null then e.instance_id::text||':'||e.effect_id::text
         else 'group:'||e.group_name end
  order by case when e.operation='multiply' then abs(e.amount-1) else abs(e.amount) end desc,
    e.amount desc,e.effect_id,e.instance_id
 ) position
 from eligible e
), chosen as (
 select code,operation,amount from ranked where position=1
), contributions as (
 select code,
  coalesce(sum(amount) filter(where operation='add'),0)::numeric additive,
  max(amount) filter(where operation='set') set_score,
  max(amount) filter(where operation='min') min_floor,
  min(amount) filter(where operation='max') max_ceiling,
  count(*) filter(where operation='multiply' and amount=0) zero_multipliers,
  coalesce(exp(sum(ln(amount)) filter(where operation='multiply' and amount>0)),1)::numeric product_multiplier
 from chosen group by code
), calculated as (
 select a.attribute_code,a.attribute_label,a.score,a.modifier,
  case when a.score is null then null::numeric else
   least(greatest((coalesce(c.set_score,a.score::numeric)+coalesce(c.additive,0)) *
    case when coalesce(c.zero_multipliers,0)>0 then 0 else coalesce(c.product_multiplier,1) end,
    coalesce(c.min_floor,(-1000000)::numeric)),
    coalesce(c.max_ceiling,(1000000)::numeric))
  end total
 from attrs a left join contributions c on c.code=upper(a.attribute_code)
)
select a.attribute_code,a.attribute_label,a.score,
 case when a.total is null then 0::numeric else a.total-a.score::numeric end,
 a.total,
 case when a.total is null or a.modifier is null then null::integer
 else floor((a.total-10)/2)::integer end
from calculated a
$function$
;
CREATE OR REPLACE FUNCTION public.list_character_derived_attributes(p_character uuid)
 RETURNS TABLE(attribute_code text, attribute_label text, base_score integer, equipment_bonus numeric, effective_score numeric, effective_modifier integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select * from app_private.character_effect_projection(p_character,null,null,null)
$function$
;
CREATE OR REPLACE FUNCTION public.preview_campaign_item_effect(p_campaign uuid, p_character uuid, p_definition uuid, p_effect uuid, p_attribute text, p_operation text, p_value numeric, p_group text, p_requires_category text, p_visibility text)
 RETURNS TABLE(attribute_code text, attribute_label text, base_score integer, current_score numeric, preview_score numeric, current_modifier integer, preview_modifier integer, item_is_equipped boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_version uuid;v_ops jsonb;v_conditions jsonb;v_attrs jsonb;
 v_attr text;v_op text;v_group text;v_category text;v_visibility text;
 v_existing_equipped boolean;v_payload jsonb;
begin
 if not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if not exists(select 1 from public.characters c where c.id=p_character and c.campaign_id=p_campaign and c.is_active) then
  raise exception 'Choose an active character in this campaign' using errcode='22023';end if;
 if not exists(select 1 from public.item_definitions d where d.id=p_definition and d.campaign_id=p_campaign
  and coalesce(d.source_info->>'import_batch','')=''
  and coalesce(d.code,'') !~* '^srd') then
  raise exception 'Choose a campaign-created item' using errcode='22023';end if;
 if p_effect is not null and not exists(select 1 from public.item_effects e
  where e.id=p_effect and e.item_definition_id=p_definition and e.item_instance_id is null) then
  raise exception 'Campaign item effect not found' using errcode='22023';end if;
 select cp.ruleset_version_id,
  coalesce(cp.ruleset_overrides #> '{effect_resolution,numeric_operations}',rv.configuration #> '{effect_resolution,numeric_operations}','["add","set"]'::jsonb),
  coalesce(cp.ruleset_overrides #> '{effect_resolution,supported_conditions}',rv.configuration #> '{effect_resolution,supported_conditions}','[]'::jsonb),
  coalesce(cp.ruleset_overrides->'attributes',rv.configuration->'attributes','[]'::jsonb)
 into v_version,v_ops,v_conditions,v_attrs
 from public.campaigns cp join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 where cp.id=p_campaign;
 v_attr:=upper(trim(coalesce(p_attribute,'')));
 if length(v_attr) not between 1 and 32 or not exists(
  select 1 from jsonb_array_elements_text(v_attrs) a(code) where upper(a.code)=v_attr
 ) then raise exception 'Attribute is not configured for the ruleset' using errcode='22023';end if;
 v_op:=lower(trim(coalesce(p_operation,'')));
 if v_op not in ('add','set','multiply','min','max') or not (v_ops ? v_op) then
  raise exception 'Effect operation is not enabled for the ruleset' using errcode='22023';end if;
 if p_value is null or p_value < -1000 or p_value > 1000 or
   (v_op='multiply' and (p_value<0 or p_value>100)) then
  raise exception 'Effect value is outside the permitted range' using errcode='22023';end if;
 v_group:=nullif(trim(coalesce(p_group,'')),'');
 if v_group is not null and (length(v_group)>60 or v_group !~ '^[a-zA-Z0-9_-]+$') then
  raise exception 'Stacking group must be 1–60 letters, digits, underscores or hyphens' using errcode='22023';end if;
 v_visibility:=lower(trim(coalesce(p_visibility,'')));
 if v_visibility not in ('public','identified') then
  raise exception 'Choose public or identified visibility' using errcode='22023';end if;
 v_category:=nullif(lower(trim(coalesce(p_requires_category,''))),'');
 if v_category is not null then
  if v_category not in ('weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','gear','container') then
   raise exception 'Unsupported equipped category' using errcode='22023';end if;
  if not(v_conditions ? 'requires_equipped_category') then
   raise exception 'Conditions are not enabled for this ruleset' using errcode='22023';end if;
 end if;
 select exists(
  select 1 from public.equipment_assignments ea join public.item_instances i on i.id=ea.item_instance_id
  where ea.character_id=p_character and i.definition_id=p_definition and i.identified and i.container_id is null
 ) into v_existing_equipped;
 v_payload:=jsonb_build_object(
  'attribute_code',v_attr,'operation',v_op,'value',to_jsonb(p_value),
  'stacking_group',v_group,
  'conditions',case when v_category is null then '{}'::jsonb else jsonb_build_object('requires_equipped_category',v_category) end,
  'visibility',v_visibility
 );
 return query
 with current_values as(
  select * from app_private.character_effect_projection(p_character,null,null,null)
 ), proposed_values as (
  select * from app_private.character_effect_projection(p_character,p_definition,p_effect,v_payload)
 )
 select curr.attribute_code,curr.attribute_label,curr.base_score,curr.effective_score,
  proposed.effective_score,curr.effective_modifier,proposed.effective_modifier,v_existing_equipped
 from current_values curr join proposed_values proposed using(attribute_code)
 order by case curr.attribute_code when 'STR' then 1 when 'DEX' then 2
  when 'CON' then 3 when 'INT' then 4 when 'WIS' then 5 when 'CHA' then 6 else 7 end,
  curr.attribute_code;
end $function$
;
revoke all on function app_private.character_effect_projection(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.list_character_derived_attributes(uuid) from public,anon;
revoke all on function public.preview_campaign_item_effect(uuid,uuid,uuid,uuid,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.list_character_derived_attributes(uuid) to authenticated;
grant execute on function public.preview_campaign_item_effect(uuid,uuid,uuid,uuid,text,text,numeric,text,text,text) to authenticated;
