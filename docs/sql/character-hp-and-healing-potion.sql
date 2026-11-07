create or replace function public.get_character_hit_points(p_character uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid; v_hp jsonb;
begin
 select c.campaign_id,c.sheet_data->'hp' into v_campaign,v_hp
 from public.characters c where c.id=p_character and c.is_active;
 if v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
   select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=v_campaign and c.is_active
     and m.user_id=(select auth.uid()) and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501'; end if;
 if v_hp is null then return jsonb_build_object('configured',false); end if;
 return jsonb_build_object('configured',true,'current',v_hp->'current','max',v_hp->'max');
end $function$;
revoke all on function public.get_character_hit_points(uuid) from public,anon;
grant execute on function public.get_character_hit_points(uuid) to authenticated;

create or replace function public.set_character_hit_points(p_character uuid,p_current integer,p_max integer)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
 return jsonb_build_object('configured',true,'current',p_current,'max',p_max);
end $function$;
revoke all on function public.set_character_hit_points(uuid,integer,integer) from public,anon;
grant execute on function public.set_character_hit_points(uuid,integer,integer) to authenticated;

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
 v_roll integer; v_requested_heal integer:=0; v_applied_heal integer:=0;
 v_hp jsonb; v_current integer; v_max integer; v_n integer;
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
   if jsonb_typeof(v_heal)<>'object' or v_heal->>'type'<>'heal_hp'
      or v_heal->>'dice_count' !~ '^[0-9]+
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

      or v_heal->>'dice_sides' !~ '^[0-9]+
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
$function$

      or v_heal->>'bonus' !~ '^[0-9]+
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
$function$

   then raise exception 'Unsupported item-use effect' using errcode='22023'; end if;
   v_dice_count:=(v_heal->>'dice_count')::integer;
   v_dice_sides:=(v_heal->>'dice_sides')::integer;
   v_bonus:=(v_heal->>'bonus')::integer;
   if v_dice_count not between 1 and 10 or v_dice_sides not between 2 and 100 or v_bonus not between 0 and 100
   then raise exception 'Healing effect exceeds supported limits' using errcode='22023'; end if;
   if p_quantity>20 then raise exception 'Use at most 20 healing potions per action' using errcode='22023'; end if;
   select c.sheet_data->'hp' into v_hp from public.characters c where c.id=p_character;
   if v_hp is null or jsonb_typeof(v_hp)<>'object' or v_hp->>'max' !~ '^[0-9]+
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
$function$

      or v_hp->>'current' !~ '^[0-9]+
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
$function$

   then raise exception 'Configure character hit points before using healing potions' using errcode='22023'; end if;
   v_current:=(v_hp->>'current')::integer;
   v_max:=(v_hp->>'max')::integer;
   if v_max<1 or v_max>100000 or v_current<0 or v_current>v_max
   then raise exception 'Character hit points are invalid' using errcode='22023'; end if;
   for v_n in 1..(p_quantity::integer*v_dice_count) loop
     v_roll:=1+floor(random()*v_dice_sides)::integer;
     v_requested_heal:=v_requested_heal+v_roll;
   end loop;
   v_requested_heal:=v_requested_heal+v_bonus*p_quantity::integer;
   v_applied_heal:=least(v_requested_heal,v_max-v_current);
   update public.characters c
   set sheet_data=jsonb_set(c.sheet_data,'{hp,current}',to_jsonb(v_current+v_applied_heal),true)
   where c.id=p_character;
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
   'quantity',p_quantity,'source_quantity_before',v_item.quantity,'remaining_quantity',v_after));
 return v_after;
end
$function$
;

insert into public.item_definitions(campaign_id,code,name,category,description,default_properties)
select c.id,'nexus_potion_of_healing','Potion of Healing','consumable',
 'Restores 2d4 + 2 hit points, up to your maximum, when consumed.',
 jsonb_build_object('consumable',true,'stackable',true,'weight',0.5,'value','50 GP',
    'use_effect',jsonb_build_object('type','heal_hp','dice_count',2,'dice_sides',4,'bonus',2))
from public.campaigns c
join public.ruleset_versions rv on rv.id=c.ruleset_version_id
join public.game_systems gs on gs.id=rv.system_id
where gs.code='dnd5e'
 and not exists(select 1 from public.item_definitions d where d.campaign_id=c.id and d.code='nexus_potion_of_healing');
