-- Nexus Multiverse Milestone 6.14: read-only slot-by-slot equip eligibility preview.
-- Character ownership/GM authorization uses list_character_attributes.
-- Eligibility uses existing valid-slots and requirement-failure functions.
-- Replacement previews reflect same-slot capacity and two-handed conflicts.
-- Preview never modifies equipment assignments or inventory.
CREATE OR REPLACE FUNCTION public.preview_character_item_equip(p_character uuid, p_item uuid)
 RETURNS TABLE(slot_id uuid, slot_label text, can_equip boolean, reason text, replaced_items text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_campaign uuid;v_category text;v_two_handed boolean;v_container uuid;
 v_system text;v_main uuid;v_off uuid;v_already boolean;
 v_slot record;v_allowed text[];v_code text;v_conflicts uuid[];
 v_why text;v_replaced text[];v_count integer;v_occupant uuid;
 v_valid uuid[];
begin
 -- Reuse the existing character-scoped ownership/GM authorization.
 perform 1 from public.list_character_attributes(p_character) limit 1;
 select i.campaign_id,d.category,
    coalesce((i.properties->>'two_handed')::boolean,(d.default_properties->>'two_handed')::boolean,false),
    i.container_id
 into v_campaign,v_category,v_two_handed,v_container
 from public.item_instances i
 join public.item_definitions d on d.id=i.definition_id
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 join public.characters c on c.id=p_character and c.campaign_id=i.campaign_id
 where i.id=p_item and h.character_id=p_character and h.holder_type='character' and c.is_active;
 if not found then raise exception 'Item is not accessible to this character' using errcode='42501';end if;
 select gs.code into v_system
 from public.campaigns cp
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 join public.game_systems gs on gs.id=rv.system_id where cp.id=v_campaign;
 select s.id into v_main from public.equipment_slot_definitions s
 where s.campaign_id=v_campaign and lower(regexp_replace(trim(s.code),'[ _-]+','_','g'))='main_hand'
 order by s.id limit 1;
 select s.id into v_off from public.equipment_slot_definitions s
 where s.campaign_id=v_campaign and lower(regexp_replace(trim(s.code),'[ _-]+','_','g'))='off_hand'
 order by s.id limit 1;
 select exists(select 1 from public.equipment_assignments ea where ea.item_instance_id=p_item) into v_already;
 select array_agg(x.slot_id) into v_valid
 from public.list_character_valid_equipment_slots(p_character) x where x.item_id=p_item;
 for v_slot in
   select s.id,s.label,s.code,s.capacity,s.allowed_categories from public.equipment_slot_definitions s
   where s.campaign_id=v_campaign order by s.label,s.id
 loop
   slot_id:=v_slot.id;slot_label:=v_slot.label;replaced_items:='{}'::text[];can_equip:=false;reason:=null;
   v_code:=lower(regexp_replace(trim(v_slot.code),'[ _-]+','_','g'));
   v_allowed:=v_slot.allowed_categories;
   v_conflicts:='{}'::uuid[];
   if v_container is not null then reason:='Remove item from its container before equipping';
   elsif v_already then reason:='Item is already equipped';
   elsif v_slot.capacity<=0 then reason:='This slot is disabled';
   elsif cardinality(v_allowed)>0 and not(v_category=any(v_allowed)) then
     reason:='Item category '||v_category||' is not allowed in this slot';
   else
     if v_system='dnd5e' and cardinality(v_allowed)=0 then
       case v_code
         when 'main_hand' then v_allowed:=array['weapon','shield','focus','tool'];
         when 'off_hand' then v_allowed:=array['weapon','shield','focus','tool'];
         when 'head' then v_allowed:=array['headgear','armor','clothing'];
         when 'body' then v_allowed:=array['armor','clothing'];
         when 'armor' then v_allowed:=array['armor'];
         when 'neck' then v_allowed:=array['jewelry','wondrous'];
         when 'ring' then v_allowed:=array['jewelry','ring'];
         when 'feet' then v_allowed:=array['footwear','clothing'];
         else v_allowed:='{}'::text[];
       end case;
     end if;
     if v_system='dnd5e' and cardinality(v_allowed)>0 and not(v_category=any(v_allowed)) then
       reason:='Item category '||v_category||' is incompatible with this slot';
     elsif v_system='dnd5e' and v_two_handed and v_code in ('main_hand','off_hand') and v_code<>'main_hand' then
       reason:='Two-handed weapons require Main Hand';
     elsif v_system='dnd5e' and v_two_handed and v_code='main_hand' and v_off is null then
       reason:='Two-handed weapons require an Off Hand slot';
     else
       if v_system='dnd5e' and v_two_handed and v_code='main_hand' then
         select coalesce(array_agg(ea.id),'{}'::uuid[]) into v_conflicts
         from public.equipment_assignments ea where ea.character_id=p_character and ea.slot_id=v_off;
       elsif v_system='dnd5e' and v_code='off_hand' and v_main is not null then
         select coalesce(array_agg(ea.id),'{}'::uuid[]) into v_conflicts
         from public.equipment_assignments ea
         join public.item_instances i on i.id=ea.item_instance_id
         join public.item_definitions d on d.id=i.definition_id
         where ea.character_id=p_character and ea.slot_id=v_main
           and coalesce((i.properties->>'two_handed')::boolean,(d.default_properties->>'two_handed')::boolean,false);
       end if;
       select count(*) into v_count from public.equipment_assignments ea
       where ea.character_id=p_character and ea.slot_id=v_slot.id;
       if v_count>=v_slot.capacity then
         select ea.id into v_occupant from public.equipment_assignments ea
         where ea.character_id=p_character and ea.slot_id=v_slot.id order by ea.id limit 1;
         v_conflicts:=array_append(v_conflicts,v_occupant);
       end if;
       v_conflicts:=array(select distinct x from unnest(v_conflicts) x where x is not null);
       select app_private.equipment_requirement_failure(p_character,p_item,v_conflicts) into v_why;
       if v_why is not null then reason:=v_why;
       elsif not(v_slot.id=any(coalesce(v_valid,'{}'::uuid[]))) then
         reason:='Slot is not currently eligible';
       else
         can_equip:=true;
         reason:=case when cardinality(v_conflicts)>0 then 'Eligible; existing equipment will be replaced'
                      else 'Eligible; no replacement needed' end;
         select coalesce(array_agg(coalesce(nullif(btrim(i.custom_name),''),d.name) order by d.name),'{}'::text[])
           into replaced_items
         from public.equipment_assignments ea
         join public.item_instances i on i.id=ea.item_instance_id
         join public.item_definitions d on d.id=i.definition_id
         where ea.id=any(v_conflicts) and ea.character_id=p_character;
       end if;
     end if;
   end if;
   return next;
 end loop;
end $function$
;
revoke all on function public.preview_character_item_equip(uuid,uuid) from public,anon;
grant execute on function public.preview_character_item_equip(uuid,uuid) to authenticated;
