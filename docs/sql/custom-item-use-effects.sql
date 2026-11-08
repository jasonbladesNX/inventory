-- GM-configurable use effects for ordinary custom consumables.
-- Reuse the existing validated consumption engine; never execute arbitrary expressions.
create or replace function app_private.validate_custom_item_use_effect(p_effect jsonb)
returns jsonb language plpgsql immutable set search_path to ''
as $function$
declare v_type text; v_code text; v_unit text; v_count int; v_sides int; v_bonus int; v_amount int; v_duration int;
begin
 if p_effect is null or p_effect='null'::jsonb then return null; end if;
 if jsonb_typeof(p_effect)<>'object' then raise exception 'Use effect must be an object' using errcode='22023'; end if;
 v_type:=p_effect->>'type';
 if v_type='heal_hp' then
   if coalesce(p_effect->>'dice_count','') !~ '^[0-9]{1,2}$' or coalesce(p_effect->>'dice_sides','') !~ '^[0-9]{1,3}$'
     or coalesce(p_effect->>'bonus','') !~ '^[0-9]{1,3}$' then raise exception 'Healing requires dice count, sides, and bonus' using errcode='22023'; end if;
   v_count:=(p_effect->>'dice_count')::int;v_sides:=(p_effect->>'dice_sides')::int;v_bonus:=(p_effect->>'bonus')::int;
   if v_count not between 1 and 10 or v_sides not between 2 and 100 or v_bonus not between 0 and 100 then
     raise exception 'Healing limits: 1-10 dice, 2-100 sides, 0-100 bonus' using errcode='22023'; end if;
   return jsonb_build_object('type','heal_hp','dice_count',v_count,'dice_sides',v_sides,'bonus',v_bonus);
 elsif v_type='temp_hp' then
   if coalesce(p_effect->>'amount','') !~ '^[0-9]{1,6}$' then raise exception 'Temporary HP must be a whole number' using errcode='22023'; end if;
   v_amount:=(p_effect->>'amount')::int;
   if v_amount not between 1 and 100000 then raise exception 'Temporary HP must be 1-100000' using errcode='22023';end if;
   return jsonb_build_object('type','temp_hp','amount',v_amount);
 elsif v_type in ('remove_condition','add_condition','ability_bonus') then
   v_code:=lower(trim(coalesce(p_effect->>'code','')));
   if v_code !~ '^[a-z][a-z0-9_ -]{0,59}$' then raise exception 'Invalid condition or ability name' using errcode='22023'; end if;
   if v_type='ability_bonus' and v_code not in ('str','dex','con','int','wis','cha') then raise exception 'Choose STR, DEX, CON, INT, WIS or CHA' using errcode='22023'; end if;
   if v_type='remove_condition' then return jsonb_build_object('type',v_type,'code',v_code); end if;
   v_unit:=coalesce(p_effect->>'unit','round');
   if v_unit not in ('round','turn','minute','hour','rest','permanent') then raise exception 'Invalid effect duration unit' using errcode='22023'; end if;
   v_duration:=null;
   if v_unit<>'permanent' then
     if coalesce(p_effect->>'duration','') !~ '^[0-9]{1,6}$' then raise exception 'Duration must be a whole number' using errcode='22023';end if;
     v_duration:=(p_effect->>'duration')::int;
     if v_duration not between 1 and 100000 then raise exception 'Duration must be 1-100000' using errcode='22023';end if;
   end if;
   if v_type='ability_bonus' then
     if coalesce(p_effect->>'value','') !~ '^-?[0-9]{1,3}$' then raise exception 'Ability bonus must be a whole number' using errcode='22023';end if;
     v_amount:=(p_effect->>'value')::int;
     if v_amount not between -30 and 30 then raise exception 'Ability bonus must be -30 to +30' using errcode='22023';end if;
     return jsonb_build_object('type',v_type,'code',v_code,'value',v_amount,'unit',v_unit,'duration',v_duration);
   end if;
   return jsonb_build_object('type',v_type,'code',v_code,'unit',v_unit,'duration',v_duration);
 else
   raise exception 'Unsupported item use effect type' using errcode='22023';
 end if;
end $function$;

create or replace function public.set_campaign_item_use_effect(
 p_campaign uuid,p_definition uuid,p_effect jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_category text; v_props jsonb; v_effect jsonb;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM permission required' using errcode='42501';end if;
 select d.category,d.default_properties into v_category,v_props
 from public.item_definitions d where d.id=p_definition and d.campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in this campaign' using errcode='22023';end if;
 if v_category not in ('gear','consumable','ammunition','material','component','misc','supplies')
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
end $function$;

create or replace function public.create_campaign_custom_item_with_effect(
 p_campaign uuid,p_name text,p_category text,p_bonus_attribute text,p_bonus numeric,
 p_two_handed boolean,p_consumable boolean,p_use_effect jsonb default null
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_effect jsonb;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM permission required' using errcode='42501';end if;
 if p_use_effect is not null and p_use_effect<>'null'::jsonb and not coalesce(p_consumable,false) then
   raise exception 'Use effects require Consumable / Usable' using errcode='22023';end if;
 v_effect:=app_private.validate_custom_item_use_effect(p_use_effect);
 v_id:=public.create_campaign_custom_item(p_campaign,p_name,p_category,p_bonus_attribute,p_bonus,p_two_handed,p_consumable);
 if v_effect is not null then perform public.set_campaign_item_use_effect(p_campaign,v_id,v_effect);end if;
 return v_id;
end $function$;

revoke all on function public.set_campaign_item_use_effect(uuid,uuid,jsonb) from public,anon;
grant execute on function public.set_campaign_item_use_effect(uuid,uuid,jsonb) to authenticated;
revoke all on function public.create_campaign_custom_item_with_effect(uuid,text,text,text,numeric,boolean,boolean,jsonb) from public,anon;
grant execute on function public.create_campaign_custom_item_with_effect(uuid,text,text,text,numeric,boolean,boolean,jsonb) to authenticated;
