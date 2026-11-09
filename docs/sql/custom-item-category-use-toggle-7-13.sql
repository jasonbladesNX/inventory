-- 7.13 follow-up: disabling Use must not change the item's stacking preference.
create or replace function public.set_campaign_item_consumable(
 p_campaign uuid,p_definition uuid,p_consumable boolean
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_category text;v_props jsonb;v_ordinary boolean;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign)
 then raise exception 'GM permission required' using errcode='42501';end if;
 if p_consumable is null then raise exception 'Choose whether this item is consumable' using errcode='22023';end if;
 select category,default_properties into v_category,v_props
 from public.item_definitions where id=p_definition and campaign_id=p_campaign for update;
 if not found then raise exception 'Custom campaign item not found' using errcode='22023';end if;
 v_ordinary:=v_category in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies')
  or exists(select 1 from public.campaign_item_categories c
    where c.campaign_id=p_campaign and c.code=v_category);
 if p_consumable then
   if not v_ordinary or coalesce(v_props->>'equippable','false')='true'
    or coalesce(v_props->>'unique','false')='true'
    or coalesce(v_props->>'stackable','true')='false'
    or exists(select 1 from public.item_effects e where e.item_definition_id=p_definition)
    or exists(select 1 from public.equipment_slot_definitions s
      where s.campaign_id=p_campaign and v_category=any(s.allowed_categories))
   then raise exception 'Equipment and non-stackable items cannot be made consumable' using errcode='22023';end if;
   update public.item_definitions d set default_properties=jsonb_set(
     jsonb_set(coalesce(d.default_properties,'{}'::jsonb),'{consumable}','true'::jsonb,true),
     '{stackable}','true'::jsonb,true) where d.id=p_definition;
 else
   -- Keep the explicit stackable flag unchanged when turning off Use.
   update public.item_definitions d set default_properties=jsonb_set(
     coalesce(d.default_properties,'{}'::jsonb)-'use_effect',
     '{consumable}','false'::jsonb,true) where d.id=p_definition;
 end if;
 return jsonb_build_object('definition_id',p_definition,'consumable',p_consumable);
end $fn$;
revoke all on function public.set_campaign_item_consumable(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_campaign_item_consumable(uuid,uuid,boolean) to authenticated;
