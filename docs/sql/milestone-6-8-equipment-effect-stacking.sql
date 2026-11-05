-- Nexus Multiverse Milestone 6.8: resolved equipped-item ability effects.
--
-- Stacking policy (initial application policy; not a blanket D&D rules interpretation):
-- * Only identified, public/identified visibility, unconditional numeric add/set effects.
-- * Ungrouped additive effects combine.
-- * Within a named stacking group, the largest-magnitude add/set value wins
--   per attribute and operation, with deterministic tie-breaks.
-- * Of multiple score-setting effects, the highest set score wins, then additives apply.
-- * Conditional, multiply, min, max and flag effects remain unresolved.
-- * This is read-only; base scores, inventory, and equipment writes remain untouched.
-- * The ability modifier is computed only where the ruleset has a modifier.
CREATE OR REPLACE FUNCTION public.list_character_derived_attributes(p_character uuid)
 RETURNS TABLE(attribute_code text, attribute_label text, base_score integer, equipment_bonus numeric, effective_score numeric, effective_modifier integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with attrs as (
  select a.attribute_code,a.attribute_label,a.score,a.modifier
  from public.list_character_attributes(p_character) a
), eligible as (
  select distinct e.id, upper(e.attribute_code) as code, e.operation,
    (e.value #>> '{}')::numeric as amount,
    nullif(btrim(e.stacking_group),'') as group_name
  from public.equipment_assignments a
  join public.item_instances i on i.id=a.item_instance_id
  join public.item_effects e on (e.item_instance_id=i.id or e.item_definition_id=i.definition_id)
  where a.character_id=p_character
    and i.identified
    and e.visibility in ('public','identified')
    and coalesce(e.conditions,'{}'::jsonb)='{}'::jsonb
    and e.operation in ('add','set')
    and jsonb_typeof(e.value)='number'
    and (e.value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
), ranked as (
  select e.*,
    row_number() over (
      partition by e.code,e.operation,
       case when e.group_name is null then e.id::text else e.group_name end
      order by abs(e.amount) desc,e.amount desc,e.id
    ) as position
  from eligible e
), chosen as (
  select code,operation,amount from ranked where position=1
), contributions as (
  select code,
    coalesce(sum(amount) filter(where operation='add'),0)::numeric as additive,
    max(amount) filter(where operation='set') as set_score
  from chosen group by code
), calculated as (
  select a.attribute_code,a.attribute_label,a.score,a.modifier,
    c.additive,c.set_score,
    case when a.score is null then null::numeric
         else coalesce(c.set_score,a.score::numeric)+coalesce(c.additive,0)
    end as total
  from attrs a left join contributions c on c.code=upper(a.attribute_code)
)
select a.attribute_code,a.attribute_label,a.score,
   case when a.total is null then coalesce(a.additive,0)
        else a.total-a.score::numeric end as equipment_bonus,
   a.total,
   case when a.total is null or a.modifier is null then null::integer
        else floor((a.total-10)/2)::integer end
from calculated a
$function$
;
revoke all on function public.list_character_derived_attributes(uuid) from public,anon;
grant execute on function public.list_character_derived_attributes(uuid) to authenticated;
