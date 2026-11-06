-- Nexus Multiverse 6.15: read-only dependency check before removing an equipped item.
-- Uses live and projected effective attributes, excluding only the proposed
-- removed assignment. Reports remaining items that newly fail a minimum
-- attribute requirement. Does not change equipment or persist any state.
-- Existing owner/GM auth enforced by public.list_character_attributes.
CREATE OR REPLACE FUNCTION public.preview_character_unequip_dependencies(p_character uuid, p_assignment uuid)
 RETURNS TABLE(dependent_item text, attribute_code text, required_score integer, current_score numeric, projected_score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_item uuid;
begin
 -- Existing owner/GM authorization; reject cross-character assignment IDs.
 perform 1 from public.list_character_attributes(p_character) limit 1;
 select a.item_instance_id into v_item from public.equipment_assignments a
 where a.id=p_assignment and a.character_id=p_character;
 if v_item is null then raise exception 'Equipment assignment not accessible' using errcode='42501';end if;
 return query
 with live as (
  select upper(a.attribute_code) code,a.effective_score score
  from public.list_character_derived_attributes(p_character) a
 ), projected as (
  select upper(a.attribute_code) code,a.effective_score score
  from app_private.character_effect_projection(p_character,null,null,null,array[p_assignment]) a
 ), remain as (
  select coalesce(nullif(btrim(i.custom_name),''),d.name)::text name,
    coalesce(i.properties->'equip_requirements'->'min_attributes',
             d.default_properties->'equip_requirements'->'min_attributes','{}'::jsonb) minima
  from public.equipment_assignments a
  join public.item_instances i on i.id=a.item_instance_id
  join public.item_definitions d on d.id=i.definition_id
  where a.character_id=p_character and a.id<>p_assignment
 )
 select r.name,upper(k.key), (k.value #>> '{}')::integer,
        l.score,q.score
 from remain r cross join lateral jsonb_each(
      case when jsonb_typeof(r.minima)='object' then r.minima else '{}'::jsonb end
 ) k
 left join live l on l.code=upper(k.key)
 left join projected q on q.code=upper(k.key)
 where jsonb_typeof(k.value)='number'
   and (k.value #>> '{}') ~ '^[0-9]{1,3}$'
   and coalesce(l.score >= (k.value #>> '{}')::integer,false)
   and not coalesce(q.score >= (k.value #>> '{}')::integer,false)
 order by r.name,upper(k.key);
end $function$
;
revoke all on function public.preview_character_unequip_dependencies(uuid,uuid) from public,anon;
grant execute on function public.preview_character_unequip_dependencies(uuid,uuid) to authenticated;
