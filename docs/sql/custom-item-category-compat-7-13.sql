-- 7.13: make use-effects and category reassignment compatible with campaign-defined types.
create or replace function public.set_campaign_item_stackable(p_campaign uuid,p_definition uuid,p_stackable boolean)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_category text;v_props jsonb;v_item record;v_merged integer:=0;v_target uuid;v_custom boolean;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign)
 then raise exception 'GM permission required' using errcode='42501';end if;
 if p_stackable is null then raise exception 'Specify whether this item is stackable' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_campaign::text));
 select category,default_properties into v_category,v_props
 from public.item_definitions where id=p_definition and campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in campaign' using errcode='22023';end if;
 select exists(select 1 from public.campaign_item_categories c
  where c.campaign_id=p_campaign and c.code=v_category) into v_custom;
 if (v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') and not v_custom)
 then raise exception 'Only ordinary campaign items support stack settings' using errcode='22023';end if;
 if p_stackable and (
 v_category in ('weapon','armor','shield','ring','jewelry','headgear','footwear','clothing','focus','wondrous','container','tool')
 or coalesce(v_props->>'equippable','false')='true'
 or coalesce(v_props->>'unique','false')='true'
 or exists(select 1 from public.equipment_slot_definitions s
 where s.campaign_id=p_campaign and v_category=any(s.allowed_categories))
 or exists(select 1 from public.item_effects e where e.item_definition_id=p_definition))
 then raise exception 'Equipment and items with persistent effects cannot be stackable' using errcode='22023';end if;
 if not p_stackable and (v_category='consumable' or coalesce(v_props->>'consumable','false')='true' or v_props ? 'use_effect')
 then raise exception 'Usable consumables must remain stackable; disable Use first' using errcode='22023';end if;
 if not p_stackable and exists(select 1 from public.item_instances i where i.definition_id=p_definition and i.quantity>1)
 then raise exception 'Split existing stacks into individual units before disabling stacking' using errcode='22023';end if;
 update public.item_definitions
 set default_properties=jsonb_set(coalesce(default_properties,'{}'::jsonb),'{stackable}',to_jsonb(p_stackable),true)
 where id=p_definition and campaign_id=p_campaign;
 if p_stackable then
   for v_item in select i.id from public.item_instances i where i.campaign_id=p_campaign
    and i.definition_id=p_definition order by i.id desc loop
    v_target:=app_private.consolidate_item_location(v_item.id);
    if v_target is distinct from v_item.id then v_merged:=v_merged+1;end if;
   end loop;
 end if;
 return jsonb_build_object('definition_id',p_definition,'stackable',p_stackable,'merged_stacks',v_merged);
end $fn$;

create or replace function public.set_campaign_item_category(p_campaign uuid,p_definition uuid,p_category text)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_old text;v_props jsonb;v_eligible boolean;v_stackable boolean;v_default boolean;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM permission required' using errcode='42501';end if;
 if p_category is null or btrim(p_category)='' then raise exception 'Category required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_campaign::text));
 select d.category,d.default_properties into v_old,v_props from public.item_definitions d
   where d.id=p_definition and d.campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in this campaign' using errcode='22023';end if;
 if v_old=p_category then return jsonb_build_object('definition_id',p_definition,'category',p_category);end if;
 if exists(select 1 from public.equipment_assignments e join public.item_instances i
    on i.id=e.item_instance_id where i.definition_id=p_definition) then
  raise exception 'Unequip existing copies before changing category' using errcode='22023';end if;
 select c.default_stackable into v_default from public.campaign_item_categories c
   where c.campaign_id=p_campaign and c.code=p_category and c.active;
 if not found and p_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies',
 'weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','container','recipe')
 then raise exception 'Select an active category in this campaign' using errcode='22023';end if;
 v_eligible:=p_category in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') or v_default is not null;
 if not v_eligible and exists(select 1 from public.item_instances i where i.definition_id=p_definition and i.quantity>1)
 then raise exception 'Split existing stacks before assigning an equipment category' using errcode='22023';end if;
 update public.item_definitions set category=p_category where id=p_definition and campaign_id=p_campaign;
 if v_eligible then
   v_stackable:=case when v_props ? 'stackable'
      then coalesce((v_props->>'stackable')::boolean,false)
      else coalesce(v_default,true) end;
   if exists(select 1 from public.item_effects e where e.item_definition_id=p_definition)
     or exists(select 1 from public.equipment_slot_definitions s
       where s.campaign_id=p_campaign and p_category=any(s.allowed_categories))
     or coalesce(v_props->>'equippable','false')='true'
     or coalesce(v_props->>'unique','false')='true' then v_stackable:=false;end if;
   if coalesce(v_props->>'consumable','false')='true' or v_props ? 'use_effect' then v_stackable:=true;end if;
   perform public.set_campaign_item_stackable(p_campaign,p_definition,v_stackable);
 else
   update public.item_definitions set default_properties=jsonb_set(coalesce(default_properties,'{}'::jsonb),
     '{stackable}','false'::jsonb,true) where id=p_definition;
 end if;
 return jsonb_build_object('definition_id',p_definition,'category',p_category);
end $fn$;

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
 if v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies')
    and not exists(select 1 from public.campaign_item_categories c where c.campaign_id=p_campaign and c.code=v_category)
 then
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
end $function$
;

CREATE OR REPLACE FUNCTION public.set_campaign_item_use_effect(p_campaign uuid, p_definition uuid, p_effect jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_category text; v_props jsonb; v_effect jsonb;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM permission required' using errcode='42501';end if;
 select d.category,d.default_properties into v_category,v_props
 from public.item_definitions d where d.id=p_definition and d.campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in this campaign' using errcode='22023';end if;
 if (v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies')
    and not exists(select 1 from public.campaign_item_categories c where c.campaign_id=p_campaign and c.code=v_category))
   or coalesce(v_props->>'equippable','false')='true'
   or coalesce(v_props->>'unique','false')='true'
   or coalesce(v_props->>'stackable','true')='false'
   or exists(select 1 from public.item_effects e where e.item_definition_id=p_definition)
   or exists(select 1 from public.equipment_slot_definitions s where s.campaign_id=p_campaign and v_category=any(s.allowed_categories))
 then raise exception 'Only ordinary non-equippable stackable items can have use effects' using errcode='22023';end if;
 if coalesce(v_props->>'consumable','false')<>'true' then raise exception 'Enable Consumable / Usable first' using errcode='22023'; end if;
 v_effect:=app_private.validate_custom_item_use_effect(p_effect);
 update public.item_definitions d set default_properties=
   case when v_effect is null then coalesce(d.default_properties,'{}'::jsonb)-'use_effect'
   else jsonb_set(coalesce(d.default_properties,'{}'::jsonb),'{use_effect}',v_effect,true) end
 where d.id=p_definition;
 return jsonb_build_object('definition_id',p_definition,'use_effect',v_effect);
end $function$
;
