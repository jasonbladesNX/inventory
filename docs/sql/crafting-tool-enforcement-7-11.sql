CREATE OR REPLACE FUNCTION public.craft_character_recipe(p_character uuid, p_recipe uuid, p_crafts integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_holder uuid;
 v_recipe public.campaign_crafting_recipes%rowtype;v_ing record;v_stock record;v_needed numeric;
 v_remaining numeric;v_take numeric;v_id uuid;v_index integer;v_total_output integer;
 v_txn uuid;v_output_name text;v_consumed jsonb:='[]'::jsonb;v_tools jsonb:='[]'::jsonb;
begin
 if v_actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_crafts is null or p_crafts not between 1 and 100 then raise exception 'Craft count must be 1–100' using errcode='22023';end if;
 select ch.campaign_id,h.id into v_campaign,v_holder from public.characters ch
 join public.campaign_members m on m.id=ch.member_id
 join public.inventory_holders h on h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character'
 where ch.id=p_character and ch.is_active and m.user_id=v_actor and m.status='active' limit 1;
 if v_holder is null then raise exception 'Character not authorized' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select * into v_recipe from public.campaign_crafting_recipes r where r.id=p_recipe and r.campaign_id=v_campaign and r.active;
 if not found then raise exception 'Recipe unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.campaign_crafting_ingredients where recipe_id=p_recipe)
 then raise exception 'Recipe contains no ingredients' using errcode='22023';end if;
 v_total_output:=v_recipe.output_quantity*p_crafts;
 if not app_private.item_can_auto_stack(v_recipe.output_definition_id) and v_total_output>500
 then raise exception 'Too many individual output items' using errcode='22023';end if;
 -- Tools must be present, intact, identified, and unmodified; they are never consumed.
 -- Tool ownership may be through a character container or equipment slot.
 for v_ing in select t.definition_id,t.quantity,d.name from public.campaign_crafting_tools t
  join public.item_definitions d on d.id=t.definition_id
  where t.recipe_id=p_recipe order by t.definition_id loop
   if exists(select 1 from public.campaign_crafting_ingredients ing where ing.recipe_id=p_recipe and ing.definition_id=v_ing.definition_id)
   then raise exception 'Invalid recipe: required tools overlap consumed materials' using errcode='22023';end if;
   if coalesce((select sum(i.quantity) from public.item_instances i
    where i.holder_id=v_holder and i.definition_id=v_ing.definition_id
    and i.identified and i.condition_code='normal' and i.custom_name is null
    and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb
    and i.quantity=trunc(i.quantity)
    and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)),0)<v_ing.quantity
   then raise exception 'Missing required crafting tool: %',v_ing.name using errcode='22023';end if;
   v_tools:=v_tools||jsonb_build_array(jsonb_build_object('definition_id',v_ing.definition_id,
    'name',v_ing.name,'quantity',v_ing.quantity));
 end loop;
 -- Precheck all ingredients before any mutation; then consume only unmodified, unequipped, top-level item stacks.
 for v_ing in select ing.definition_id,ing.quantity from public.campaign_crafting_ingredients ing where ing.recipe_id=p_recipe order by ing.definition_id loop
   v_needed:=v_ing.quantity::numeric*p_crafts;
   if coalesce((select sum(i.quantity) from public.item_instances i where i.holder_id=v_holder and i.definition_id=v_ing.definition_id
     and i.container_id is null and i.condition_code='normal' and i.identified and i.custom_name is null
     and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
     and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
     and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)),0)<v_needed
   then raise exception 'Missing required crafting materials' using errcode='22023';end if;
 end loop;
 for v_ing in select ing.definition_id,ing.quantity from public.campaign_crafting_ingredients ing where ing.recipe_id=p_recipe order by ing.definition_id loop
   v_remaining:=v_ing.quantity::numeric*p_crafts;
   for v_stock in select i.id,i.quantity from public.item_instances i
     where i.holder_id=v_holder and i.definition_id=v_ing.definition_id
     and i.container_id is null and i.condition_code='normal' and i.identified and i.custom_name is null
     and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
     and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
     and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)
     order by i.id for update of i loop
     v_take:=least(v_remaining,v_stock.quantity);
     if v_take>=v_stock.quantity then delete from public.item_instances where id=v_stock.id;
     else update public.item_instances set quantity=quantity-v_take,version=version+1 where id=v_stock.id;end if;
     v_remaining:=v_remaining-v_take;
     exit when v_remaining<=0;
   end loop;
   if v_remaining<>0 then raise exception 'Crafting inventory changed; retry' using errcode='22023';end if;
   v_consumed:=v_consumed||jsonb_build_array(jsonb_build_object('definition_id',v_ing.definition_id,'quantity',v_ing.quantity*p_crafts));
 end loop;
 if app_private.item_can_auto_stack(v_recipe.output_definition_id) then
   insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
   values(v_campaign,v_recipe.output_definition_id,v_holder,v_total_output) returning id into v_id;
   v_id:=app_private.consolidate_item_location(v_id);
 else
   for v_index in 1..v_total_output loop
     insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
     values(v_campaign,v_recipe.output_definition_id,v_holder,1) returning id into v_id;
   end loop;
 end if;
 select d.name into v_output_name from public.item_definitions d where d.id=v_recipe.output_definition_id;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_crafting',jsonb_build_object('character_id',p_character,'recipe_id',p_recipe,
 'recipe_name',v_recipe.name,'item_id',v_id,'item_name',v_output_name,'quantity',v_total_output,
 'crafts',p_crafts,'ingredients',v_consumed,'required_tools',v_tools)) returning id into v_txn;
 return jsonb_build_object('transaction_id',v_txn,'recipe',v_recipe.name,'output',v_output_name,'quantity',v_total_output,'crafts',p_crafts);
end $function$;
