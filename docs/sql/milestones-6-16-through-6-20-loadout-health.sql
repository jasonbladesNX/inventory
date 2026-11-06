-- Nexus Multiverse Milestones 6.16–6.20.
-- 6.16: Read-only current loadout requirement health for all equipped items.
-- 6.17: Projection-based live equipment dependency mapping.
-- 6.18: Audit forbidden equipped-category conflicts and invalid configurations.
-- 6.19: Guided repair uses existing guarded unequip flow; no bulk writes.
-- 6.20: Copyable snapshot/report and refresh use the same authorized read APIs.
-- RPCs inherit character owner/GM authorization through character attribute
-- and equipped item readers. Neither function changes inventory, assignments,
-- equipment effects, attributes, or capacities. Anonymous execution denied.

CREATE OR REPLACE FUNCTION public.list_character_loadout_audit(p_character uuid)
 RETURNS TABLE(assignment_id uuid, item_id uuid, item_name text, slot_name text, issue_type text, attribute_code text, required_score integer, current_score numeric, conflicting_item text, is_met boolean, explanation text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_equipped record;v_rules jsonb;v_min jsonb;v_forbidden jsonb;
 v_pair record;v_code text;v_effective numeric;v_conflict text;v_issues integer;
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 for v_equipped in
  select e.assignment_id,e.item_id,e.item_name,s.label::text slot_name,
   coalesce(i.properties->'equip_requirements',d.default_properties->'equip_requirements','{}'::jsonb) rules
  from public.list_character_equipped_instances(p_character) e
  join public.item_instances i on i.id=e.item_id
  join public.item_definitions d on d.id=i.definition_id
  join public.equipment_slot_definitions s on s.id=e.slot_id
 loop
   assignment_id:=v_equipped.assignment_id;item_id:=v_equipped.item_id;
   item_name:=v_equipped.item_name;slot_name:=v_equipped.slot_name;
   issue_type:=null;attribute_code:=null;required_score:=null;current_score:=null;
   conflicting_item:=null;is_met:=true;explanation:=null;v_issues:=0;
   v_rules:=v_equipped.rules;
   if jsonb_typeof(v_rules)<>'object'
      or v_rules-'min_attributes'-'forbidden_equipped_categories'<>'{}'::jsonb
      or jsonb_typeof(coalesce(v_rules->'min_attributes','{}'::jsonb))<>'object'
      or jsonb_typeof(coalesce(v_rules->'forbidden_equipped_categories','[]'::jsonb))<>'array'
   then
     issue_type:='invalid_configuration';is_met:=false;explanation:='Equipment requirements need GM review';
     return next; continue;
   end if;
   v_min:=coalesce(v_rules->'min_attributes','{}'::jsonb);
   v_forbidden:=coalesce(v_rules->'forbidden_equipped_categories','[]'::jsonb);
   if (select count(*) from jsonb_object_keys(v_min))>20 or jsonb_array_length(v_forbidden)>20 then
     issue_type:='invalid_configuration';is_met:=false;explanation:='Too many equipment requirements';
     return next;continue;
   end if;
   for v_pair in select key,value from jsonb_each(v_min) loop
     issue_type:='minimum_attribute';attribute_code:=upper(v_pair.key);v_code:=attribute_code;conflicting_item:=null;
     if jsonb_typeof(v_pair.value)<>'number' or (v_pair.value #>> '{}') !~ '^[0-9]{1,3}$' then
       issue_type:='invalid_configuration';required_score:=null;current_score:=null;is_met:=false;
       explanation:='Invalid minimum '||attribute_code||' requirement';return next;v_issues:=v_issues+1;
     else
       required_score:=(v_pair.value #>> '{}')::integer;
       select a.effective_score into v_effective
       from public.list_character_derived_attributes(p_character) a
       where upper(a.attribute_code)=v_code;
       current_score:=v_effective;
       is_met:=coalesce(current_score>=required_score,false);
       explanation:=case when is_met then attribute_code||' requirement met'
         else 'Requires '||attribute_code||' '||required_score||
              ' (current '||coalesce(current_score::text,'unset')||')' end;
       return next;
       if not is_met then v_issues:=v_issues+1;end if;
     end if;
   end loop;
   for v_pair in select value as category from jsonb_array_elements(v_forbidden) loop
     issue_type:='forbidden_category';attribute_code:=null;required_score:=null;current_score:=null;
     if jsonb_typeof(v_pair.category)<>'string' then
       issue_type:='invalid_configuration';is_met:=false;explanation:='Invalid forbidden category';conflicting_item:=null;
       return next;v_issues:=v_issues+1;
     else
       select e.item_name into v_conflict
       from public.list_character_equipped_instances(p_character) e
       join public.item_instances i on i.id=e.item_id
       join public.item_definitions d on d.id=i.definition_id
       where e.assignment_id<>v_equipped.assignment_id and lower(d.category)=lower(v_pair.category #>> '{}')
       order by e.item_name limit 1;
       conflicting_item:=v_conflict;
       is_met:=v_conflict is null;
       explanation:=case when is_met then 'No conflicting '||(v_pair.category #>> '{}')||' equipped'
         else 'Conflicts with equipped '||v_conflict end;
       return next;
       if not is_met then v_issues:=v_issues+1;end if;
     end if;
   end loop;
   if (select count(*) from jsonb_object_keys(v_min))=0 and jsonb_array_length(v_forbidden)=0 then
     issue_type:='none';attribute_code:=null;required_score:=null;current_score:=null;
     conflicting_item:=null;is_met:=true;explanation:='No special equipment requirements';
     return next;
   end if;
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.list_character_equipment_dependency_map(p_character uuid)
 RETURNS TABLE(source_assignment_id uuid, source_item text, dependent_item text, attribute_code text, required_score integer, current_score numeric, projected_score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e record; d record;
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 for e in select * from public.list_character_equipped_instances(p_character) loop
   for d in select * from public.preview_character_unequip_dependencies(p_character,e.assignment_id) loop
     source_assignment_id:=e.assignment_id;source_item:=e.item_name;dependent_item:=d.dependent_item;
     attribute_code:=d.attribute_code;required_score:=d.required_score;
     current_score:=d.current_score;projected_score:=d.projected_score;
     return next;
   end loop;
 end loop;
end $function$
;

revoke all on function public.list_character_loadout_audit(uuid) from public,anon;
revoke all on function public.list_character_equipment_dependency_map(uuid) from public,anon;
grant execute on function public.list_character_loadout_audit(uuid) to authenticated;
grant execute on function public.list_character_equipment_dependency_map(uuid) to authenticated;
