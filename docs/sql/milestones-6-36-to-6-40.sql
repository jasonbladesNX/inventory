-- Nexus Multiverse milestones 6.36–6.40. Read security notes in docs/milestones-6-36-to-6-40.md
-- All actions are atomic, character-authorized and logged.
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
 select d.category,d.code into v_category,v_code from public.item_definitions d where d.id=v_item.definition_id and d.campaign_id=v_campaign;
 v_is_container:=v_category='container' or v_code='srd521_pouch' or exists(
   select 1 from public.containers box where box.holder_id=v_item.holder_id
     and box.properties->>'source_item_id'=p_item::text);
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
CREATE OR REPLACE FUNCTION public.list_character_inventory_activity(p_character uuid, p_limit integer DEFAULT 40)
 RETURNS TABLE(event_id uuid, action text, item_name text, quantity numeric, occurred_at timestamp with time zone, description text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active;
 return query
 select t.id,t.kind,
  coalesce(t.details->>'item_name',d.name,'Item')::text,
  case when t.details->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (t.details->>'quantity')::numeric else null::numeric end,
  t.occurred_at,
  case t.kind
    when 'character_stack_split' then 'Split a stack'
    when 'character_stack_merge' then 'Consolidated compatible stacks'
    when 'character_stack_move_quantity' then 'Transferred a stack quantity'
    when 'character_stack_discard' then 'Discarded items'
    when 'equipment_equipped' then 'Equipped an item'
    when 'equipment_unequipped' then 'Unequipped an item'
    else 'Moved item between containers'
  end::text
 from public.inventory_transactions t
 left join public.item_instances i on i.id=(case when (t.details->>'item_id') ~ '^[0-9a-fA-F-]{36}$' then (t.details->>'item_id')::uuid else null::uuid end)
 left join public.item_definitions d on d.id=i.definition_id
 where t.campaign_id=v_campaign and t.kind in ('character_stack_split','character_stack_merge','character_stack_move_quantity','character_stack_discard','equipment_equipped','equipment_unequipped','container_move') and (
    t.details->>'character_id'=p_character::text
    or (t.kind='container_move' and i.id is not null and exists(
      select 1 from public.inventory_holders h where h.id=i.holder_id and h.character_id=p_character and h.holder_type='character'))
 )
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,40),100));
end $function$
;
CREATE OR REPLACE FUNCTION app_private.log_character_equipment_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.equipment_assignments%rowtype;v_item text;v_char uuid;
begin
 if tg_op='INSERT' then v_row:=new;else v_row:=old;end if;
 select h.character_id,coalesce(i.custom_name,d.name) into v_char,v_item
 from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id
 join public.item_definitions d on d.id=i.definition_id
 where i.id=v_row.item_instance_id and i.campaign_id=v_row.campaign_id;
 if v_char is not null then
  insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
  values(v_row.campaign_id,(select auth.uid()),case when tg_op='INSERT' then 'equipment_equipped' else 'equipment_unequipped' end,
    jsonb_build_object('character_id',v_char,'item_id',v_row.item_instance_id,'item_name',v_item,'assignment_id',v_row.id));
 end if;
 return coalesce(new,old);
end $function$
;
drop trigger if exists trg_character_equipment_activity on public.equipment_assignments;
create trigger trg_character_equipment_activity after insert or delete on public.equipment_assignments
for each row execute function app_private.log_character_equipment_activity();
revoke all on function public.manage_character_item_stack(uuid,uuid,text,numeric,uuid,uuid) from public,anon;
revoke all on function public.list_character_inventory_activity(uuid,integer) from public,anon;
revoke all on function app_private.log_character_equipment_activity() from public,anon,authenticated;
grant execute on function public.manage_character_item_stack(uuid,uuid,text,numeric,uuid,uuid) to authenticated;
grant execute on function public.list_character_inventory_activity(uuid,integer) to authenticated;
