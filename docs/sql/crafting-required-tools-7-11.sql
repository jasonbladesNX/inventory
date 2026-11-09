-- Milestone 7.11: Tools are possession prerequisites; crafting does not consume them.
create table if not exists public.campaign_crafting_tools(
 recipe_id uuid not null references public.campaign_crafting_recipes(id) on delete cascade,
 definition_id uuid not null references public.item_definitions(id),
 quantity integer not null check(quantity between 1 and 500),
 primary key(recipe_id,definition_id)
);
alter table public.campaign_crafting_tools enable row level security;
revoke all on public.campaign_crafting_tools from public,anon,authenticated;
create or replace function public.set_campaign_crafting_tools(p_recipe uuid,p_tools jsonb)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_entry jsonb;v_def uuid;v_qty int;v_seen uuid[]:=array[]::uuid[];
begin
 select r.campaign_id into v_campaign from public.campaign_crafting_recipes r where r.id=p_recipe;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign)
 then raise exception 'GM required' using errcode='42501';end if;
 if p_tools is null or jsonb_typeof(p_tools)<>'array' or jsonb_array_length(p_tools)>20 then
 raise exception 'Tools must be an array of up to 20 requirements' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_campaign::text));
 perform 1 from public.campaign_crafting_recipes where id=p_recipe for update;
 for v_entry in select value from jsonb_array_elements(p_tools) loop
   if jsonb_typeof(v_entry)<>'object'
   or coalesce(v_entry->>'definition_id','')!~ '^[0-9a-fA-F-]{36}$'
   or coalesce(v_entry->>'quantity','')!~ '^[0-9]{1,3}$'
   then raise exception 'Invalid tool entry' using errcode='22023';end if;
   v_def:=(v_entry->>'definition_id')::uuid;v_qty:=(v_entry->>'quantity')::integer;
   if v_qty not between 1 and 500 or v_def=any(v_seen) then raise exception 'Duplicate or invalid tool' using errcode='22023';end if;
   if not exists(select 1 from public.item_definitions d join public.campaigns c on c.id=v_campaign
   where d.id=v_def and (d.campaign_id=v_campaign or (d.campaign_id is null and d.ruleset_version_id=c.ruleset_version_id)))
   then raise exception 'Tool not in campaign catalog' using errcode='22023';end if;
   if exists(select 1 from public.campaign_crafting_ingredients ing where ing.recipe_id=p_recipe and ing.definition_id=v_def)
   then raise exception 'A required tool cannot also be a consumed ingredient' using errcode='22023';end if;
   v_seen:=array_append(v_seen,v_def);
 end loop;
 delete from public.campaign_crafting_tools where recipe_id=p_recipe;
 for v_entry in select value from jsonb_array_elements(p_tools) loop
   insert into public.campaign_crafting_tools(recipe_id,definition_id,quantity)
   values(p_recipe,(v_entry->>'definition_id')::uuid,(v_entry->>'quantity')::integer);
 end loop;
 return true;
end $function$;

create or replace function public.list_campaign_crafting_tools(p_campaign uuid)
returns table(recipe_id uuid,definition_id uuid,name text,quantity integer)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if (select auth.uid()) is null or
  (not app_private.is_gm(p_campaign) and not exists(select 1 from public.campaign_members m
   where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 return query select t.recipe_id,t.definition_id,d.name,t.quantity
 from public.campaign_crafting_tools t
 join public.campaign_crafting_recipes r on r.id=t.recipe_id
 join public.item_definitions d on d.id=t.definition_id
 where r.campaign_id=p_campaign and (r.active or app_private.is_gm(p_campaign))
 order by r.name,d.name;
end $function$;

create or replace function public.list_character_crafting_tools(p_character uuid)
returns table(definition_id uuid,name text,available numeric)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select ch.campaign_id into v_campaign from public.characters ch join public.campaign_members m on m.id=ch.member_id
 where ch.id=p_character and ch.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select i.definition_id,d.name,sum(i.quantity)::numeric from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id join public.item_definitions d on d.id=i.definition_id
 where h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character'
 and i.identified and i.condition_code='normal' and i.custom_name is null
 and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb and i.quantity=trunc(i.quantity)
 and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)
 group by i.definition_id,d.name order by d.name;
end $function$;

revoke all on function public.set_campaign_crafting_tools(uuid,jsonb) from public,anon;
revoke all on function public.list_campaign_crafting_tools(uuid) from public,anon;
revoke all on function public.list_character_crafting_tools(uuid) from public,anon;
grant execute on function public.set_campaign_crafting_tools(uuid,jsonb) to authenticated;
grant execute on function public.list_campaign_crafting_tools(uuid) to authenticated;
grant execute on function public.list_character_crafting_tools(uuid) to authenticated;