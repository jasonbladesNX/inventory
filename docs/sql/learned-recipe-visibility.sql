CREATE OR REPLACE FUNCTION public.list_campaign_crafting_recipes(p_campaign uuid)
 RETURNS TABLE(id uuid, name text, description text, output_definition_id uuid, output_name text, output_quantity integer, active boolean, ingredients jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_gm boolean;
begin
 v_gm:=app_private.is_gm(p_campaign);
 if not v_gm and not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select r.id,r.name,r.description,r.output_definition_id,d.name,r.output_quantity,r.active,
 (select coalesce(jsonb_agg(jsonb_build_object('definition_id',ing.definition_id,'name',def.name,'quantity',ing.quantity) order by def.name),'[]'::jsonb)
  from public.campaign_crafting_ingredients ing join public.item_definitions def on def.id=ing.definition_id where ing.recipe_id=r.id)
 from public.campaign_crafting_recipes r join public.item_definitions d on d.id=r.output_definition_id
 where r.campaign_id=p_campaign and (app_private.is_gm(p_campaign) or (r.active and exists (
 select 1 from public.character_learned_crafting_recipes learned
 join public.characters char on char.id=learned.character_id and char.campaign_id=p_campaign and char.is_active
 join public.campaign_members member on member.id=char.member_id and member.status='active'
 where learned.recipe_id=r.id and member.user_id=(select auth.uid())
 ))) order by r.name,r.id;
end $function$;

CREATE OR REPLACE FUNCTION public.list_campaign_crafting_tools(p_campaign uuid)
 RETURNS TABLE(recipe_id uuid, definition_id uuid, name text, quantity integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select auth.uid()) is null or
  (not app_private.is_gm(p_campaign) and not exists(select 1 from public.campaign_members m
   where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select t.recipe_id,t.definition_id,d.name,t.quantity
 from public.campaign_crafting_tools t
 join public.campaign_crafting_recipes r on r.id=t.recipe_id
 join public.item_definitions d on d.id=t.definition_id
 where r.campaign_id=p_campaign and (app_private.is_gm(p_campaign) or (r.active and exists (
 select 1 from public.character_learned_crafting_recipes learned
 join public.characters char on char.id=learned.character_id and char.campaign_id=p_campaign and char.is_active
 join public.campaign_members member on member.id=char.member_id and member.status='active'
 where learned.recipe_id=r.id and member.user_id=(select auth.uid())
 )))
 order by r.name,d.name;
end $function$;

CREATE OR REPLACE FUNCTION public.list_crafting_recipe_progression(p_campaign uuid)
 RETURNS TABLE(recipe_id uuid, category_id uuid, category_name text, skill_id uuid, skill_name text, attribute_code text, learn_dc integer, craft_dc integer, time_mode text, minutes_per_craft integer, recipe_item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select auth.uid()) is null or (not app_private.is_gm(p_campaign) and
 not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select p.recipe_id,c.id,c.name,s.id,s.name,s.attribute_code,p.learn_dc,p.craft_dc,p.time_mode,p.minutes_per_craft,p.recipe_item_id
 from public.crafting_recipe_progression p join public.crafting_categories c on c.id=p.category_id
 join public.crafting_skills s on s.id=c.skill_id join public.campaign_crafting_recipes r on r.id=p.recipe_id
 where r.campaign_id=p_campaign and (app_private.is_gm(p_campaign) or (r.active and exists (
 select 1 from public.character_learned_crafting_recipes learned
 join public.characters char on char.id=learned.character_id and char.campaign_id=p_campaign and char.is_active
 join public.campaign_members member on member.id=char.member_id and member.status='active'
 where learned.recipe_id=r.id and member.user_id=(select auth.uid())
 ))) order by c.name,r.name;
end $function$;

CREATE OR REPLACE FUNCTION public.list_campaign_crafting_checks(p_campaign uuid)
 RETURNS TABLE(recipe_id uuid, minutes_per_craft integer, check_name text, attribute_code text, difficulty_class integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select auth.uid()) is null or (
  not app_private.is_gm(p_campaign) and not exists(select 1 from public.campaign_members m
  where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 ) then raise exception 'Not authorized' using errcode='42501';end if;
 return query select s.recipe_id,s.minutes_per_craft,s.check_name,s.attribute_code,s.difficulty_class
 from public.campaign_crafting_checks s join public.campaign_crafting_recipes r on r.id=s.recipe_id
 where r.campaign_id=p_campaign and (app_private.is_gm(p_campaign) or (r.active and exists (
 select 1 from public.character_learned_crafting_recipes learned
 join public.characters char on char.id=learned.character_id and char.campaign_id=p_campaign and char.is_active
 join public.campaign_members member on member.id=char.member_id and member.status='active'
 where learned.recipe_id=r.id and member.user_id=(select auth.uid())
 ))) order by r.name;
end $function$;

