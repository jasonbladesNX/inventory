CREATE OR REPLACE FUNCTION app_private.item_can_auto_stack(p_definition uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT coalesce((
   SELECT
     (d.category IN ('gear','ingredient','consumable','ammunition','material','component','misc','supplies')
       OR d.default_properties->>'stackable'='true')
     AND d.category NOT IN ('weapon','armor','shield','ring','jewelry','headgear',
       'footwear','clothing','focus','wondrous','container','tool')
     AND coalesce(d.default_properties->>'stackable','true') <> 'false'
     AND coalesce(lower(d.default_properties->>'equippable'),'false') NOT IN ('true','1')
     AND coalesce(lower(d.default_properties->>'unique'),'false') NOT IN ('true','1')
     AND NOT EXISTS (
       SELECT 1 FROM public.equipment_slot_definitions slot
       WHERE slot.campaign_id=d.campaign_id AND d.category=ANY(slot.allowed_categories)
     )
   FROM public.item_definitions d WHERE d.id=p_definition
 ),false)
$function$;

create or replace function public.set_campaign_item_stackable(p_campaign uuid,p_definition uuid,p_stackable boolean)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_category text;v_props jsonb;v_item record;v_merged integer:=0;v_target uuid;v_original_count integer;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign)
 then raise exception 'GM permission required' using errcode='42501';end if;
 if p_stackable is null then raise exception 'Specify whether this item is stackable' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_campaign::text));
 select category,default_properties into v_category,v_props
 from public.item_definitions where id=p_definition and campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in campaign' using errcode='22023';end if;
 if v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies')
 or coalesce(v_props->>'equippable','false')='true'
 or coalesce(v_props->>'unique','false')='true'
 or exists(select 1 from public.equipment_slot_definitions s
 where s.campaign_id=p_campaign and v_category=any(s.allowed_categories))
 or exists(select 1 from public.item_effects e where e.item_definition_id=p_definition)
 then raise exception 'Equipment and items with persistent effects cannot be stackable' using errcode='22023';end if;
 if not p_stackable and (v_category='consumable' or coalesce(v_props->>'consumable','false')='true' or v_props ? 'use_effect')
 then raise exception 'Usable consumables must remain stackable; disable Use first' using errcode='22023';end if;
 if not p_stackable and exists(select 1 from public.item_instances i where i.definition_id=p_definition and i.quantity>1)
 then raise exception 'Split existing stacks into individual units before disabling stacking' using errcode='22023';end if;
 update public.item_definitions
 set default_properties=jsonb_set(coalesce(default_properties,'{}'::jsonb),'{stackable}',to_jsonb(p_stackable),true)
 where id=p_definition and campaign_id=p_campaign;
 if p_stackable then
   -- Existing identical, unlinked stacks can be merged safely in each holder/location.
   for v_item in select i.id from public.item_instances i where i.campaign_id=p_campaign
    and i.definition_id=p_definition order by i.id desc loop
    v_target:=app_private.consolidate_item_location(v_item.id);
    if v_target is distinct from v_item.id then v_merged:=v_merged+1;end if;
   end loop;
 end if;
 return jsonb_build_object('definition_id',p_definition,'stackable',p_stackable,'merged_stacks',v_merged);
end $function$;

create or replace function public.create_campaign_custom_item_with_stacking(
 p_campaign uuid,p_name text,p_category text,p_bonus_attribute text,p_bonus numeric,
 p_two_handed boolean,p_consumable boolean,p_use_effect jsonb,p_stackable boolean
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 v_id:=public.create_campaign_custom_item_with_effect(p_campaign,p_name,p_category,p_bonus_attribute,p_bonus,p_two_handed,p_consumable,p_use_effect);
 if p_category in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') then
   perform public.set_campaign_item_stackable(p_campaign,v_id,p_stackable);
 elsif p_stackable then
   raise exception 'Equippable items must remain non-stackable' using errcode='22023';
 end if;
 return v_id;
end $function$;
revoke all on function public.set_campaign_item_stackable(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_campaign_item_stackable(uuid,uuid,boolean) to authenticated;
revoke all on function public.create_campaign_custom_item_with_stacking(uuid,text,text,text,numeric,boolean,boolean,jsonb,boolean) from public,anon;
grant execute on function public.create_campaign_custom_item_with_stacking(uuid,text,text,text,numeric,boolean,boolean,jsonb,boolean) to authenticated;
