-- Nexus Multiverse 6.9: versioned ruleset numeric resolution policy and secure reader.
-- Operations: set -> add -> multiply -> min floor -> max ceiling.
-- Exact supported condition: requires_equipped_category; unknown conditions excluded.
-- Base attributes and inventory/carrying transactions are unchanged.
update public.ruleset_versions rv set configuration=jsonb_set(coalesce(rv.configuration,'{}'::jsonb),'{effect_resolution}','{"numeric_operations":["add","set","multiply","min","max"],"supported_conditions":["requires_equipped_category"],"calculation_order":["set","add","multiply","min_floor","max_ceiling"]}'::jsonb,true) from public.game_systems gs where rv.system_id=gs.id and gs.code='dnd5e' and rv.version_label='SRD 5.2.1' and not (rv.configuration ? 'effect_resolution');
CREATE OR REPLACE FUNCTION public.list_character_derived_attributes(p_character uuid)
 RETURNS TABLE(attribute_code text, attribute_label text, base_score integer, equipment_bonus numeric, effective_score numeric, effective_modifier integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with attrs as (
 select a.attribute_code,a.attribute_label,a.score,a.modifier
 from public.list_character_attributes(p_character) a
), policy as (
 select coalesce(cp.ruleset_overrides #> '{effect_resolution,numeric_operations}',
                 rv.configuration #> '{effect_resolution,numeric_operations}',
                 '["add","set"]'::jsonb) as enabled_ops,
        coalesce(cp.ruleset_overrides #> '{effect_resolution,supported_conditions}',
                 rv.configuration #> '{effect_resolution,supported_conditions}',
                 '[]'::jsonb) as enabled_conditions
 from public.characters c
 join public.campaigns cp on cp.id=c.campaign_id
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 where c.id=p_character and c.is_active
), eligible as (
 select distinct e.id as effect_id,i.id as instance_id,upper(e.attribute_code) as code,
   e.operation,(e.value #>> '{}')::numeric as amount,
   nullif(btrim(e.stacking_group),'') as group_name
 from public.equipment_assignments a
 join public.item_instances i on i.id=a.item_instance_id and i.campaign_id=a.campaign_id
 join public.item_effects e on (e.item_instance_id=i.id or e.item_definition_id=i.definition_id)
 cross join policy pol
 where a.character_id=p_character and i.identified and i.container_id is null
   and e.visibility in ('public','identified')
   and e.operation in ('add','set','multiply','min','max')
   and pol.enabled_ops ? e.operation
   and jsonb_typeof(e.value)='number'
   and (e.value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
   and (e.operation <> 'multiply' or ((e.value #>> '{}')::numeric between 0 and 100))
   and (
     coalesce(e.conditions,'{}'::jsonb)='{}'::jsonb
     or (
       pol.enabled_conditions ? 'requires_equipped_category'
       and jsonb_typeof(e.conditions)='object'
       and e.conditions = jsonb_build_object('requires_equipped_category',e.conditions->>'requires_equipped_category')
       and exists (
         select 1 from public.equipment_assignments req
         join public.item_instances ri on ri.id=req.item_instance_id
         join public.item_definitions rd on rd.id=ri.definition_id
         where req.character_id=p_character and ri.identified and ri.container_id is null
           and lower(rd.category)=lower(e.conditions->>'requires_equipped_category')
       )
     )
   )
), ranked as (
 select e.*,
   row_number() over (
     partition by e.code,e.operation,
       case when e.group_name is null then e.instance_id::text||':'||e.effect_id::text
            else 'group:'||e.group_name end
     order by case when e.operation='multiply' then abs(e.amount-1) else abs(e.amount) end desc,
              e.amount desc,e.effect_id,e.instance_id
   ) as position
 from eligible e
), chosen as (
 select code,operation,amount from ranked where position=1
), contributions as (
 select code,
   coalesce(sum(amount) filter(where operation='add'),0)::numeric as additive,
   max(amount) filter(where operation='set') as set_score,
   max(amount) filter(where operation='min') as min_floor,
   min(amount) filter(where operation='max') as max_ceiling,
   count(*) filter(where operation='multiply' and amount=0) as zero_multipliers,
   coalesce(exp(sum(ln(amount)) filter(where operation='multiply' and amount>0)),1)::numeric as product_multiplier
 from chosen group by code
), calculated as (
 select a.attribute_code,a.attribute_label,a.score,a.modifier,
   case when a.score is null then null::numeric else
      least(
        greatest(
          (coalesce(c.set_score,a.score::numeric)+coalesce(c.additive,0)) *
          case when coalesce(c.zero_multipliers,0)>0 then 0 else coalesce(c.product_multiplier,1) end,
          coalesce(c.min_floor,(-1000000)::numeric)
        ),
        coalesce(c.max_ceiling,(1000000)::numeric)
      )
   end as total
 from attrs a left join contributions c on c.code=upper(a.attribute_code)
)
select a.attribute_code,a.attribute_label,a.score,
   case when a.total is null then 0::numeric else a.total-a.score::numeric end,
   a.total,
   case when a.total is null or a.modifier is null then null::integer else floor((a.total-10)/2)::integer end
from calculated a
$function$
;
revoke all on function public.list_character_derived_attributes(uuid) from public,anon;
grant execute on function public.list_character_derived_attributes(uuid) to authenticated;
