CREATE OR REPLACE FUNCTION public.adjust_character_hit_points(p_character uuid, p_operation text, p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_campaign uuid;
  v_hp jsonb;
  v_current integer;
  v_max integer;
  v_new integer;
  v_applied integer;
  v_temp integer;
  v_temp_absorbed integer:=0;
  v_total_applied integer;
  v_death jsonb;
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
  v_temp:=coalesce((v_hp->>'temporary_hp')::integer,0);
  -- Temporary HP is stored at the sheet root, not inside hp.
  select coalesce((c.sheet_data->>'temporary_hp')::integer,0) into v_temp from public.characters c where c.id=p_character;
  if v_temp not between 0 and 100000 then raise exception 'Invalid temporary HP' using errcode='22023'; end if;
  if p_operation='damage' then
    v_temp_absorbed:=least(p_amount,v_temp);
    v_new:=greatest(0,v_current-(p_amount-v_temp_absorbed));
    v_applied:=v_current-v_new;
  else
    v_new := least(v_max,v_current+p_amount);
    v_applied := v_new-v_current;
  end if;
  v_total_applied:=v_applied+v_temp_absorbed;
  if v_total_applied=0 then
    raise exception 'No HP change is possible at the current limit' using errcode='22023';
  end if;
  update public.characters c
    set sheet_data=jsonb_set(jsonb_set(c.sheet_data,'{hp,current}',to_jsonb(v_new),true),'{temporary_hp}',to_jsonb(v_temp-v_temp_absorbed),true)
    where c.id=p_character;
  if p_operation='heal' and v_new>0 then
    update public.characters c set sheet_data=jsonb_set(c.sheet_data,'{death_saves}', '{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb,true) where c.id=p_character;
  end if;
  insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
    values(v_campaign,v_actor,'character_hp_adjusted',
      jsonb_build_object('character_id',p_character,'operation',p_operation,
        'quantity',v_total_applied,'requested',p_amount,'applied',v_total_applied,'hp_applied',v_applied,'temp_absorbed',v_temp_absorbed,
        'previous_hp',v_current,'current_hp',v_new,'maximum_hp',v_max));
  return jsonb_build_object('configured',true,'current',v_new,'max',v_max,
    'operation',p_operation,'requested',p_amount,'applied',v_total_applied,'hp_applied',v_applied,'temp_absorbed',v_temp_absorbed,'temporary_hp',v_temp-v_temp_absorbed);
end
$function$


CREATE OR REPLACE FUNCTION public.use_character_inventory_item(p_character uuid, p_item uuid, p_quantity numeric DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid := (select auth.uid());
 v_campaign uuid; v_item public.item_instances%rowtype;
 v_name text; v_category text; v_props jsonb; v_after numeric;
 v_heal jsonb; v_dice_count integer; v_dice_sides integer; v_bonus integer;
 v_requested_heal integer:=0; v_applied_heal integer:=0;
 v_hp jsonb; v_current integer; v_max integer; v_n integer;
 v_effect_type text; v_effect_amount integer; v_effect_code text; v_effect_unit text; v_effect_duration integer; v_effects jsonb; v_temp integer; v_data jsonb; v_extra jsonb:='{}'::jsonb;
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
 v_heal:=v_props->'use_effect';
 if v_heal is not null then
   if jsonb_typeof(v_heal)<>'object' then raise exception 'Invalid item effect' using errcode='22023'; end if;
   v_effect_type:=v_heal->>'type';
   if v_effect_type='heal_hp' then
   if v_heal->>'type'<>'heal_hp'
      or v_heal->>'dice_count' !~ '^[0-9]+$'
      or v_heal->>'dice_sides' !~ '^[0-9]+$'
      or v_heal->>'bonus' !~ '^[0-9]+$'
   then raise exception 'Unsupported item-use effect' using errcode='22023'; end if;
   v_dice_count:=(v_heal->>'dice_count')::integer;
   v_dice_sides:=(v_heal->>'dice_sides')::integer;
   v_bonus:=(v_heal->>'bonus')::integer;
   if v_dice_count not between 1 and 10 or v_dice_sides not between 2 and 100 or v_bonus not between 0 and 100
   then raise exception 'Healing effect exceeds supported limits' using errcode='22023'; end if;
   if p_quantity>20 then raise exception 'Use at most 20 healing potions per action' using errcode='22023'; end if;
   select c.sheet_data->'hp' into v_hp from public.characters c where c.id=p_character;
   if v_hp is null or jsonb_typeof(v_hp)<>'object' or v_hp->>'max' !~ '^[0-9]+$'
      or v_hp->>'current' !~ '^[0-9]+$'
   then raise exception 'Configure character hit points before using healing potions' using errcode='22023'; end if;
   v_current:=(v_hp->>'current')::integer;
   v_max:=(v_hp->>'max')::integer;
   if v_max<1 or v_max>100000 or v_current<0 or v_current>v_max
   then raise exception 'Character hit points are invalid' using errcode='22023'; end if;
   for v_n in 1..(p_quantity::integer*v_dice_count) loop
     v_requested_heal:=v_requested_heal+1+floor(random()*v_dice_sides)::integer;
   end loop;
   v_requested_heal:=v_requested_heal+v_bonus*p_quantity::integer;
   v_applied_heal:=least(v_requested_heal,v_max-v_current);
   update public.characters c
   set sheet_data=jsonb_set(c.sheet_data,'{hp,current}',to_jsonb(v_current+v_applied_heal),true)
   where c.id=p_character;
   if v_applied_heal>0 then
     update public.characters c set sheet_data=jsonb_set(c.sheet_data,'{death_saves}','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb,true) where c.id=p_character;
   end if;
   elsif v_effect_type in ('temp_hp','remove_condition','add_condition','ability_bonus') then
     if p_quantity<>1 then raise exception 'Use one effect potion at a time' using errcode='22023'; end if;
     select c.sheet_data into v_data from public.characters c where c.id=p_character;
     v_data:=coalesce(v_data,'{}'::jsonb);
     if v_effect_type='temp_hp' then
       if coalesce(v_heal->>'amount','') !~ '^[0-9]{1,6}v_item.quantity-p_quantity;
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
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after,'heal_rolled',v_requested_heal,'heal_applied',v_applied_heal)||v_extra);
 return v_after;
end
$function$
 then raise exception 'Invalid temporary HP amount' using errcode='22023'; end if;
       v_effect_amount:=(v_heal->>'amount')::integer;
       if v_effect_amount not between 1 and 100000 then raise exception 'Invalid temporary HP amount' using errcode='22023'; end if;
       v_temp:=coalesce((v_data->>'temporary_hp')::integer,0);
       v_data:=jsonb_set(v_data,'{temporary_hp}',to_jsonb(greatest(v_temp,v_effect_amount)),true);
     else
       v_effect_code:=lower(trim(coalesce(v_heal->>'code','')));
       if v_effect_code !~ '^[a-z][a-z0-9_ -]{0,59}v_item.quantity-p_quantity;
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
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after,'heal_rolled',v_requested_heal,'heal_applied',v_applied_heal));
 return v_after;
end
$function$
 then raise exception 'Invalid condition or effect code' using errcode='22023'; end if;
       if v_effect_type='ability_bonus' and v_effect_code not in ('str','dex','con','int','wis','cha') then raise exception 'Invalid ability bonus target' using errcode='22023'; end if;
       if v_effect_type='ability_bonus' then
         if coalesce(v_heal->>'value','') !~ '^-?[0-9]{1,3}v_item.quantity-p_quantity;
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
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after,'heal_rolled',v_requested_heal,'heal_applied',v_applied_heal));
 return v_after;
end
$function$
 then raise exception 'Invalid bonus magnitude' using errcode='22023'; end if;
         v_effect_amount:=(v_heal->>'value')::integer;
         if v_effect_amount not between -30 and 30 then raise exception 'Invalid bonus magnitude' using errcode='22023'; end if;
       end if;
       v_effects:=coalesce(v_data->(case when v_effect_type='ability_bonus' then 'timed_effects' else 'conditions' end),'[]'::jsonb);
       select coalesce(jsonb_agg(e.value),'[]'::jsonb) into v_effects from jsonb_array_elements(v_effects) e where e.value->>'code'<>v_effect_code;
       if v_effect_type<>'remove_condition' then
         v_effect_unit:=coalesce(v_heal->>'unit','round');
         if v_effect_unit not in ('round','turn','minute','hour','rest','permanent') then raise exception 'Invalid effect duration unit' using errcode='22023'; end if;
         v_effect_duration:=null;
         if v_effect_unit<>'permanent' then
           if coalesce(v_heal->>'duration','') !~ '^[0-9]{1,6}v_item.quantity-p_quantity;
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
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after,'heal_rolled',v_requested_heal,'heal_applied',v_applied_heal));
 return v_after;
end
$function$
 then raise exception 'Invalid effect duration' using errcode='22023'; end if;
           v_effect_duration:=(v_heal->>'duration')::integer;
           if v_effect_duration not between 1 and 100000 then raise exception 'Invalid effect duration' using errcode='22023'; end if;
         end if;
         v_effects:=v_effects||jsonb_build_array(jsonb_build_object('code',v_effect_code,'unit',v_effect_unit,'remaining',v_effect_duration,'source',v_name,'kind',case when v_effect_type='ability_bonus' then 'bonus' else 'other' end,'value',case when v_effect_type='ability_bonus' then v_effect_amount else null end));
       end if;
       v_data:=jsonb_set(v_data,array[case when v_effect_type='ability_bonus' then 'timed_effects' else 'conditions' end],v_effects,true);
     end if;
     update public.characters c set sheet_data=v_data where c.id=p_character;
   else raise exception 'Unsupported item-use effect' using errcode='22023';
   end if;
   v_extra:=jsonb_build_object('use_effect_type',v_effect_type);
 end if;
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
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after,'heal_rolled',v_requested_heal,'heal_applied',v_applied_heal));
 return v_after;
end
$function$


CREATE OR REPLACE FUNCTION public.set_character_hit_points(p_character uuid, p_current integer, p_max integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_max is null or p_current is null or p_max<1 or p_max>100000 or p_current<0 or p_current>p_max
 then raise exception 'Hit points must be within 0 and maximum HP' using errcode='22023'; end if;
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active for update;
 if v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
   select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=v_campaign and c.is_active
     and m.user_id=(select auth.uid()) and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.characters c
 set sheet_data=jsonb_set(coalesce(c.sheet_data,'{}'::jsonb),'{hp}',
   jsonb_build_object('current',p_current,'max',p_max),true)
 where c.id=p_character;
 if p_current>0 then update public.characters c set sheet_data=jsonb_set(c.sheet_data,'{death_saves}','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb,true) where c.id=p_character; end if;
 return jsonb_build_object('configured',true,'current',p_current,'max',p_max);
end $function$


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
  case when t.kind='character_hp_adjusted' then 'Hit Points' when t.kind='character_combat_action' then 'Combat Status' else coalesce(t.details->>'item_name',d.name,'Item') end::text,
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
    when 'character_combat_action' then 'Combat action: '||coalesce(t.details->>'operation','update')
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
 where t.campaign_id=v_campaign and t.kind in ('character_stack_split','character_stack_merge','character_stack_move_quantity','character_stack_discard','equipment_equipped','equipment_unequipped','container_move','character_item_used','character_hp_adjusted','character_combat_action') and (
    t.details->>'character_id'=p_character::text
    or (t.kind='container_move' and i.id is not null and exists(
      select 1 from public.inventory_holders h where h.id=i.holder_id and h.character_id=p_character and h.holder_type='character'))
 )
 order by t.occurred_at desc,t.id desc limit greatest(1,least(coalesce(p_limit,40),100));
end $function$
