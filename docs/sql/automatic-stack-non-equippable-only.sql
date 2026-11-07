-- Nexus Multiverse automatic stack rules.
-- Non-equippable compatible supplies consolidate after secure acquisitions
-- and standard item moves. Equippable gear always acquired as individual units.
-- Restricted helper execution; public actions keep their existing authorization.
CREATE OR REPLACE FUNCTION app_private.item_can_auto_stack(p_definition uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce((
 select (d.category in ('gear','consumable','ammunition','material','component','misc','supplies')
        or d.default_properties->>'stackable'='true')
   and d.category not in ('weapon','armor','shield','ring','jewelry','headgear','footwear','clothing','focus','wondrous','container','tool')
   and coalesce(d.default_properties->>'stackable','true') <> 'false'
   and not exists (
     select 1 from public.equipment_slot_definitions slot
     where slot.campaign_id=d.campaign_id and d.category=any(slot.allowed_categories)
   )
 from public.item_definitions d where d.id=p_definition),false)
$function$
;

CREATE OR REPLACE FUNCTION app_private.consolidate_item_location(p_item uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_source public.item_instances%rowtype;v_target uuid;
begin
 select * into v_source from public.item_instances where id=p_item for update;
 if not found then return p_item;end if;
 if not app_private.item_can_auto_stack(v_source.definition_id) then return p_item;end if;
 if exists(select 1 from app_private.character_item_favorites f where f.item_id=p_item)
    or exists(select 1 from public.equipment_assignments a where a.item_instance_id=p_item)
    or exists(select 1 from public.transaction_lines l where l.item_instance_id=p_item)
    or exists(select 1 from public.loot_claim_items l where l.item_instance_id=p_item)
    or exists(select 1 from public.merchant_stock m where m.item_instance_id=p_item)
    or exists(select 1 from public.item_effects e where e.item_instance_id=p_item)
    or exists(select 1 from public.containers c where c.properties->>'source_item_id'=p_item::text)
 then return p_item;end if;
 select i.id into v_target from public.item_instances i
 where i.id<>v_source.id and i.campaign_id=v_source.campaign_id
   and i.holder_id=v_source.holder_id and i.container_id is not distinct from v_source.container_id
   and i.definition_id=v_source.definition_id and i.condition_code=v_source.condition_code
   and i.identified=v_source.identified and i.custom_name is not distinct from v_source.custom_name
   and i.properties=v_source.properties and i.private_properties=v_source.private_properties
   and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
 order by i.id limit 1 for update of i;
 if v_target is null then return p_item;end if;
 update public.item_instances set quantity=quantity+v_source.quantity,version=version+1 where id=v_target;
 delete from public.item_instances where id=p_item;
 return v_target;
end $function$
;

CREATE OR REPLACE FUNCTION public.add_inventory_item(p_campaign uuid, p_character uuid, p_definition uuid, p_quantity numeric DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); hid uuid; iid uuid; cfg jsonb; allowed boolean;idx integer;
begin
 if uid is null or p_quantity is null or p_quantity <> trunc(p_quantity) or p_quantity <= 0 or p_quantity > 1000000 then raise exception 'Invalid request'; end if;
 select (c.settings->>'approval_required')::boolean into allowed from public.campaigns c where c.id=p_campaign;
 if coalesce(allowed,false) then raise exception 'GM approval is enabled; use approval workflow'; end if;
 if not (app_private.is_gm(p_campaign) or exists(select 1 from public.characters ch join public.campaign_members m on m.id=ch.member_id where ch.id=p_character and ch.campaign_id=p_campaign and m.user_id=uid and m.status='active')) then raise exception 'Not authorized'; end if;
 select h.id into hid from public.inventory_holders h where h.campaign_id=p_campaign and h.character_id=p_character;
 if hid is null then raise exception 'Character inventory not found'; end if;
 if not exists(select 1 from public.item_definitions d join public.campaigns c on c.id=p_campaign where d.id=p_definition and (d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=c.ruleset_version_id))) then raise exception 'Invalid item'; end if;
 if not app_private.item_can_auto_stack(p_definition) and p_quantity>500 then raise exception 'Too many individual equipment items in one operation' using errcode='22023';end if;
 if app_private.item_can_auto_stack(p_definition) then
  insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
  values(p_campaign,p_definition,hid,p_quantity) returning id into iid;
  iid:=app_private.consolidate_item_location(iid);
 else
  for idx in 1..p_quantity::integer loop
   insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
   values(p_campaign,p_definition,hid,1) returning id into iid;
  end loop;
 end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details) values(p_campaign,uid,'acquisition',jsonb_build_object('item_id',iid,'quantity',p_quantity,'character_id',p_character));
 return iid;
end $function$
;

CREATE OR REPLACE FUNCTION public.move_character_item_storage(p_character uuid, p_item uuid, p_container_item uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_campaign uuid; v_holder uuid; v_current uuid; v_box uuid;
 v_item_category text; v_destination_category text; v_destination_code text; v_destination_name text;
 v_limit numeric; v_item_weight numeric; v_existing_weight numeric;
 v_limit_text text; v_weight_text text; v_bad_count integer;
begin
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active for update;
 if v_campaign is null or not (
   app_private.is_gm(v_campaign) or exists(
     select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
     where c.id=p_character and c.campaign_id=v_campaign and c.is_active
       and m.user_id=(select auth.uid()) and m.status='active'
   )
 ) then raise exception 'Not authorized' using errcode='42501'; end if;

 select i.holder_id,i.container_id,d.category into v_holder,v_current,v_item_category
 from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id
   and h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character'
 join public.item_definitions d on d.id=i.definition_id
 where i.id=p_item and i.campaign_id=v_campaign
 for update of i;
 if v_holder is null then raise exception 'Item is not owned by this character' using errcode='42501'; end if;
 if v_item_category='container' or exists (
   select 1 from public.item_instances i join public.item_definitions d on d.id=i.definition_id
   where i.id=p_item and d.code='srd521_pouch'
 ) then raise exception 'Moving containers into other containers is not enabled';end if;
 if exists(select 1 from public.equipment_assignments a where a.item_instance_id=p_item)
 then raise exception 'Unequip the item before storing it'; end if;

 if p_container_item is null then
   if v_current is null then raise exception 'Item is already carried'; end if;
   if not exists(
     select 1 from public.containers box
     where box.id=v_current and box.campaign_id=v_campaign and box.holder_id=v_holder
       and box.properties ? 'source_item_id'
   ) then raise exception 'This storage location cannot be managed here';end if;
   update public.item_instances set container_id=null,version=version+1 where id=p_item;
 else
   if p_container_item=p_item then raise exception 'Cannot store a container inside itself';end if;
   select d.category,d.code,
     case when ci.identified then coalesce(nullif(ci.custom_name,''),d.name) else 'Unidentified Container' end,
     d.default_properties->>'capacity_weight_lb'
   into v_destination_category,v_destination_code,v_destination_name,v_limit_text
   from public.item_instances ci
   join public.item_definitions d on d.id=ci.definition_id
   where ci.id=p_container_item and ci.campaign_id=v_campaign and ci.holder_id=v_holder
     and ci.container_id is null and ci.identified
   for update of ci;
   if v_destination_category is null or not(v_destination_category='container' or v_destination_code='srd521_pouch') then
     raise exception 'Destination is not an identified carried backpack or pouch owned by this character';end if;
   if v_limit_text is null or v_limit_text !~ '^[0-9]+([.][0-9]+)?$' then
     raise exception 'Container has no configured weight capacity';end if;
   v_limit:=v_limit_text::numeric;
   if v_limit<=0 then raise exception 'Container capacity must be positive';end if;
   select box.id into v_box from public.containers box
   where box.campaign_id=v_campaign and box.holder_id=v_holder
     and box.properties->>'source_item_id'=p_container_item::text;
   if v_box is null then
     insert into public.containers(campaign_id,holder_id,name,capacity,properties)
     values(v_campaign,v_holder,v_destination_name,jsonb_build_object('weight_lb',v_limit),jsonb_build_object('source_item_id',p_container_item))
     returning id into v_box;
   end if;
   if v_current is not distinct from v_box then raise exception 'Item is already in that container';end if;

   select coalesce(i.properties->>'weight',d.default_properties->>'weight'),i.quantity
   into v_weight_text,v_item_weight
   from public.item_instances i join public.item_definitions d on d.id=i.definition_id where i.id=p_item;
   if v_weight_text is null or v_weight_text !~ '^[0-9]+([.][0-9]+)?$' then
     raise exception 'Item weight is missing or invalid; set its weight before storing';end if;
   v_item_weight:=v_item_weight*v_weight_text::numeric;
   select count(*) filter(where w.weight_text is null or w.weight_text !~ '^[0-9]+([.][0-9]+)?$'),
     coalesce(sum(case when w.weight_text ~ '^[0-9]+([.][0-9]+)?$' then w.weight_text::numeric*w.quantity else 0 end),0)
   into v_bad_count,v_existing_weight
   from (
     select coalesce(i.properties->>'weight',d.default_properties->>'weight') as weight_text,i.quantity
     from public.item_instances i join public.item_definitions d on d.id=i.definition_id
     where i.container_id=v_box and i.id<>p_item
   ) w;
   if v_bad_count>0 then raise exception 'Container contains items with unknown weights';end if;
   if v_existing_weight+v_item_weight>v_limit then
     raise exception 'Container capacity exceeded: % lb + % lb exceeds % lb',v_existing_weight,v_item_weight,v_limit;end if;
   update public.item_instances set container_id=v_box,version=version+1 where id=p_item;
 end if;
 perform app_private.consolidate_item_location(p_item);
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,(select auth.uid()),'container_move',
 jsonb_build_object('item_id',p_item,'character_id',p_character,'from_container_id',v_current,'to_container_id',v_box));
end
$function$
;

CREATE OR REPLACE FUNCTION public.manage_character_item_stack(p_character uuid, p_item uuid, p_action text, p_quantity numeric DEFAULT NULL::numeric, p_target_item uuid DEFAULT NULL::uuid, p_container_item uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;v_holder uuid;v_item public.item_instances%rowtype;v_target public.item_instances%rowtype;
 v_category text;v_code text;v_new uuid;v_action text:=lower(btrim(coalesce(p_action,'')));
 v_actor uuid:=(select auth.uid());v_actual numeric;v_is_container boolean;
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active for update;
 if v_campaign is null or not (
 app_private.is_gm(v_campaign) or exists(
  select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.id=p_character and c.campaign_id=v_campaign and c.is_active and
    m.user_id=v_actor and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501';end if;
 select i.* into v_item from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=v_campaign
 where i.id=p_item and i.campaign_id=v_campaign and h.character_id=p_character and h.holder_type='character'
 for update of i;
 if not found then raise exception 'Item not owned by character' using errcode='42501';end if;
 select d.category,d.code into v_category,v_code from public.item_definitions d where d.id=v_item.definition_id;
 v_is_container:=v_category='container' or v_code='srd521_pouch' or exists(
   select 1 from public.containers box where box.holder_id=v_item.holder_id
     and box.properties->>'source_item_id'=p_item::text);
 if not app_private.item_can_auto_stack(v_item.definition_id) and v_action in ('split','merge','move_quantity') then
 raise exception 'Equippable and unique items cannot be stacked or split' using errcode='22023';end if;
 if v_is_container then raise exception 'Containers cannot be split, consolidated or discarded here' using errcode='22023';end if;
 if exists(select 1 from public.equipment_assignments a where a.item_instance_id=p_item) then
   raise exception 'Unequip item before changing its stack' using errcode='22023';end if;
 if p_quantity is null or p_quantity<>trunc(p_quantity) or p_quantity<1 or p_quantity>100000000 then
  raise exception 'Quantity must be a positive whole number' using errcode='22023';end if;
 if v_item.quantity<>trunc(v_item.quantity) then raise exception 'Source stack must contain whole units' using errcode='22023';end if;
 if v_action not in ('split','merge','move_quantity','discard') then raise exception 'Unsupported stack action' using errcode='22023';end if;
 if p_quantity>v_item.quantity then raise exception 'Not enough quantity in source stack' using errcode='22023';end if;
 if v_action='split' or (v_action='move_quantity' and p_quantity<v_item.quantity) then
  if p_quantity>=v_item.quantity then raise exception 'Split quantity must be below stack total' using errcode='22023';end if;
  insert into public.item_instances(campaign_id,definition_id,holder_id,container_id,quantity,condition_code,identified,custom_name,properties,private_properties)
  values(v_campaign,v_item.definition_id,v_item.holder_id,v_item.container_id,p_quantity,v_item.condition_code,v_item.identified,v_item.custom_name,v_item.properties,v_item.private_properties)
  returning id into v_new;
  update public.item_instances set quantity=quantity-p_quantity,version=version+1 where id=p_item;
  if v_action='move_quantity' then
   perform public.move_character_item_storage(p_character,v_new,p_container_item);
  end if;
 elsif v_action='move_quantity' then
  if p_container_item is null and v_item.container_id is null then raise exception 'Already carried' using errcode='22023';end if;
  perform public.move_character_item_storage(p_character,p_item,p_container_item);
  v_new:=p_item;
 elsif v_action='merge' then
  if p_target_item is null or p_target_item=p_item then raise exception 'Select another compatible stack' using errcode='22023';end if;
  select i.* into v_target from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=v_campaign
  where i.id=p_target_item and i.campaign_id=v_campaign and h.character_id=p_character and h.holder_type='character'
  for update of i;
  if not found then raise exception 'Target item not accessible' using errcode='42501';end if;
  if exists(select 1 from public.equipment_assignments a where a.item_instance_id=p_target_item) then
    raise exception 'Target is equipped' using errcode='22023';end if;
  if exists(select 1 from public.containers box where box.properties->>'source_item_id'=p_target_item::text) then
    raise exception 'Target is a container' using errcode='22023';end if;
  if v_item.definition_id is distinct from v_target.definition_id
     or v_item.container_id is distinct from v_target.container_id
     or v_item.condition_code is distinct from v_target.condition_code
     or v_item.identified is distinct from v_target.identified
     or v_item.custom_name is distinct from v_target.custom_name
     or v_item.properties is distinct from v_target.properties
     or v_item.private_properties is distinct from v_target.private_properties then
    raise exception 'Only identical item instances in the same location can be merged' using errcode='22023';end if;
  update public.item_instances set quantity=quantity+p_quantity,version=version+1 where id=p_target_item;
  if p_quantity=v_item.quantity then
   delete from public.item_instances where id=p_item;
  else
   update public.item_instances set quantity=quantity-p_quantity,version=version+1 where id=p_item;
  end if;
  v_new:=p_target_item;
 elsif v_action='discard' then
  if p_quantity=v_item.quantity then
   delete from public.item_instances where id=p_item;
  else
   update public.item_instances set quantity=quantity-p_quantity,version=version+1 where id=p_item;
  end if;
 end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_stack_'||v_action,
 jsonb_build_object('character_id',p_character,'item_id',p_item,'item_name',
  coalesce(v_item.custom_name,(select d.name from public.item_definitions d where d.id=v_item.definition_id)),
  'quantity',p_quantity,'source_quantity_before',v_item.quantity,'target_item_id',p_target_item,
  'result_item_id',v_new,'target_container_item_id',p_container_item));
 return v_new;
end $function$
;
revoke all on function app_private.item_can_auto_stack(uuid) from public,anon,authenticated;
revoke all on function app_private.consolidate_item_location(uuid) from public,anon,authenticated;
