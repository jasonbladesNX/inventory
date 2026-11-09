CREATE OR REPLACE FUNCTION public.learn_character_crafting_recipe(p_character uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_holder uuid;v_item public.item_instances%rowtype;
 v_recipe uuid;v_name text;v_skill uuid;v_dc int;v_bonus int;v_roll int;v_total int;v_raw int;
 v_success boolean;v_txn uuid;v_archive uuid;
begin
 if v_actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 select ch.campaign_id,h.id into v_campaign,v_holder
 from public.characters ch join public.campaign_members m on m.id=ch.member_id
 join public.inventory_holders h on h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character'
 where ch.id=p_character and ch.is_active and m.user_id=v_actor and m.status='active';
 if v_holder is null then raise exception 'Character unauthorized' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select i.* into v_item from public.item_instances i
 where i.id=p_item and i.holder_id=v_holder and i.campaign_id=v_campaign for update;
 if not found or v_item.quantity<1 or v_item.container_id is not null or not v_item.identified
 or v_item.condition_code<>'normal' or v_item.custom_name is not null
 or v_item.properties<>'{}'::jsonb or v_item.private_properties<>'{}'::jsonb
 then raise exception 'Recipe item unavailable' using errcode='22023';end if;
 select r.id,r.name,s.id,p.learn_dc into v_recipe,v_name,v_skill,v_dc from public.crafting_recipe_progression p
 join public.campaign_crafting_recipes r on r.id=p.recipe_id and r.campaign_id=v_campaign and r.active
 join public.crafting_categories c on c.id=p.category_id and c.campaign_id=v_campaign
 join public.crafting_skills s on s.id=c.skill_id and s.campaign_id=v_campaign
 where p.recipe_item_id=v_item.definition_id;
 if v_recipe is null then raise exception 'Item is not an active recipe' using errcode='22023';end if;
 if exists(select 1 from public.character_learned_crafting_recipes where character_id=p_character and recipe_id=v_recipe)
 then raise exception 'Recipe already learned' using errcode='22023';end if;
 select total_modifier into v_bonus from public.list_character_crafting_skills(p_character) where skill_id=v_skill;
 if v_bonus is null then raise exception 'Missing crafting skill' using errcode='22023';end if;
 v_roll:=null;
 while v_roll is null loop v_raw:=get_byte(extensions.gen_random_bytes(1),0);
  if v_raw<240 then v_roll:=1+(v_raw%20);end if;
 end loop;
 v_total:=v_roll+v_bonus;v_success:=(v_total>=v_dc);
 if v_success then
  insert into public.character_learned_crafting_recipes(character_id,recipe_id) values(p_character,v_recipe);
  if v_item.quantity=1 then
   if exists(select 1 from public.transaction_lines where item_instance_id=p_item)
   or exists(select 1 from public.loot_claim_items where item_instance_id=p_item)
   or exists(select 1 from public.merchant_stock where item_instance_id=p_item)
   then
    -- Preserve referenced item IDs in GM-held archive; exclude from player inventory.
    select h.id into v_archive from public.inventory_holders h where h.campaign_id=v_campaign
    and h.holder_type='gm' and h.name='Consumed Recipe Archive' order by h.id limit 1;
    if v_archive is null then
      insert into public.inventory_holders(campaign_id,holder_type,name)
      values(v_campaign,'gm','Consumed Recipe Archive') returning id into v_archive;
    end if;
    update public.item_instances set holder_id=v_archive,container_id=null,version=version+1 where id=p_item;
   else
    delete from public.item_instances where id=p_item;
   end if;
  else update public.item_instances set quantity=quantity-1,version=version+1 where id=p_item;end if;
 end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_recipe_learning',jsonb_build_object(
 'character_id',p_character,'recipe_id',v_recipe,'recipe_name',v_name,'item_id',p_item,
 'success',v_success,'roll',v_roll,'modifier',v_bonus,'total',v_total,'dc',v_dc,
 'consumed',v_success)) returning id into v_txn;
 return jsonb_build_object('success',v_success,'recipe_id',v_recipe,'recipe_name',v_name,
 'roll',v_roll,'modifier',v_bonus,'total',v_total,'dc',v_dc,'consumed',v_success,'transaction_id',v_txn);
end $function$;
