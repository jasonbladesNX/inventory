-- Milestone 7.13: campaign-defined item categories (separate from crafting_categories).
-- Stable opaque category codes let labels change without rewriting item/recipe history.
create table if not exists public.campaign_item_categories(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 code text not null,
 name text not null,
 description text not null default '',
 default_stackable boolean not null default true,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(campaign_id,code),
 constraint campaign_item_category_name_length check(length(btrim(name)) between 2 and 70),
 constraint campaign_item_category_description_length check(length(description)<=500),
 constraint campaign_item_category_code check(code ~ '^custom_[a-f0-9]{32}$')
);
create unique index if not exists campaign_item_categories_name_ci
 on public.campaign_item_categories(campaign_id,lower(btrim(name)));
create index if not exists campaign_item_categories_campaign
 on public.campaign_item_categories(campaign_id);
alter table public.campaign_item_categories enable row level security;
revoke all on public.campaign_item_categories from public,anon,authenticated;

create or replace function public.list_campaign_item_categories(p_campaign uuid)
returns table(id uuid,code text,name text,description text,default_stackable boolean,active boolean)
language plpgsql stable security definer set search_path=''
as $fn$
begin
 if (select auth.uid()) is null or not (
   app_private.is_gm(p_campaign)
   or exists(select 1 from public.campaign_members m
     where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 ) then raise exception 'Not authorized for campaign categories' using errcode='42501'; end if;
 return query select c.id,c.code,c.name,c.description,c.default_stackable,c.active
 from public.campaign_item_categories c where c.campaign_id=p_campaign order by c.name,c.id;
end $fn$;

create or replace function public.save_campaign_item_category(
 p_campaign uuid,p_category_id uuid,p_name text,p_description text,p_default_stackable boolean,p_active boolean
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_id uuid;v_code text;v_old_code text;v_name text:=btrim(coalesce(p_name,''));v_active boolean:=coalesce(p_active,true);
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
  raise exception 'GM permission required' using errcode='42501';end if;
 if length(v_name) not between 2 and 70 or length(coalesce(p_description,''))>500 or p_default_stackable is null then
  raise exception 'Category must have a 2–70 character name, description up to 500 characters and a stacking default' using errcode='22023';end if;
 if lower(v_name)=any(array['general gear','ingredient','consumable','weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','spellcasting focus','tool','wondrous item','container','recipe','gear','ammunition','material','component','misc','supplies']) then
  raise exception 'That name is reserved for a built-in category' using errcode='22023';end if;
 if p_category_id is null then
  v_code:='custom_'||replace(gen_random_uuid()::text,'-','');
  insert into public.campaign_item_categories(campaign_id,code,name,description,default_stackable,active)
  values(p_campaign,v_code,v_name,coalesce(p_description,''),p_default_stackable,v_active)
  returning id into v_id;
 else
  select c.code into v_old_code from public.campaign_item_categories c
   where c.id=p_category_id and c.campaign_id=p_campaign for update;
  if not found then raise exception 'Category not found in this campaign' using errcode='22023';end if;
  if not v_active and exists(select 1 from public.item_definitions d
    where d.campaign_id=p_campaign and d.category=v_old_code) then
    raise exception 'Reassign items before deactivating this category' using errcode='22023';end if;
  update public.campaign_item_categories set name=v_name,description=coalesce(p_description,''),
    default_stackable=p_default_stackable,active=v_active where id=p_category_id;
  v_id:=p_category_id;v_code:=v_old_code;
 end if;
 return jsonb_build_object('id',v_id,'code',v_code,'name',v_name,'active',v_active,'default_stackable',p_default_stackable);
end $fn$;

-- Existing stacking safeguards retained; custom categories are eligible when valid.
create or replace function public.set_campaign_item_stackable(p_campaign uuid,p_definition uuid,p_stackable boolean)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_category text;v_props jsonb;v_item record;v_merged integer:=0;v_target uuid;v_custom boolean;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign)
 then raise exception 'GM permission required' using errcode='42501';end if;
 if p_stackable is null then raise exception 'Specify whether this item is stackable' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_campaign::text));
 select category,default_properties into v_category,v_props
 from public.item_definitions where id=p_definition and campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in campaign' using errcode='22023';end if;
 select exists(select 1 from public.campaign_item_categories c
  where c.campaign_id=p_campaign and c.code=v_category) into v_custom;
 if (v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') and not v_custom)
 or v_category in ('weapon','armor','shield','ring','jewelry','headgear','footwear','clothing','focus','wondrous','container','tool')
 or coalesce(v_props->>'equippable','false')='true'
 or coalesce(v_props->>'unique','false')='true'
 or exists(select 1 from public.equipment_slot_definitions s
 where s.campaign_id=p_campaign and v_category=any(s.allowed_categories))
 or exists(select 1 from public.item_effects e where e.item_definition_id=p_definition)
 then raise exception 'Equipment and items with persistent effects cannot be stackable' using errcode='22023';end if;
 if not p_stackable and (v_category='consumable' or coalesce(v_props->>'consumable','false')='true' or v_props ? 'use_effect')
 then raise exception 'Usable consumables must remain stackable; disable Use first' using errcode='22023';end if;
 if not p_stackable and exists(select 1 from public.item_instances i where i.definition_id=p_definition and i.quantity>1)
 then raise exception 'Split existing stacks into individual units before disabling stacking' using errcode='22023';end if;
 update public.item_definitions
 set default_properties=jsonb_set(coalesce(default_properties,'{}'::jsonb),'{stackable}',to_jsonb(p_stackable),true)
 where id=p_definition and campaign_id=p_campaign;
 if p_stackable then
   for v_item in select i.id from public.item_instances i where i.campaign_id=p_campaign
    and i.definition_id=p_definition order by i.id desc loop
    v_target:=app_private.consolidate_item_location(v_item.id);
    if v_target is distinct from v_item.id then v_merged:=v_merged+1;end if;
   end loop;
 end if;
 return jsonb_build_object('definition_id',p_definition,'stackable',p_stackable,'merged_stacks',v_merged);
end $fn$;

-- Check custom-code validity in the canonical GM creation path.
create or replace function public.create_campaign_custom_item_with_stacking(
 p_campaign uuid,p_name text,p_category text,p_bonus_attribute text,p_bonus numeric,
 p_two_handed boolean,p_consumable boolean,p_use_effect jsonb,p_stackable boolean
) returns uuid language plpgsql security definer set search_path=''
as $fn$
declare v_id uuid;v_custom boolean;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
  raise exception 'GM required' using errcode='42501';end if;
 if p_stackable is null then raise exception 'Stackable preference required' using errcode='22023';end if;
 select exists(select 1 from public.campaign_item_categories c where c.campaign_id=p_campaign
  and c.code=p_category and c.active) into v_custom;
 if p_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies',
 'weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','container','recipe')
 and not v_custom then
  raise exception 'Select an active category in this campaign' using errcode='22023';end if;
 v_id:=public.create_campaign_custom_item_with_effect(p_campaign,p_name,p_category,p_bonus_attribute,p_bonus,p_two_handed,p_consumable,p_use_effect);
 if p_category in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') or v_custom then
   perform public.set_campaign_item_stackable(p_campaign,v_id,p_stackable);
 elsif p_stackable then
   raise exception 'Equippable or special items must remain non-stackable' using errcode='22023';
 end if;
 return v_id;
end $fn$;

-- Change a custom item's category in-place, without altering its definition ID.
create or replace function public.set_campaign_item_category(p_campaign uuid,p_definition uuid,p_category text)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_old text;v_props jsonb;v_eligible boolean;v_stackable boolean;v_default boolean;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM permission required' using errcode='42501';end if;
 if p_category is null or btrim(p_category)='' then raise exception 'Category required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_campaign::text));
 select d.category,d.default_properties into v_old,v_props from public.item_definitions d
   where d.id=p_definition and d.campaign_id=p_campaign for update;
 if not found then raise exception 'Custom item not found in this campaign' using errcode='22023';end if;
 if v_old=p_category then return jsonb_build_object('definition_id',p_definition,'category',p_category);end if;
 if exists(select 1 from public.equipment_assignments e join public.item_instances i
    on i.id=e.item_instance_id where i.definition_id=p_definition) then
  raise exception 'Unequip existing copies before changing category' using errcode='22023';end if;
 select c.default_stackable into v_default from public.campaign_item_categories c
   where c.campaign_id=p_campaign and c.code=p_category and c.active;
 if not found and p_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies',
 'weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','container','recipe')
 then raise exception 'Select an active category in this campaign' using errcode='22023';end if;
 v_eligible:=p_category in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies') or v_default is not null;
 if not v_eligible and exists(select 1 from public.item_instances i where i.definition_id=p_definition and i.quantity>1)
 then raise exception 'Split existing stacks before assigning an equipment category' using errcode='22023';end if;
 update public.item_definitions set category=p_category where id=p_definition and campaign_id=p_campaign;
 if v_eligible then
   v_stackable:=case when v_props ? 'stackable'
      then coalesce((v_props->>'stackable')::boolean,false)
      else coalesce(v_default,true) end;
   if coalesce(v_props->>'consumable','false')='true' or v_props ? 'use_effect' then v_stackable:=true;end if;
   perform public.set_campaign_item_stackable(p_campaign,p_definition,v_stackable);
 else
   update public.item_definitions set default_properties=jsonb_set(coalesce(default_properties,'{}'::jsonb),
     '{stackable}','false'::jsonb,true) where id=p_definition;
 end if;
 return jsonb_build_object('definition_id',p_definition,'category',p_category);
end $fn$;

revoke all on function public.list_campaign_item_categories(uuid) from public,anon;
revoke all on function public.save_campaign_item_category(uuid,uuid,text,text,boolean,boolean) from public,anon;
revoke all on function public.set_campaign_item_category(uuid,uuid,text) from public,anon;
revoke all on function public.set_campaign_item_stackable(uuid,uuid,boolean) from public,anon;
revoke all on function public.create_campaign_custom_item_with_stacking(uuid,text,text,text,numeric,boolean,boolean,jsonb,boolean) from public,anon;
grant execute on function public.list_campaign_item_categories(uuid) to authenticated;
grant execute on function public.save_campaign_item_category(uuid,uuid,text,text,boolean,boolean) to authenticated;
grant execute on function public.set_campaign_item_category(uuid,uuid,text) to authenticated;
grant execute on function public.set_campaign_item_stackable(uuid,uuid,boolean) to authenticated;
grant execute on function public.create_campaign_custom_item_with_stacking(uuid,text,text,text,numeric,boolean,boolean,jsonb,boolean) to authenticated;