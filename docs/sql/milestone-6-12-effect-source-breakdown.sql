-- Milestone 6.12: authorized read-only breakdown of equipped item effect sources.
-- Statuses mirror the versioned numerical resolver's eligibility and stacking rules.
-- Does not modify character attributes, item effects, inventory or equipment assignments.
-- Conceals unidentified items and hidden GM visibility.
CREATE OR REPLACE FUNCTION public.list_character_effect_sources(p_character uuid)
 RETURNS TABLE(attribute_code text, item_id uuid, item_name text, effect_id uuid, operation text, effect_value numeric, stacking_group text, effect_status text, status_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The existing character-attribute reader is the ownership/GM authorization gate.
  perform 1 from public.list_character_attributes(p_character) limit 1;
  return query
  with policy as (
    select coalesce(camp.ruleset_overrides #> '{effect_resolution,numeric_operations}',r.configuration #> '{effect_resolution,numeric_operations}','["add","set"]'::jsonb) ops,
      coalesce(camp.ruleset_overrides #> '{effect_resolution,supported_conditions}',r.configuration #> '{effect_resolution,supported_conditions}','[]'::jsonb) conditions
    from public.characters ch
    join public.campaigns camp on camp.id=ch.campaign_id
    join public.ruleset_versions r on r.id=camp.ruleset_version_id
    where ch.id=p_character and ch.is_active
  ), equipped as (
    select distinct i.id instance_id,i.definition_id,
      coalesce(nullif(btrim(i.custom_name),''),d.name)::text display_name
    from public.equipment_assignments a
    join public.item_instances i on i.id=a.item_instance_id and i.campaign_id=a.campaign_id
    join public.item_definitions d on d.id=i.definition_id
    where a.character_id=p_character and i.identified and i.container_id is null
  ), candidates as (
    select distinct e.id source_effect_id,eq.instance_id,eq.display_name,
      upper(e.attribute_code)::text attr,e.operation::text op,e.value,
      nullif(btrim(e.stacking_group),'')::text grp,e.conditions,e.visibility
    from equipped eq
    join public.item_effects e on e.item_instance_id=eq.instance_id or e.item_definition_id=eq.definition_id
    where e.visibility in ('public','identified')
  ), checked as (
    select c.*,
      case when c.op not in ('add','set','multiply','min','max') or not(p.ops ? c.op) then 'unsupported'
      when jsonb_typeof(c.value)<>'number' or (c.value #>> '{}') !~ '^-?[0-9]+([.][0-9]+)?$' then 'unsupported'
      when c.op='multiply' and (c.value #>> '{}')::numeric not between 0 and 100 then 'unsupported'
      when coalesce(c.conditions,'{}'::jsonb)<>'{}'::jsonb and not (
        p.conditions ? 'requires_equipped_category'
        and jsonb_typeof(c.conditions)='object'
        and c.conditions=jsonb_build_object('requires_equipped_category',c.conditions->>'requires_equipped_category')
        and exists (
          select 1 from equipped req join public.item_definitions d on d.id=req.definition_id
          where lower(d.category)=lower(c.conditions->>'requires_equipped_category')
        )
      ) then 'condition_unmet'
      else 'eligible' end as eligibility
    from candidates c cross join policy p
  ), ranked as (
    select c.*,
      row_number() over(
        partition by c.attr,c.op,case when c.grp is null then c.instance_id::text||':'||c.source_effect_id::text else 'group:'||c.grp end
        order by case when c.op='multiply' then abs((c.value #>> '{}')::numeric-1)
                      else abs((c.value #>> '{}')::numeric) end desc,
                 (c.value #>> '{}')::numeric desc,c.source_effect_id,c.instance_id
      ) as rank_in_group
    from checked c where c.eligibility='eligible'
  ), ranked_status as (
    select c.source_effect_id,c.instance_id,
      case when c.eligibility<>'eligible' then c.eligibility
        when r.rank_in_group>1 then 'suppressed'
        when c.op='set' and (c.value #>> '{}')::numeric<
          (select max((z.value #>> '{}')::numeric) from ranked z where z.attr=c.attr and z.op='set' and z.rank_in_group=1) then 'suppressed'
        when c.op='min' and (c.value #>> '{}')::numeric<
          (select max((z.value #>> '{}')::numeric) from ranked z where z.attr=c.attr and z.op='min' and z.rank_in_group=1) then 'suppressed'
        when c.op='max' and (c.value #>> '{}')::numeric>
          (select min((z.value #>> '{}')::numeric) from ranked z where z.attr=c.attr and z.op='max' and z.rank_in_group=1) then 'suppressed'
        else 'applied' end as status
    from checked c left join ranked r on r.source_effect_id=c.source_effect_id and r.instance_id=c.instance_id
  )
  select c.attr,c.instance_id,c.display_name,c.source_effect_id,c.op,
    case when jsonb_typeof(c.value)='number' and (c.value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (c.value #>> '{}')::numeric else null::numeric end,
    c.grp,rs.status::text,
    case rs.status
      when 'applied' then 'Included in effect resolution'
      when 'suppressed' then 'A stronger effect or stacking rule takes precedence'
      when 'condition_unmet' then 'Equipment requirement not satisfied'
      else 'Operation, value, or condition not supported by this ruleset'
    end::text
  from checked c join ranked_status rs on rs.source_effect_id=c.source_effect_id and rs.instance_id=c.instance_id
  order by c.attr,case rs.status when 'applied' then 0 when 'suppressed' then 1 when 'condition_unmet' then 2 else 3 end,c.display_name,c.op,c.source_effect_id;
end $function$
;
revoke all on function public.list_character_effect_sources(uuid) from public,anon;
grant execute on function public.list_character_effect_sources(uuid) to authenticated;
