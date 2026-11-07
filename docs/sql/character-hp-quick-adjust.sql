-- Atomic, character-scoped HP changes for damage and healing during play.
-- Transactions record requested, applied and resulting HP for audit history.
create or replace function public.adjust_character_hit_points(
  p_character uuid,p_operation text,p_amount integer
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_campaign uuid;
  v_hp jsonb;
  v_current integer;
  v_max integer;
  v_new integer;
  v_applied integer;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_operation is null or p_operation not in ('damage','heal')
    or p_amount is null or p_amount<1 or p_amount>100000 then
    raise exception 'Enter a valid HP adjustment between 1 and 100000' using errcode='22023';
  end if;
  select c.campaign_id,c.sheet_data->'hp'
    into v_campaign,v_hp
    from public.characters c
    where c.id=p_character and c.is_active
    for update;
  if v_campaign is null or not (
    app_private.is_gm(v_campaign)
    or exists(
      select 1 from public.characters c
      join public.campaign_members m on m.id=c.member_id
      where c.id=p_character and c.campaign_id=v_campaign and c.is_active
        and m.user_id=v_actor and m.status='active'
    )
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_hp is null or jsonb_typeof(v_hp)<>'object'
    or coalesce(v_hp->>'current','') !~ '^[0-9]+$'
    or coalesce(v_hp->>'max','') !~ '^[0-9]+$'
  then raise exception 'Configure hit points first' using errcode='22023'; end if;
  v_current := (v_hp->>'current')::integer;
  v_max := (v_hp->>'max')::integer;
  if v_max not between 1 and 100000 or v_current<0 or v_current>v_max
  then raise exception 'Character hit points are invalid' using errcode='22023'; end if;
  if p_operation='damage' then
    v_new := greatest(0,v_current-p_amount);
    v_applied := v_current-v_new;
  else
    v_new := least(v_max,v_current+p_amount);
    v_applied := v_new-v_current;
  end if;
  if v_applied=0 then
    raise exception 'No HP change is possible at the current limit' using errcode='22023';
  end if;
  update public.characters c
    set sheet_data=jsonb_set(c.sheet_data,'{hp,current}',to_jsonb(v_new),true)
    where c.id=p_character;
  insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
    values(v_campaign,v_actor,'character_hp_adjusted',
      jsonb_build_object('character_id',p_character,'operation',p_operation,
        'quantity',v_applied,'requested',p_amount,'applied',v_applied,
        'previous_hp',v_current,'current_hp',v_new,'maximum_hp',v_max));
  return jsonb_build_object('configured',true,'current',v_new,'max',v_max,
    'operation',p_operation,'requested',p_amount,'applied',v_applied);
end
$function$;
revoke all on function public.adjust_character_hit_points(uuid,text,integer) from public,anon;
grant execute on function public.adjust_character_hit_points(uuid,text,integer) to authenticated;

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
  case when t.kind='character_hp_adjusted' then 'Hit Points' else coalesce(t.details->>'item_name',d.name,'Item') end::text,
  case when t.details->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (t.details->>'quantity')::numeric else null::numeric end,
  t.occurred_at,
  case t.kind
    when 'character_stack_split' then 'Split a stack'
    when 'character_stack_merge' then 'Consolidated compatible stacks'
    when 'character_stack_move_quantity' then 'Transferred a stack quantity'
    when 'character_stack_discard' then 'Discarded items'
    when 'character_item_used' then case
      when coalesce((t.details->>'heal_rolled')::integer,0)>0
      then 'Used item · healed '||coalesce(t.details->>'heal_applied','0')||' HP ('||(t.details->>'heal_rolled')||' rolled)'
      else 'Used or consumed items' end
    when 'character_hp_adjusted' then case
      when t.details->>'operation'='damage'
        then 'Took '||(t.details->>'applied')||' damage ('||(t.details->>'previous_hp')||' → '||(t.details->>'current_hp')||' HP)'
      when t.details->>'operation'='heal'
        then 'Healed '||(t.details->>'applied')||' HP ('||(t.details->>'previous_hp')||' → '||(t.details->>'current_hp')||' HP)'
      else 'Adjusted hit points' end
    when 'equipment_equipped' then 'Equipped an item'
    when 'equipment_unequipped' then 'Unequipped an item'
    else 'Moved item between containers'
  end::text
 from public.inventory_transactions t
 left join public.item_instances i on i.id=(case when (t.details->>'item_id') ~ '^[0-9a-fA-F-]{36}$' then (t.details->>'item_id')::uuid else null::uuid end)
 left join public.item_definitions d on d.id=i.definition_id
 where t.campaign_id=v_campaign and t.kind in ('character_stack_split','character_stack_merge','character_stack_move_quantity','character_stack_discard','equipment_equipped','equipment_unequipped','container_move','character_item_used','character_hp_adjusted') and (
    t.details->>'character_id'=p_character::text
    or (t.kind='container_move' and i.id is not null and exists(
      select 1 from public.inventory_holders h where h.id=i.holder_id and h.character_id=p_character and h.holder_type='character'))
 )
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,40),100));
end $function$
;
