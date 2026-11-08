-- Milestone 7.2: allow GMs to mark ordinary custom stackable items as usable.
-- This is separate from configured potion effects: "usable" consumes one item, but applies
-- no mechanical effect unless a supported use_effect is configured on the definition.
create or replace function public.set_campaign_item_consumable(
  p_campaign uuid,p_definition uuid,p_consumable boolean
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
 if v_category not in ('gear','consumable','ammunition','material','component','misc','supplies') then
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
revoke all on function public.set_campaign_item_consumable(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_campaign_item_consumable(uuid,uuid,boolean) to authenticated;

create or replace function public.create_campaign_custom_item(
 p_campaign uuid,p_name text,p_category text,p_bonus_attribute text,
 p_bonus numeric,p_two_handed boolean,p_consumable boolean
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM permission required' using errcode='42501';
 end if;
 if p_consumable and (coalesce(p_two_handed,false)
   or (p_bonus_attribute is not null and p_bonus is not null and p_bonus<>0)) then
   raise exception 'Consumables cannot be equipped or have persistent equipment bonuses' using errcode='22023';
 end if;
 v_id:=public.create_campaign_equipment_item(p_campaign,p_name,p_category,p_bonus_attribute,p_bonus,p_two_handed);
 if coalesce(p_consumable,false) then
   perform public.set_campaign_item_consumable(p_campaign,v_id,true);
 end if;
 return v_id;
end $function$;
revoke all on function public.create_campaign_custom_item(uuid,text,text,text,numeric,boolean,boolean) from public,anon;
grant execute on function public.create_campaign_custom_item(uuid,text,text,text,numeric,boolean,boolean) to authenticated;
