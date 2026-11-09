-- Crafting system redesign: GM skills, categories, recipe scrolls, learned recipes and timed jobs.
create table if not exists public.crafting_skills(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 80),
 attribute_code text not null,
 created_at timestamptz not null default now(),
 unique(campaign_id,name),
 unique(id,campaign_id)
);
create table if not exists public.crafting_categories(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 80),
 skill_id uuid not null references public.crafting_skills(id),
 unique(campaign_id,name)
);
create table if not exists public.character_crafting_skill_bonuses(
 character_id uuid not null references public.characters(id) on delete cascade,
 skill_id uuid not null references public.crafting_skills(id) on delete cascade,
 bonus integer not null default 0 check(bonus between -30 and 30),
 primary key(character_id,skill_id)
);
create table if not exists public.crafting_recipe_progression(
 recipe_id uuid primary key references public.campaign_crafting_recipes(id) on delete cascade,
 category_id uuid not null references public.crafting_categories(id),
 learn_dc integer not null check(learn_dc between 1 and 40),
 craft_dc integer not null check(craft_dc between 1 and 40),
 time_mode text not null check(time_mode in ('game','realtime')),
 minutes_per_craft integer not null check(minutes_per_craft between 0 and 10080),
 recipe_item_id uuid not null unique references public.item_definitions(id)
);
create table if not exists public.character_learned_crafting_recipes(
 character_id uuid not null references public.characters(id) on delete cascade,
 recipe_id uuid not null references public.campaign_crafting_recipes(id) on delete cascade,
 learned_at timestamptz not null default now(),
 primary key(character_id,recipe_id)
);
create table if not exists public.character_crafting_jobs(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 character_id uuid not null references public.characters(id) on delete cascade,
 recipe_id uuid not null references public.campaign_crafting_recipes(id),
 crafts integer not null check(crafts between 1 and 100),
 status text not null check(status in ('pending','completed','failed')),
 started_at timestamptz not null default now(),
 ready_at timestamptz not null,
 completed_at timestamptz,
 check_roll integer,
 check_modifier integer,
 check_total integer,
 check_dc integer,
 success boolean,
 output_definition_id uuid not null references public.item_definitions(id),
 output_quantity integer not null,
 consumed jsonb not null,
 transaction_id uuid references public.inventory_transactions(id)
);
create index if not exists character_crafting_jobs_character_idx on public.character_crafting_jobs(character_id,ready_at desc);
do $do$ declare t text;
begin foreach t in array array['crafting_skills','crafting_categories','character_crafting_skill_bonuses','crafting_recipe_progression','character_learned_crafting_recipes','character_crafting_jobs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
end loop;end $do$;

create or replace function public.save_crafting_skill(p_campaign uuid,p_name text,p_attribute text,p_skill uuid default null)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;v_code text:=upper(trim(coalesce(p_attribute,'')));
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 80 then raise exception 'Invalid skill name' using errcode='22023';end if;
 if not exists(select 1 from public.campaigns c join public.ruleset_versions rv on rv.id=c.ruleset_version_id
 cross join lateral jsonb_array_elements_text(coalesce(c.ruleset_overrides->'attributes',rv.configuration->'attributes','[]'::jsonb)) a(code)
 where c.id=p_campaign and upper(a.code)=v_code) then raise exception 'Unknown ruleset attribute' using errcode='22023';end if;
 if p_skill is null then
 insert into public.crafting_skills(campaign_id,name,attribute_code) values(p_campaign,trim(p_name),v_code) returning id into v_id;
 else
 update public.crafting_skills set name=trim(p_name),attribute_code=v_code where id=p_skill and campaign_id=p_campaign returning id into v_id;
 if v_id is null then raise exception 'Skill not found' using errcode='22023';end if;
 end if;
 return v_id;
end $function$;

create or replace function public.save_crafting_category(p_campaign uuid,p_name text,p_skill uuid,p_category uuid default null)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 80 then raise exception 'Invalid category name' using errcode='22023';end if;
 if not exists(select 1 from public.crafting_skills s where s.id=p_skill and s.campaign_id=p_campaign) then raise exception 'Skill not in campaign' using errcode='22023';end if;
 if p_category is null then insert into public.crafting_categories(campaign_id,name,skill_id) values(p_campaign,trim(p_name),p_skill) returning id into v_id;
 else update public.crafting_categories set name=trim(p_name),skill_id=p_skill where id=p_category and campaign_id=p_campaign returning id into v_id;
 if v_id is null then raise exception 'Category not found' using errcode='22023';end if;end if;
 return v_id;
end $function$;

create or replace function public.list_crafting_professions(p_campaign uuid)
returns table(skill_id uuid,skill_name text,attribute_code text,category_id uuid,category_name text)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if (select auth.uid()) is null or (not app_private.is_gm(p_campaign) and
 not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select s.id,s.name,s.attribute_code,c.id,c.name from public.crafting_skills s
 left join public.crafting_categories c on c.skill_id=s.id and c.campaign_id=p_campaign
 where s.campaign_id=p_campaign order by s.name,c.name;
end $function$;

create or replace function public.set_character_crafting_skill_bonus(p_character uuid,p_skill uuid,p_bonus integer)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign)
 then raise exception 'GM required' using errcode='42501';end if;
 if not exists(select 1 from public.crafting_skills s where s.id=p_skill and s.campaign_id=v_campaign)
 then raise exception 'Invalid skill' using errcode='22023';end if;
 if p_bonus is null or p_bonus not between -30 and 30 then raise exception 'Bonus range -30 to 30' using errcode='22023';end if;
 insert into public.character_crafting_skill_bonuses(character_id,skill_id,bonus) values(p_character,p_skill,p_bonus)
 on conflict(character_id,skill_id) do update set bonus=excluded.bonus;
 return true;
end $function$;

create or replace function public.list_character_crafting_skills(p_character uuid)
returns table(skill_id uuid,skill_name text,attribute_code text,attribute_modifier integer,skill_bonus integer,total_modifier integer)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then
 select ch.campaign_id into v_campaign from public.characters ch where ch.id=p_character and app_private.is_gm(ch.campaign_id);
 end if;
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select s.id,s.name,s.attribute_code,coalesce(a.effective_modifier,0),
 coalesce(b.bonus,0),coalesce(a.effective_modifier,0)+coalesce(b.bonus,0)
 from public.crafting_skills s
 left join public.character_crafting_skill_bonuses b on b.character_id=p_character and b.skill_id=s.id
 left join public.list_character_derived_attributes(p_character) a on a.attribute_code=s.attribute_code
 where s.campaign_id=v_campaign order by s.name;
end $function$;

create or replace function public.configure_crafting_recipe_learning(
 p_recipe uuid,p_category uuid,p_learn_dc integer,p_craft_dc integer,p_time_mode text,p_minutes integer
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_item uuid;v_name text;
begin
 select r.campaign_id,r.name into v_campaign,v_name from public.campaign_crafting_recipes r where r.id=p_recipe for update;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign)
 then raise exception 'GM required' using errcode='42501';end if;
 if not exists(select 1 from public.crafting_categories c where c.id=p_category and c.campaign_id=v_campaign)
 then raise exception 'Category not in campaign' using errcode='22023';end if;
 if p_learn_dc is null or p_learn_dc not between 1 and 40 or p_craft_dc is null or p_craft_dc not between 1 and 40
 or p_time_mode not in ('game','realtime') or p_minutes is null or p_minutes not between 0 and 10080
 then raise exception 'Invalid progression settings' using errcode='22023';end if;
 select p.recipe_item_id into v_item from public.crafting_recipe_progression p where p.recipe_id=p_recipe;
 if v_item is null then
 insert into public.item_definitions(campaign_id,code,name,category,description,default_properties)
 values(v_campaign,'recipe-'||replace(p_recipe::text,'-',''),'Recipe: '||left(v_name,110),'recipe','Consume to learn the crafting recipe',
 jsonb_build_object('consumable',true,'recipe_id',p_recipe)) returning id into v_item;
 else update public.item_definitions set name='Recipe: '||left(v_name,110),
 default_properties=jsonb_build_object('consumable',true,'recipe_id',p_recipe)
 where id=v_item and campaign_id=v_campaign;end if;
 insert into public.crafting_recipe_progression(recipe_id,category_id,learn_dc,craft_dc,time_mode,minutes_per_craft,recipe_item_id)
 values(p_recipe,p_category,p_learn_dc,p_craft_dc,p_time_mode,p_minutes,v_item)
 on conflict(recipe_id) do update set category_id=excluded.category_id,learn_dc=excluded.learn_dc,
 craft_dc=excluded.craft_dc,time_mode=excluded.time_mode,minutes_per_craft=excluded.minutes_per_craft;
 return v_item;
end $function$;

create or replace function public.list_crafting_recipe_progression(p_campaign uuid)
returns table(recipe_id uuid,category_id uuid,category_name text,skill_id uuid,skill_name text,
 attribute_code text,learn_dc integer,craft_dc integer,time_mode text,minutes_per_craft integer,recipe_item_id uuid)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if (select auth.uid()) is null or (not app_private.is_gm(p_campaign) and
 not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select p.recipe_id,c.id,c.name,s.id,s.name,s.attribute_code,p.learn_dc,p.craft_dc,p.time_mode,p.minutes_per_craft,p.recipe_item_id
 from public.crafting_recipe_progression p join public.crafting_categories c on c.id=p.category_id
 join public.crafting_skills s on s.id=c.skill_id join public.campaign_crafting_recipes r on r.id=p.recipe_id
 where r.campaign_id=p_campaign and (r.active or app_private.is_gm(p_campaign)) order by c.name,r.name;
end $function$;

create or replace function public.list_character_learned_crafting_recipes(p_character uuid)
returns table(recipe_id uuid,learned_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select l.recipe_id,l.learned_at from public.character_learned_crafting_recipes l
 join public.campaign_crafting_recipes r on r.id=l.recipe_id where l.character_id=p_character and r.campaign_id=v_campaign;
end $function$;

create or replace function public.list_character_recipe_items(p_character uuid)
returns table(item_id uuid,recipe_id uuid,recipe_name text,category_name text,skill_name text,learn_dc integer,quantity numeric)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select i.id,r.id,r.name,c.name,s.name,p.learn_dc,i.quantity
 from public.item_instances i join public.inventory_holders h on h.id=i.holder_id
 join public.crafting_recipe_progression p on p.recipe_item_id=i.definition_id
 join public.campaign_crafting_recipes r on r.id=p.recipe_id and r.active
 join public.crafting_categories c on c.id=p.category_id join public.crafting_skills s on s.id=c.skill_id
 where h.character_id=p_character and h.holder_type='character' and i.campaign_id=v_campaign
 and i.container_id is null and i.identified and i.condition_code='normal'
 and i.custom_name is null and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb
 and not exists(select 1 from public.character_learned_crafting_recipes l where l.recipe_id=r.id and l.character_id=p_character)
 order by c.name,r.name;
end $function$;

do $do$ declare sig text;
begin foreach sig in array array[
 'save_crafting_skill(uuid,text,text,uuid)','save_crafting_category(uuid,text,uuid,uuid)',
 'list_crafting_professions(uuid)','set_character_crafting_skill_bonus(uuid,uuid,integer)',
 'list_character_crafting_skills(uuid)','configure_crafting_recipe_learning(uuid,uuid,integer,integer,text,integer)',
 'list_crafting_recipe_progression(uuid)','list_character_learned_crafting_recipes(uuid)',
 'list_character_recipe_items(uuid)'
 ] loop
 execute format('revoke all on function public.%s from public,anon',sig);
 execute format('grant execute on function public.%s to authenticated',sig);
end loop;end $do$;