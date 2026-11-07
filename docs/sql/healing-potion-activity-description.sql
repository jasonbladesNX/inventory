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
    when 'character_item_used' then case
      when coalesce((t.details->>'heal_rolled')::integer,0)>0
      then 'Used item · healed '||coalesce(t.details->>'heal_applied','0')||' HP ('||t.details->>'heal_rolled'||' rolled)'
      else 'Used or consumed items' end
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