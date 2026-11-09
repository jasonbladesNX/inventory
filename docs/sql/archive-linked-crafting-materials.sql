CREATE OR REPLACE FUNCTION public.start_character_crafting(p_character uuid, p_recipe uuid, p_crafts integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_holder uuid;
 v_recipe public.campaign_crafting_recipes%rowtype;v_prog public.crafting_recipe_progression%rowtype;
 v_skill uuid;v_skill_name text;v_modifier int;v_roll int;v_raw int;v_total int;v_pass boolean;
 v_ing record;v_stock record;v_remaining numeric;v_needed numeric;v_take numeric;
 v_consumed jsonb:='[]'::jsonb;v_archive uuid;v_job uuid;v_ready timestamptz;v_status text;v_item uuid;v_txn uuid;v_minutes int;
begin
 if v_actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_crafts is null or p_crafts not between 1 and 100 then raise exception 'Craft count must be 1–100' using errcode='22023';end if;
 select ch.campaign_id,h.id into v_campaign,v_holder from public.characters ch
 join public.campaign_members m on m.id=ch.member_id
 join public.inventory_holders h on h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character'
 where ch.id=p_character and ch.is_active and m.user_id=v_actor and m.status='active';
 if v_holder is null then raise exception 'Character unauthorized' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select * into v_recipe from public.campaign_crafting_recipes
 where id=p_recipe and campaign_id=v_campaign and active;
 if not found then raise exception 'Recipe unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.character_learned_crafting_recipes
 where character_id=p_character and recipe_id=p_recipe)
 then raise exception 'Recipe not learned. Consume its Recipe item to learn it first.' using errcode='22023';end if;
 select * into v_prog from public.crafting_recipe_progression where recipe_id=p_recipe;
 if not found then raise exception 'Recipe progression not configured' using errcode='22023';end if;
 select c.skill_id,s.name into v_skill,v_skill_name from public.crafting_categories c
 join public.crafting_skills s on s.id=c.skill_id and s.campaign_id=v_campaign
 where c.id=v_prog.category_id and c.campaign_id=v_campaign;
 if v_skill is null then raise exception 'Recipe skill unavailable' using errcode='22023';end if;
 select total_modifier into v_modifier from public.list_character_crafting_skills(p_character) where skill_id=v_skill;
 if v_modifier is null then raise exception 'Skill modifier unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.campaign_crafting_ingredients where recipe_id=p_recipe)
 then raise exception 'Recipe has no ingredients' using errcode='22023';end if;
 if not app_private.item_can_auto_stack(v_recipe.output_definition_id)
 and v_recipe.output_quantity*p_crafts>500 then raise exception 'Too many individual outputs' using errcode='22023';end if;
 -- Tool requirements checked once, regardless of craft count.
 for v_ing in select definition_id,quantity from public.campaign_crafting_tools
 where recipe_id=p_recipe order by definition_id loop
  if coalesce((select sum(i.quantity) from public.item_instances i
   where i.holder_id=v_holder and i.definition_id=v_ing.definition_id
   and i.identified and i.condition_code='normal' and i.custom_name is null
   and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
   and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)),0)<v_ing.quantity
  then raise exception 'Missing required crafting tool' using errcode='22023';end if;
 end loop;
 -- All ingredients prechecked before any inventory change.
 for v_ing in select definition_id,quantity from public.campaign_crafting_ingredients
 where recipe_id=p_recipe order by definition_id loop
  v_needed:=v_ing.quantity::numeric*p_crafts;
  if coalesce((select sum(i.quantity) from public.item_instances i
    where i.holder_id=v_holder and i.definition_id=v_ing.definition_id and i.container_id is null
    and i.identified and i.condition_code='normal' and i.custom_name is null
    and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
    and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
    and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)),0)<v_needed
  then raise exception 'Missing required crafting materials' using errcode='22023';end if;
 end loop;
 -- The skill check is a server-generated roll. Ingredients are spent regardless of result.
 v_roll:=null;
 while v_roll is null loop
  v_raw:=get_byte(extensions.gen_random_bytes(1),0);
  if v_raw<240 then v_roll:=1+(v_raw%20);end if;
 end loop;
 v_total:=v_roll+v_modifier;
 v_pass:=v_total>=v_prog.craft_dc;
 for v_ing in select definition_id,quantity from public.campaign_crafting_ingredients
 where recipe_id=p_recipe order by definition_id loop
  v_remaining:=v_ing.quantity::numeric*p_crafts;
  for v_stock in select i.id,i.quantity from public.item_instances i
   where i.holder_id=v_holder and i.definition_id=v_ing.definition_id and i.container_id is null
   and i.identified and i.condition_code='normal' and i.custom_name is null
   and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
   and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
   and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)
   order by i.id for update of i loop
   v_take:=least(v_remaining,v_stock.quantity);
   if v_take>=v_stock.quantity then
    if exists(select 1 from public.transaction_lines l where l.item_instance_id=v_stock.id)
    or exists(select 1 from public.loot_claim_items l where l.item_instance_id=v_stock.id)
    or exists(select 1 from public.merchant_stock m where m.item_instance_id=v_stock.id)
    then
      -- Archive linked consumed units to preserve QR/trade history.
      select h.id into v_archive from public.inventory_holders h
      where h.campaign_id=v_campaign and h.holder_type='gm' and h.name='Consumed Crafting Archive'
      order by h.id limit 1;
      if v_archive is null then
       insert into public.inventory_holders(campaign_id,holder_type,name)
       values(v_campaign,'gm','Consumed Crafting Archive') returning id into v_archive;
      end if;
      update public.item_instances set holder_id=v_archive,container_id=null,version=version+1 where id=v_stock.id;
    else
      delete from public.item_instances where id=v_stock.id;
    end if;
   else update public.item_instances set quantity=quantity-v_take,version=version+1 where id=v_stock.id;end if;
   v_remaining:=v_remaining-v_take;
   exit when v_remaining<=0;
  end loop;
  if v_remaining<>0 then raise exception 'Inventory changed during crafting' using errcode='22023';end if;
  v_consumed:=v_consumed||jsonb_build_array(jsonb_build_object('definition_id',v_ing.definition_id,'quantity',v_ing.quantity*p_crafts));
 end loop;
 v_minutes:=v_prog.minutes_per_craft*p_crafts;
 v_ready:=case when v_prog.time_mode='realtime' then now()+(v_minutes*interval '1 minute') else now() end;
 v_status:=case when not v_pass then 'failed' else 'pending' end;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_crafting_started',jsonb_build_object('character_id',p_character,
 'recipe_id',p_recipe,'crafts',p_crafts,'skill_id',v_skill,'skill_name',v_skill_name,
 'roll',v_roll,'modifier',v_modifier,'total',v_total,'dc',v_prog.craft_dc,
 'success',v_pass,'consumed',v_consumed,'time_mode',v_prog.time_mode,'minutes',v_minutes,
 'ready_at',v_ready)) returning id into v_txn;
 insert into public.character_crafting_jobs(campaign_id,character_id,recipe_id,crafts,status,ready_at,
 completed_at,check_roll,check_modifier,check_total,check_dc,success,output_definition_id,output_quantity,consumed,transaction_id)
 values(v_campaign,p_character,p_recipe,p_crafts,v_status,v_ready,
 case when v_pass then null else now() end,v_roll,v_modifier,v_total,v_prog.craft_dc,v_pass,
 v_recipe.output_definition_id,v_recipe.output_quantity,v_consumed,v_txn)
 returning id into v_job;
 if v_pass and v_ready<=now() then v_item:=app_private.grant_completed_crafting_output(v_job);v_status:='completed';end if;
 return jsonb_build_object('job_id',v_job,'status',v_status,'success',v_pass,'skill',v_skill_name,
 'roll',v_roll,'modifier',v_modifier,'total',v_total,'dc',v_prog.craft_dc,
 'minutes',v_minutes,'time_mode',v_prog.time_mode,'ready_at',v_ready,
 'ingredients_consumed',true,'output',v_recipe.name,'item_id',v_item);
end $function$;
