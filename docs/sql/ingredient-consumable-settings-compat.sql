CREATE OR REPLACE FUNCTION public.set_campaign_item_consumable(p_campaign uuid, p_definition uuid, p_consumable boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_category text; v_props jsonb;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM permission required' using errcode='42501';
 end if;
 if p_consumable is null then raise exception 'Choose whether this item is consumable' using errcode='22023'; end if;
 select d.category,d.default_properties into v_category,v_props
 from public.item_definitions d
 where d.id=p_definition and d.campaign_id=p_campaign for update;
 if not found then raise exception 'Custom campaign item not found' using errcode='22023'; end if;
 if v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') then
   raise exception 'Only ordinary stackable item categories can be consumable' using errcode='22023'; end if;
 if coalesce(v_props->>'equippable','false')='true'
    or coalesce(v_props->>'unique','false')='true'
    or coalesce(v_props->>'stackable','true')='false'
    or exists(select 1 from public.item_effects e where e.item_definition_id=p_definition)
    or exists(select 1 from public.equipment_slot_definitions s
      where s.campaign_id=p_campaign and v_category=any(s.allowed_categories))
 then raise exception 'Equipment and items with persistent effects cannot be made consumable' using errcode='22023'; end if;
 update public.item_definitions d
 set default_properties=jsonb_set(
    jsonb_set(coalesce(d.default_properties,'{}'::jsonb),'{consumable}',to_jsonb(p_consumable),true),
    '{stackable}','true'::jsonb,true
 )
 where d.id=p_definition;
 return jsonb_build_object('definition_id',p_definition,'consumable',p_consumable);
end $function$;
