-- Milestone 7.12: optional campaign crafting time and server-rolled attribute-based checks.
create table if not exists public.campaign_crafting_checks(
 recipe_id uuid primary key references public.campaign_crafting_recipes(id) on delete cascade,
 minutes_per_craft integer not null default 0 check(minutes_per_craft between 0 and 10080),
 check_name text,
 attribute_code text,
 difficulty_class integer,
 constraint crafting_check_settings_valid check (
  (attribute_code is null and difficulty_class is null and check_name is null) or
  (attribute_code is not null and difficulty_class between 1 and 40 and check_name is not null and length(trim(check_name)) between 1 and 80)
 )
);
alter table public.campaign_crafting_checks enable row level security;
revoke all on public.campaign_crafting_checks from public,anon,authenticated;

create or replace function public.set_campaign_crafting_check(p_recipe uuid,p_minutes integer,p_check_name text default null,p_attribute text default null,p_dc integer default null)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_code text:=nullif(upper(trim(coalesce(p_attribute,''))),'');
begin
 select campaign_id into v_campaign from public.campaign_crafting_recipes where id=p_recipe;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign)
 then raise exception 'GM required' using errcode='42501';end if;
 if p_minutes is null or p_minutes not between 0 and 10080 then raise exception 'Invalid crafting minutes' using errcode='22023';end if;
 if (v_code is null)<>(p_dc is null) or (v_code is null)<>(nullif(trim(coalesce(p_check_name,'')),'') is null)
 then raise exception 'Provide a check label, attribute and DC together' using errcode='22023';end if;
 if v_code is not null then
  if length(v_code)>32 or p_dc not between 1 and 40 or length(trim(p_check_name))>80
  then raise exception 'Invalid check settings' using errcode='22023';end if;
  if not exists(select 1 from public.campaigns c join public.ruleset_versions rv on rv.id=c.ruleset_version_id
    cross join lateral jsonb_array_elements_text(coalesce(c.ruleset_overrides->'attributes',rv.configuration->'attributes','[]'::jsonb)) a(code)
    where c.id=v_campaign and upper(a.code)=v_code)
  then raise exception 'Attribute unavailable in campaign ruleset' using errcode='22023';end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 insert into public.campaign_crafting_checks(recipe_id,minutes_per_craft,check_name,attribute_code,difficulty_class)
 values(p_recipe,p_minutes,case when v_code is null then null else trim(p_check_name) end,v_code,p_dc)
 on conflict(recipe_id) do update set minutes_per_craft=excluded.minutes_per_craft,
 check_name=excluded.check_name,attribute_code=excluded.attribute_code,difficulty_class=excluded.difficulty_class;
 return true;
end $function$;

create or replace function public.list_campaign_crafting_checks(p_campaign uuid)
returns table(recipe_id uuid,minutes_per_craft integer,check_name text,attribute_code text,difficulty_class integer)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if (select auth.uid()) is null or (
  not app_private.is_gm(p_campaign) and not exists(select 1 from public.campaign_members m
  where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 ) then raise exception 'Not authorized' using errcode='42501';end if;
 return query select s.recipe_id,s.minutes_per_craft,s.check_name,s.attribute_code,s.difficulty_class
 from public.campaign_crafting_checks s join public.campaign_crafting_recipes r on r.id=s.recipe_id
 where r.campaign_id=p_campaign and (r.active or app_private.is_gm(p_campaign)) order by r.name;
end $function$;

create or replace function public.craft_character_recipe_checked(p_character uuid,p_recipe uuid,p_crafts integer default 1)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_holder uuid;v_check public.campaign_crafting_checks%rowtype;
 v_recipe public.campaign_crafting_recipes%rowtype;v_modifier integer;v_roll integer;v_total integer;
 v_result jsonb;v_history uuid;v_time bigint;v_ing record;v_needed numeric;
begin
 if (select auth.uid()) is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_crafts is null or p_crafts not between 1 and 100 then raise exception 'Craft count must be 1–100' using errcode='22023';end if;
 select ch.campaign_id,h.id into v_campaign,v_holder
 from public.characters ch join public.campaign_members m on m.id=ch.member_id
 join public.inventory_holders h on h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character'
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null or v_holder is null then raise exception 'Character unauthorized' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 select * into v_recipe from public.campaign_crafting_recipes
 where id=p_recipe and campaign_id=v_campaign and active;
 if not found then raise exception 'Recipe unavailable' using errcode='22023';end if;
 select * into v_check from public.campaign_crafting_checks where recipe_id=p_recipe;
 v_time:=coalesce(v_check.minutes_per_craft,0)::bigint*p_crafts;
 -- No dice roll is made when eligible ingredient stocks or tools are missing.
 for v_ing in select definition_id,quantity from public.campaign_crafting_ingredients where recipe_id=p_recipe loop
   v_needed:=v_ing.quantity::numeric*p_crafts;
   if coalesce((select sum(i.quantity) from public.item_instances i where i.holder_id=v_holder and i.definition_id=v_ing.definition_id
     and i.container_id is null and i.condition_code='normal' and i.identified and i.custom_name is null
     and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
     and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
     and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)),0)<v_needed
   then raise exception 'Missing required crafting materials' using errcode='22023';end if;
 end loop;
 for v_ing in select definition_id,quantity from public.campaign_crafting_tools where recipe_id=p_recipe loop
   if coalesce((select sum(i.quantity) from public.item_instances i where i.holder_id=v_holder and i.definition_id=v_ing.definition_id
    and i.identified and i.condition_code='normal' and i.custom_name is null
    and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
    and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)),0)<v_ing.quantity
   then raise exception 'Missing required crafting tool' using errcode='22023';end if;
 end loop;
 if v_check.attribute_code is not null then
  select effective_modifier into v_modifier from public.list_character_derived_attributes(p_character)
  where attribute_code=v_check.attribute_code;
  if v_modifier is null then raise exception 'Character does not have a valid modifier for this check' using errcode='22023';end if;
  -- pgcrypto random bytes give an unpredictable server roll; rejection sampling avoids modulo bias.
  v_roll:=null;
  while v_roll is null loop
   v_total:=get_byte(extensions.gen_random_bytes(1),0);
   if v_total<240 then v_roll:=1+(v_total%20);end if;
  end loop;
  v_total:=v_roll+v_modifier;
  if v_total<v_check.difficulty_class then
   insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
   values(v_campaign,(select auth.uid()),'character_crafting_check_failed',jsonb_build_object(
    'character_id',p_character,'recipe_id',p_recipe,'recipe_name',v_recipe.name,
    'check_name',v_check.check_name,'attribute_code',v_check.attribute_code,'difficulty_class',v_check.difficulty_class,
    'roll',v_roll,'modifier',v_modifier,'total',v_total,'crafts',p_crafts,'minutes',v_time
   )) returning id into v_history;
   return jsonb_build_object('success',false,'transaction_id',v_history,'recipe',v_recipe.name,
    'check_name',v_check.check_name,'roll',v_roll,'modifier',v_modifier,'total',v_total,
    'difficulty_class',v_check.difficulty_class,'minutes',v_time,'consumed',false);
  end if;
 end if;
 v_result:=public.craft_character_recipe(p_character,p_recipe,p_crafts);
 update public.inventory_transactions set details=details||jsonb_build_object('minutes',v_time,
  'check_name',v_check.check_name,'attribute_code',v_check.attribute_code,'difficulty_class',v_check.difficulty_class,
  'roll',v_roll,'modifier',v_modifier,'total',v_total)
 where id=(v_result->>'transaction_id')::uuid;
 return v_result||jsonb_build_object('success',true,'minutes',v_time,'check_name',v_check.check_name,
 'roll',v_roll,'modifier',v_modifier,'total',v_total,'difficulty_class',v_check.difficulty_class);
end $function$;

create or replace function public.list_character_crafting_check_history(p_character uuid,p_limit integer default 30)
returns table(id uuid,recipe_name text,success boolean,check_name text,roll integer,modifier integer,total integer,
 difficulty_class integer,minutes bigint,output_name text,quantity numeric,occurred_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select t.id,t.details->>'recipe_name',(t.kind='character_crafting'),
 t.details->>'check_name',(t.details->>'roll')::integer,(t.details->>'modifier')::integer,
 (t.details->>'total')::integer,(t.details->>'difficulty_class')::integer,
 (t.details->>'minutes')::bigint,t.details->>'item_name',(t.details->>'quantity')::numeric,t.occurred_at
 from public.inventory_transactions t where t.campaign_id=v_campaign and t.status='active'
 and t.kind in ('character_crafting','character_crafting_check_failed')
 and t.details->>'character_id'=p_character::text
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,30),100));
end $function$;

revoke all on function public.set_campaign_crafting_check(uuid,integer,text,text,integer) from public,anon;
revoke all on function public.list_campaign_crafting_checks(uuid) from public,anon;
revoke all on function public.craft_character_recipe_checked(uuid,uuid,integer) from public,anon;
revoke all on function public.list_character_crafting_check_history(uuid,integer) from public,anon;
grant execute on function public.set_campaign_crafting_check(uuid,integer,text,text,integer) to authenticated;
grant execute on function public.list_campaign_crafting_checks(uuid) to authenticated;
grant execute on function public.craft_character_recipe_checked(uuid,uuid,integer) to authenticated;
grant execute on function public.list_character_crafting_check_history(uuid,integer) to authenticated;