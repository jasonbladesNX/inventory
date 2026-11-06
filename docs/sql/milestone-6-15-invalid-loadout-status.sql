-- Nexus Multiverse equipment dependency warning repair.
-- Read-only, authorized status query for equipped items that no longer meet
-- their effective attribute prerequisites. Used alongside the existing
-- pre-unequip dependency preview to display persistent invalid-loadout status.
-- Does not remove equipment, alter character stats, or change access policies.
CREATE OR REPLACE FUNCTION public.list_character_invalid_equipment(p_character uuid)
 RETURNS TABLE(assignment_id uuid, item_name text, attribute_code text, required_score integer, current_score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 return query with attrs as (
   select upper(a.attribute_code) code,a.effective_score score
   from public.list_character_derived_attributes(p_character) a
 ), candidates as (
   select a.id as assignment_id,coalesce(nullif(btrim(i.custom_name),''),d.name)::text name,
     coalesce(i.properties->'equip_requirements'->'min_attributes',
              d.default_properties->'equip_requirements'->'min_attributes','{}'::jsonb) minima
   from public.equipment_assignments a
   join public.item_instances i on i.id=a.item_instance_id
   join public.item_definitions d on d.id=i.definition_id
   where a.character_id=p_character
 )
 select c.assignment_id,c.name,upper(k.key)::text,(k.value #>> '{}')::integer,a.score
 from candidates c
 cross join lateral jsonb_each(case when jsonb_typeof(c.minima)='object' then c.minima else '{}'::jsonb end) k
 left join attrs a on a.code=upper(k.key)
 where jsonb_typeof(k.value)='number' and (k.value #>> '{}') ~ '^[0-9]{1,3}$'
   and not coalesce(a.score >= (k.value #>> '{}')::integer,false)
 order by c.name,upper(k.key);
end $function$
;
revoke all on function public.list_character_invalid_equipment(uuid) from public,anon;
grant execute on function public.list_character_invalid_equipment(uuid) to authenticated;
