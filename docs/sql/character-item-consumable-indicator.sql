-- Expose only a derived eligibility boolean; no private properties or new grants.
CREATE OR REPLACE FUNCTION public.get_character_item_details(p_character uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign uuid;
  v_result jsonb;
begin
  select c.campaign_id into v_campaign
  from public.characters c
  where c.id = p_character and c.is_active;

  if v_campaign is null or not (
    app_private.is_gm(v_campaign)
    or exists (
      select 1
      from public.characters c
      join public.campaign_members m on m.id=c.member_id
      where c.id=p_character and c.campaign_id=v_campaign and c.is_active
        and m.user_id=(select auth.uid()) and m.status='active'
    )
  ) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  select jsonb_build_object(
    'item_id', i.id,
    'category', case when i.identified then d.category else 'unknown' end,
    'description', case when i.identified then coalesce(d.description,'') else '' end,
    'condition', coalesce(i.condition_code,''),
    'identified', i.identified,
    'can_consume', (i.identified and
      (d.category in ('consumable','ammunition') or d.default_properties->>'consumable'='true')
      and coalesce(d.default_properties->>'consumable','true') <> 'false'
      and coalesce(i.properties->>'consumable','true') <> 'false'
      and coalesce(d.default_properties->>'unique','false') <> 'true'
      and coalesce(d.default_properties->>'equippable','false') <> 'true'
      and app_private.item_can_auto_stack(i.definition_id)
      and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
      and not exists(select 1 from public.item_effects e where e.item_instance_id=i.id)
    ),
    'properties', case when i.identified then (
      select coalesce(jsonb_object_agg(prop.key, prop.value), '{}'::jsonb)
      from jsonb_each(coalesce(d.default_properties,'{}'::jsonb) || coalesce(i.properties,'{}'::jsonb)) prop
      where prop.key = any(array[
        'two_handed','weight','value','rarity','damage','damage_type',
        'range','weapon_properties','armor_class','armor_type',
        'strength_requirement','attunement'
      ])
    ) else '{}'::jsonb end,
    'effects', case when i.identified then (
      select coalesce(jsonb_agg(
        jsonb_build_object('attribute',e.attribute_code,'operation',e.operation,'value',e.value)
        order by e.attribute_code
      ),'[]'::jsonb)
      from public.item_effects e
      where (e.item_definition_id=d.id or e.item_instance_id=i.id)
        and e.visibility in ('public','identified')
        and (e.item_instance_id is null or e.item_instance_id=i.id)
    ) else '[]'::jsonb end
  ) into v_result
  from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id
    and h.campaign_id=v_campaign and h.character_id=p_character
    and h.holder_type='character'
  join public.item_definitions d on d.id=i.definition_id
  where i.id=p_item and i.campaign_id=v_campaign;

  if v_result is null then
    raise exception 'Item not found' using errcode='42501';
  end if;

  return v_result;
end
$function$
;