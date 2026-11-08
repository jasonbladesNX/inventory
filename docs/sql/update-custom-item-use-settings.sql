-- Atomic editing of an existing custom item's usability and use effect.
create or replace function public.update_campaign_custom_item_use_settings(
 p_campaign uuid,p_definition uuid,p_consumable boolean,p_use_effect jsonb default null
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_effect jsonb; v_result jsonb;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM permission required' using errcode='42501'; end if;
 if p_consumable is null then raise exception 'Specify consumable status' using errcode='22023';end if;
 v_effect:=app_private.validate_custom_item_use_effect(p_use_effect);
 if not p_consumable and v_effect is not null then
   raise exception 'Non-consumable items cannot have use effects' using errcode='22023';end if;
 if p_consumable then
   perform public.set_campaign_item_consumable(p_campaign,p_definition,true);
   v_result:=public.set_campaign_item_use_effect(p_campaign,p_definition,v_effect);
 else
   -- Existing effects can be cleared before turning consumption off.
   perform 1 from public.item_definitions d where d.id=p_definition and d.campaign_id=p_campaign for update;
   if not found then raise exception 'Custom item not found' using errcode='22023'; end if;
   update public.item_definitions d set default_properties=coalesce(d.default_properties,'{}'::jsonb)-'use_effect'
   where d.id=p_definition;
   perform public.set_campaign_item_consumable(p_campaign,p_definition,false);
   v_result:=jsonb_build_object('definition_id',p_definition,'use_effect',null);
 end if;
 return v_result||jsonb_build_object('consumable',p_consumable);
end $function$;
revoke all on function public.update_campaign_custom_item_use_settings(uuid,uuid,boolean,jsonb) from public,anon;
grant execute on function public.update_campaign_custom_item_use_settings(uuid,uuid,boolean,jsonb) to authenticated;
