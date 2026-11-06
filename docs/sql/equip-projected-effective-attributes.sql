-- Nexus Multiverse — projected effective-score equipment requirements.
-- Keep current equipment effect behavior while excluding would-be replaced
-- equipment assignments from a prospective character attribute calculation.
-- Prevent circular self-qualification: the incoming item's effects do not
-- count until it is actually equipped.
-- Both valid-slot discovery and atomic equip run the SAME requirement helper,
-- with the would-be replacement assignment IDs supplied.
-- Existing base attributes, inventory, capacity and RLS policies are unchanged.

CREATE OR REPLACE FUNCTION app_private.character_effect_projection(p_character uuid, p_preview_definition uuid, p_preview_effect uuid, p_proposed jsonb, p_excluded_assignments uuid[])
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
 where a.character_id=p_character and a.id<>all(coalesce(p_excluded_assignments,'{}'::uuid[]))
 union all
 select p_preview_definition,p_preview_definition,true,null::uuid
 where p_preview_definition is not null and not exists(
   select 1 from public.equipment_assignments a
   join public.item_instances i on i.id=a.item_instance_id and i.campaign_id=a.campaign_id
   where a.character_id=p_character and a.id<>all(coalesce(p_excluded_assignments,'{}'::uuid[])) and i.definition_id=p_preview_definition
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
CREATE OR REPLACE FUNCTION app_private.equipment_requirement_failure(p_character uuid, p_item uuid, p_exclude_assignments uuid[] DEFAULT '{}'::uuid[])
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_campaign uuid;
 v_rules jsonb;
 v_min jsonb;
 v_forbidden jsonb;
 v_pair record;
 v_score numeric;
 v_label text;
begin
 select i.campaign_id,
   coalesce(i.properties->'equip_requirements',d.default_properties->'equip_requirements','{}'::jsonb)
 into v_campaign,v_rules
 from public.item_instances i
 join public.item_definitions d on d.id=i.definition_id
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 where i.id=p_item and h.character_id=p_character and h.holder_type='character';
 if v_campaign is null then return 'Item is not owned by the selected character';end if;
 if jsonb_typeof(v_rules)<>'object' then return 'Invalid equipment requirement configuration';end if;
 if v_rules='{}'::jsonb then return null;end if;
 if v_rules - 'min_attributes' - 'forbidden_equipped_categories'<>'{}'::jsonb then
   return 'Unsupported equipment requirement configuration';
 end if;
 v_min:=coalesce(v_rules->'min_attributes','{}'::jsonb);
 v_forbidden:=coalesce(v_rules->'forbidden_equipped_categories','[]'::jsonb);
 if jsonb_typeof(v_min)<>'object' or jsonb_typeof(v_forbidden)<>'array' then
   return 'Invalid equipment requirement configuration';
 end if;
 if jsonb_array_length(v_forbidden)>20 or (select count(*) from jsonb_object_keys(v_min))>20 then
   return 'Too many equipment requirements';
 end if;
 for v_pair in select key,value from jsonb_each(v_min) loop
   if jsonb_typeof(v_pair.value)<>'number' or (v_pair.value #>> '{}') !~ '^[0-9]{1,3}$' then
     return 'Invalid minimum attribute requirement';
   end if;
   select a.effective_score,a.attribute_label into v_score,v_label
   from app_private.character_effect_projection(p_character,null,null,null,p_exclude_assignments) a
   where upper(a.attribute_code)=upper(v_pair.key);
   if not found then return 'Required attribute '||upper(v_pair.key)||' is unavailable';end if;
   if v_score is null or v_score < (v_pair.value #>> '{}')::integer then
     return 'Requires projected '||coalesce(v_label,upper(v_pair.key))||' '||(v_pair.value #>> '{}')||
       ' (current '||coalesce(v_score::text,'unset')||')';
   end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(v_forbidden) v where jsonb_typeof(v.value)<>'string') then
   return 'Invalid forbidden equipped category';
 end if;
 select d.category into v_label
 from public.equipment_assignments a
 join public.item_instances i on i.id=a.item_instance_id
 join public.item_definitions d on d.id=i.definition_id
 where a.character_id=p_character and a.id<>all(coalesce(p_exclude_assignments,'{}'::uuid[]))
   and i.id<>p_item
   and lower(d.category) in (select lower(x.value) from jsonb_array_elements_text(v_forbidden) x(value))
 order by d.category limit 1;
 if found then return 'Cannot equip while a '||v_label||' item is equipped';end if;
 return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.preview_character_item_attribute_requirements(p_character uuid, p_item uuid, p_slot uuid)
 RETURNS TABLE(attribute_code text, required_score integer, current_score numeric, projected_score numeric, is_met boolean, slot_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_campaign uuid; v_rules jsonb; v_req jsonb; v_category text;
 v_two_handed boolean; v_slot_code text; v_allowed text[]; v_slot_label text;
 v_cap integer; v_system text; v_conflicts uuid[]:='{}'::uuid[]; v_off uuid; v_main uuid;
 v_count integer; v_oldest uuid;
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 select i.campaign_id,coalesce(i.properties->'equip_requirements',d.default_properties->'equip_requirements','{}'::jsonb),
   d.category,coalesce((i.properties->>'two_handed')::boolean,(d.default_properties->>'two_handed')::boolean,false)
 into v_campaign,v_rules,v_category,v_two_handed
 from public.item_instances i
 join public.item_definitions d on d.id=i.definition_id
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 join public.characters c on c.id=p_character and c.campaign_id=i.campaign_id and c.is_active
 where i.id=p_item and h.character_id=p_character and h.holder_type='character';
 if not found then raise exception 'Item is not accessible' using errcode='42501';end if;
 select s.label,lower(regexp_replace(trim(s.code),'[ _-]+','_','g')),s.capacity,s.allowed_categories
 into v_slot_label,v_slot_code,v_cap,v_allowed
 from public.equipment_slot_definitions s where s.id=p_slot and s.campaign_id=v_campaign;
 if not found then raise exception 'Slot is not in campaign' using errcode='22023';end if;
 select gs.code into v_system from public.campaigns cp
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 join public.game_systems gs on gs.id=rv.system_id where cp.id=v_campaign;
 select s.id into v_main from public.equipment_slot_definitions s
 where s.campaign_id=v_campaign and lower(regexp_replace(trim(s.code),'[ _-]+','_','g'))='main_hand' order by s.id limit 1;
 select s.id into v_off from public.equipment_slot_definitions s
 where s.campaign_id=v_campaign and lower(regexp_replace(trim(s.code),'[ _-]+','_','g'))='off_hand' order by s.id limit 1;
 if v_system='dnd5e' and v_two_handed and v_slot_code='main_hand' then
  select coalesce(array_agg(a.id),'{}'::uuid[]) into v_conflicts from public.equipment_assignments a
  where a.character_id=p_character and a.slot_id=v_off;
 elsif v_system='dnd5e' and v_slot_code='off_hand' and v_main is not null then
  select coalesce(array_agg(a.id),'{}'::uuid[]) into v_conflicts
  from public.equipment_assignments a
  join public.item_instances i on i.id=a.item_instance_id
  join public.item_definitions d on d.id=i.definition_id
  where a.character_id=p_character and a.slot_id=v_main
    and coalesce((i.properties->>'two_handed')::boolean,(d.default_properties->>'two_handed')::boolean,false);
 end if;
 select count(*) into v_count from public.equipment_assignments a where a.character_id=p_character and a.slot_id=p_slot;
 if v_count>=v_cap then
  select a.id into v_oldest from public.equipment_assignments a
  where a.character_id=p_character and a.slot_id=p_slot order by a.id limit 1;
  v_conflicts:=array_append(v_conflicts,v_oldest);
 end if;
 v_conflicts:=array(select distinct v from unnest(v_conflicts) v where v is not null);
 v_req:=coalesce(v_rules->'min_attributes','{}'::jsonb);
 if jsonb_typeof(v_req)<>'object' then raise exception 'Invalid attribute requirements' using errcode='22023';end if;
 return query
 with live as (
  select upper(a.attribute_code) code,a.effective_score
  from public.list_character_derived_attributes(p_character) a
 ), projected as (
  select upper(a.attribute_code) code,a.effective_score
  from app_private.character_effect_projection(p_character,null,null,null,v_conflicts) a
 )
 select upper(j.key)::text,(j.value #>> '{}')::integer,l.effective_score,q.effective_score,
        coalesce(q.effective_score >= (j.value #>> '{}')::integer,false),v_slot_label::text
 from jsonb_each(v_req) j
 left join live l on l.code=upper(j.key)
 left join projected q on q.code=upper(j.key)
 where jsonb_typeof(j.value)='number' and (j.value #>> '{}') ~ '^[0-9]{1,3}$'
 order by upper(j.key);
end $function$
;

revoke all on function app_private.character_effect_projection(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.preview_character_item_attribute_requirements(uuid,uuid,uuid) from public,anon;
grant execute on function public.preview_character_item_attribute_requirements(uuid,uuid,uuid) to authenticated;
