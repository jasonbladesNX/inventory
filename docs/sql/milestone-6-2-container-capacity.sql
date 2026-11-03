-- Nexus Multiverse M6.2 weight-limited containers and contents read.
-- Requires Milestone 6.1 and existing item_definitions/containers schema.
-- SRD 5.2.1 weight limits are in lb; volume is not enforced yet.
update public.item_definitions
set default_properties=jsonb_set(default_properties,'{capacity_weight_lb}',to_jsonb(case code when 'srd521_backpack' then 30 else 6 end),true)
where code in ('srd521_backpack','srd521_pouch')
  and source_info->>'document'='System Reference Document 5.2.1';

update public.containers box
set capacity=jsonb_build_object('weight_lb',(d.default_properties->>'capacity_weight_lb')::numeric,'unit','lb')
from public.item_instances i join public.item_definitions d on d.id=i.definition_id
where box.properties->>'source_item_id'=i.id::text
 and box.campaign_id=i.campaign_id and box.holder_id=i.holder_id
 and d.default_properties->>'capacity_weight_lb' ~ '^[0-9]+([.][0-9]+)?$'
 and box.capacity='{}'::jsonb;

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
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,(select auth.uid()),'container_move',
 jsonb_build_object('item_id',p_item,'from_container_id',v_current,'to_container_id',v_box));
end
$function$
;
CREATE OR REPLACE FUNCTION public.list_character_container_usage(p_character uuid)
 RETURNS TABLE(container_item_id uuid, used_weight_lb numeric, capacity_weight_lb numeric, item_count bigint, unknown_weight_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c where c.id=p_character and c.is_active;
 if v_campaign is null or not(
   app_private.is_gm(v_campaign) or exists(
     select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
     where c.id=p_character and c.campaign_id=v_campaign and c.is_active
       and m.user_id=(select auth.uid()) and m.status='active'
   )
 ) then raise exception 'Not authorized' using errcode='42501';end if;

 return query
 select ci.id,
   coalesce(sum(case when w.weight_text ~ '^[0-9]+([.][0-9]+)?$' then w.weight_text::numeric*w.qty else 0 end),0)::numeric,
   case when d.default_properties->>'capacity_weight_lb' ~ '^[0-9]+([.][0-9]+)?$'
     then (d.default_properties->>'capacity_weight_lb')::numeric else null::numeric end,
   count(stored.id)::bigint,
   count(stored.id) filter(where w.weight_text is null or w.weight_text !~ '^[0-9]+([.][0-9]+)?$')::bigint
 from public.item_instances ci
 join public.inventory_holders h on h.id=ci.holder_id and h.character_id=p_character and h.campaign_id=v_campaign and h.holder_type='character'
 join public.item_definitions d on d.id=ci.definition_id
 left join public.containers box on box.campaign_id=v_campaign and box.holder_id=h.id
   and box.properties->>'source_item_id'=ci.id::text
 left join public.item_instances stored on stored.container_id=box.id and stored.campaign_id=v_campaign and stored.holder_id=h.id
 left join public.item_definitions stored_def on stored_def.id=stored.definition_id
 left join lateral(select coalesce(stored.properties->>'weight',stored_def.default_properties->>'weight') as weight_text,stored.quantity as qty) w on true
 where ci.campaign_id=v_campaign and ci.identified and ci.container_id is null
   and (d.category='container' or d.code='srd521_pouch')
 group by ci.id,d.default_properties
 order by ci.id;
end $function$
;
revoke all on function public.move_character_item_storage(uuid,uuid,uuid) from public,anon;
grant execute on function public.move_character_item_storage(uuid,uuid,uuid) to authenticated;
revoke all on function public.list_character_container_usage(uuid) from public,anon;
grant execute on function public.list_character_container_usage(uuid) to authenticated;
