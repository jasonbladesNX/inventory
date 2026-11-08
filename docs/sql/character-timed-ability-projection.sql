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
 case when a.total is null then null::numeric else a.total+coalesce(t.timed_bonus,0) end,
 case when a.total is null or a.modifier is null then null::integer
 else floor((a.total+coalesce(t.timed_bonus,0)-10)/2)::integer end
from calculated a
left join lateral (
 select coalesce(sum((e.value->>'value')::numeric),0)::numeric timed_bonus
 from public.characters c cross join lateral
 jsonb_array_elements(coalesce(c.sheet_data->'timed_effects','[]'::jsonb)) e(value)
 where c.id=p_character and c.is_active and e.value->>'kind'='bonus'
 and lower(e.value->>'code')=lower(a.attribute_code)
 and (e.value->>'value') ~ '^-?[0-9]{1,3}$'
 and (e.value->>'value')::integer between -30 and 30
) t on true
$function$;
