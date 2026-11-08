-- Milestone 7.10 Phase 1: campaign recipes and atomic character crafting.
create table if not exists public.campaign_crafting_recipes(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 120),
 description text not null default '',
 output_definition_id uuid not null references public.item_definitions(id),
 output_quantity integer not null default 1 check(output_quantity between 1 and 500),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.campaign_crafting_ingredients(
 recipe_id uuid not null references public.campaign_crafting_recipes(id) on delete cascade,
 definition_id uuid not null references public.item_definitions(id),
 quantity integer not null check(quantity between 1 and 100000),
 primary key(recipe_id,definition_id)
);
create index if not exists campaign_crafting_recipes_campaign_idx on public.campaign_crafting_recipes(campaign_id);
alter table public.campaign_crafting_recipes enable row level security;
alter table public.campaign_crafting_ingredients enable row level security;
revoke all on public.campaign_crafting_recipes,public.campaign_crafting_ingredients from public,anon,authenticated;

create or replace function public.save_campaign_crafting_recipe(
 p_campaign uuid,p_name text,p_output uuid,p_output_quantity integer,p_ingredients jsonb,
 p_description text default '',p_recipe uuid default null,p_active boolean default true
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_recipe uuid;v_entry jsonb;v_definition uuid;v_qty integer;v_count integer:=0;v_keys uuid[]:=array[]::uuid[];
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 or p_output_quantity is null or p_output_quantity not between 1 and 500
 then raise exception 'Invalid recipe name or output quantity' using errcode='22023';end if;
 if p_ingredients is null or jsonb_typeof(p_ingredients)<>'array' or jsonb_array_length(p_ingredients) not between 1 and 20
 then raise exception 'Recipe requires 1–20 ingredients' using errcode='22023';end if;
 if not exists(select 1 from public.item_definitions d join public.campaigns c on c.id=p_campaign
 where d.id=p_output and (d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=c.ruleset_version_id)))
 then raise exception 'Output not available in campaign' using errcode='22023';end if;
 for v_entry in select value from jsonb_array_elements(p_ingredients) loop
   if jsonb_typeof(v_entry)<>'object' or coalesce(v_entry->>'definition_id','') !~ '^[0-9a-fA-F-]{36}$'
   or coalesce(v_entry->>'quantity','') !~ '^[0-9]{1,6}$' then raise exception 'Invalid ingredient format' using errcode='22023';end if;
   v_definition:=(v_entry->>'definition_id')::uuid;
   v_qty:=(v_entry->>'quantity')::integer;
   if v_qty not between 1 and 100000 or v_definition=any(v_keys) then raise exception 'Duplicate ingredient or invalid quantity' using errcode='22023';end if;
   if not exists(select 1 from public.item_definitions d join public.campaigns c on c.id=p_campaign
   where d.id=v_definition and (d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=c.ruleset_version_id)))
   then raise exception 'Ingredient not available in campaign' using errcode='22023';end if;
   v_keys:=array_append(v_keys,v_definition);
 end loop;
 if p_recipe is null then
   insert into public.campaign_crafting_recipes(campaign_id,name,description,output_definition_id,output_quantity,active)
   values(p_campaign,trim(p_name),left(coalesce(p_description,''),500),p_output,p_output_quantity,coalesce(p_active,true))
   returning id into v_recipe;
 else
   select id into v_recipe from public.campaign_crafting_recipes where id=p_recipe and campaign_id=p_campaign for update;
   if v_recipe is null then raise exception 'Recipe not found in campaign' using errcode='22023';end if;
   update public.campaign_crafting_recipes set name=trim(p_name),description=left(coalesce(p_description,''),500),
   output_definition_id=p_output,output_quantity=p_output_quantity,active=coalesce(p_active,true) where id=v_recipe;
   delete from public.campaign_crafting_ingredients where recipe_id=v_recipe;
 end if;
 for v_entry in select value from jsonb_array_elements(p_ingredients) loop
   insert into public.campaign_crafting_ingredients(recipe_id,definition_id,quantity)
   values(v_recipe,(v_entry->>'definition_id')::uuid,(v_entry->>'quantity')::integer);
 end loop;
 return v_recipe;
end $function$;

create or replace function public.list_campaign_crafting_recipes(p_campaign uuid)
returns table(id uuid,name text,description text,output_definition_id uuid,output_name text,output_quantity integer,active boolean,ingredients jsonb)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_gm boolean;
begin
 v_gm:=app_private.is_gm(p_campaign);
 if not v_gm and not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select r.id,r.name,r.description,r.output_definition_id,d.name,r.output_quantity,r.active,
 (select coalesce(jsonb_agg(jsonb_build_object('definition_id',ing.definition_id,'name',def.name,'quantity',ing.quantity) order by def.name),'[]'::jsonb)
  from public.campaign_crafting_ingredients ing join public.item_definitions def on def.id=ing.definition_id where ing.recipe_id=r.id)
 from public.campaign_crafting_recipes r join public.item_definitions d on d.id=r.output_definition_id
 where r.campaign_id=p_campaign and (r.active or v_gm) order by r.name,r.id;
end $function$;

create or replace function public.list_character_crafting_materials(p_character uuid)
returns table(definition_id uuid,name text,available numeric)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select i.definition_id,d.name,sum(i.quantity)::numeric
 from public.item_instances i join public.inventory_holders h on h.id=i.holder_id
 join public.item_definitions d on d.id=i.definition_id
 where h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character'
 and i.container_id is null and i.condition_code='normal' and i.identified and i.custom_name is null
 and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
 and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
 and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)
 group by i.definition_id,d.name order by d.name;
end $function$;

create or replace function public.craft_character_recipe(p_character uuid,p_recipe uuid,p_crafts integer default 1)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_holder uuid;
 v_recipe public.campaign_crafting_recipes%rowtype;v_ing record;v_stock record;v_needed numeric;
 v_remaining numeric;v_take numeric;v_id uuid;v_index integer;v_total_output integer;
 v_txn uuid;v_output_name text;v_consumed jsonb:='[]'::jsonb;
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
 'crafts',p_crafts,'ingredients',v_consumed)) returning id into v_txn;
 return jsonb_build_object('transaction_id',v_txn,'recipe',v_recipe.name,'output',v_output_name,'quantity',v_total_output,'crafts',p_crafts);
end $function$;

create or replace function public.list_character_crafting_history(p_character uuid,p_limit integer default 30)
returns table(id uuid,recipe_name text,output_name text,quantity numeric,crafts integer,occurred_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select t.id,t.details->>'recipe_name',t.details->>'item_name',
 (t.details->>'quantity')::numeric,(t.details->>'crafts')::integer,t.occurred_at
 from public.inventory_transactions t where t.campaign_id=v_campaign and t.status='active'
 and t.kind='character_crafting' and t.details->>'character_id'=p_character::text
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,30),100));
end $function$;

revoke all on function public.save_campaign_crafting_recipe(uuid,text,uuid,integer,jsonb,text,uuid,boolean) from public,anon;
revoke all on function public.list_campaign_crafting_recipes(uuid) from public,anon;
revoke all on function public.list_character_crafting_materials(uuid) from public,anon;
revoke all on function public.craft_character_recipe(uuid,uuid,integer) from public,anon;
revoke all on function public.list_character_crafting_history(uuid,integer) from public,anon;
grant execute on function public.save_campaign_crafting_recipe(uuid,text,uuid,integer,jsonb,text,uuid,boolean) to authenticated;
grant execute on function public.list_campaign_crafting_recipes(uuid) to authenticated;
grant execute on function public.list_character_crafting_materials(uuid) to authenticated;
grant execute on function public.craft_character_recipe(uuid,uuid,integer) to authenticated;
grant execute on function public.list_character_crafting_history(uuid,integer) to authenticated;