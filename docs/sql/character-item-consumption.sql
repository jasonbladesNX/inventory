-- Quantity-aware item use; supports explicit consumable catalog metadata.
-- This deducts inventory only. Effects (healing, ammo attack mechanics etc.) are
-- deliberately not applied by this milestone.
update public.item_definitions
set default_properties=jsonb_set(default_properties,'{consumable}','true'::jsonb,true)
where code='srd521_rations' and category='gear'
  and coalesce(default_properties->>'consumable','true') <> 'false';

create or replace function public.use_character_inventory_item(
 p_character uuid,p_item uuid,p_quantity numeric default 1
) returns numeric
language plpgsql security definer set search_path to ''
as $function$
declare
 v_actor uuid := (select auth.uid());
 v_campaign uuid; v_item public.item_instances%rowtype;
 v_name text; v_category text; v_props jsonb; v_after numeric;
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<>trunc(p_quantity) or p_quantity<1 or p_quantity>1000000
 then raise exception 'Quantity must be a positive whole number' using errcode='22023'; end if;
 select c.campaign_id into v_campaign from public.characters c
 where c.id=p_character and c.is_active for update;
 if v_campaign is null or not (
   app_private.is_gm(v_campaign) or exists(
     select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
     where c.id=p_character and c.campaign_id=v_campaign and c.is_active
       and m.user_id=v_actor and m.status='active'
   )
 ) then raise exception 'Not authorized' using errcode='42501'; end if;
 select i.* into v_item from public.item_instances i
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=v_campaign
   and h.character_id=p_character and h.holder_type='character'
 where i.id=p_item and i.campaign_id=v_campaign for update of i;
 if not found then raise exception 'Item not owned by this character' using errcode='42501'; end if;
 select d.category,coalesce(nullif(v_item.custom_name,''),d.name),d.default_properties
 into v_category,v_name,v_props
 from public.item_definitions d where d.id=v_item.definition_id;
 if not (v_category in ('consumable','ammunition')
   or coalesce(v_props->>'consumable','false')='true')
   or coalesce(v_props->>'consumable','true')='false'
   or coalesce(v_item.properties->>'consumable','true')='false'
   or coalesce(v_props->>'unique','false')='true'
   or coalesce(v_props->>'equippable','false')='true'
   or not app_private.item_can_auto_stack(v_item.definition_id)
 then raise exception 'This item is not a supported consumable' using errcode='22023'; end if;
 if exists(select 1 from public.equipment_assignments a where a.item_instance_id=p_item)
   or exists(select 1 from public.item_effects e where e.item_instance_id=p_item)
   or exists(select 1 from public.containers b where b.properties->>'source_item_id'=p_item::text)
 then raise exception 'Item is equipped or has persistent effects/container links' using errcode='22023'; end if;
 if v_item.quantity<>trunc(v_item.quantity) or p_quantity>v_item.quantity
 then raise exception 'Not enough usable units' using errcode='22023'; end if;
 v_after:=v_item.quantity-p_quantity;
 if v_after=0 then
   if exists(select 1 from public.transaction_lines l where l.item_instance_id=p_item)
    or exists(select 1 from public.loot_claim_items l where l.item_instance_id=p_item)
    or exists(select 1 from public.merchant_stock m where m.item_instance_id=p_item)
   then raise exception 'This item has linked records; cannot consume its final unit yet' using errcode='22023'; end if;
   delete from public.item_instances where id=p_item;
 else
   update public.item_instances set quantity=v_after,version=version+1 where id=p_item;
 end if;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_item_used',
   jsonb_build_object('character_id',p_character,'item_id',p_item,'item_name',v_name,
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after));
 return v_after;
end
$function$;
revoke all on function public.use_character_inventory_item(uuid,uuid,numeric) from public,anon;
grant execute on function public.use_character_inventory_item(uuid,uuid,numeric) to authenticated;

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
    when 'character_item_used' then 'Used or consumed items'
    when 'equipment_equipped' then 'Equipped an item'
    when 'equipment_unequipped' then 'Unequipped an item'
    else 'Moved item between containers'
  end::text
 from public.inventory_transactions t
 left join public.item_instances i on i.id=(case when (t.details->>'item_id') ~ '^[0-9a-fA-F-]{36}$' then (t.details->>'item_id')::uuid else null::uuid end)
 left join public.item_definitions d on d.id=i.definition_id
 where t.campaign_id=v_campaign and t.kind in ('character_stack_split','character_stack_merge','character_stack_move_quantity','character_stack_discard','equipment_equipped','equipment_unequipped','container_move','character_item_used') and (
    t.details->>'character_id'=p_character::text
    or (t.kind='container_move' and i.id is not null and exists(
      select 1 from public.inventory_holders h where h.id=i.holder_id and h.character_id=p_character and h.holder_type='character'))
 )
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,40),100));
end $function$
;
