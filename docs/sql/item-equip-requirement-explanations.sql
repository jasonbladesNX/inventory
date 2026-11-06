-- Character item requirement explanation, read-only and owner/GM authorized.
-- Displays saved base-score prerequisites without changing equip permissions or slot logic.
CREATE OR REPLACE FUNCTION public.list_character_item_equip_requirements(p_character uuid, p_item uuid)
 RETURNS TABLE(attribute_code text, required_score integer, current_score integer, is_met boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb;
begin
 perform 1 from public.list_character_attributes(p_character) limit 1;
 select coalesce(i.properties->'equip_requirements'->'min_attributes',d.default_properties->'equip_requirements'->'min_attributes','{}'::jsonb)
 into req from public.item_instances i
 join public.item_definitions d on d.id=i.definition_id
 join public.inventory_holders h on h.id=i.holder_id and h.campaign_id=i.campaign_id
 where i.id=p_item and h.character_id=p_character and h.holder_type='character';
 if not found then raise exception 'Item not accessible' using errcode='42501';end if;
 if jsonb_typeof(req)<>'object' then raise exception 'Invalid requirements';end if;
 return query select upper(j.key), (j.value #>> '{}')::integer,a.score,
   coalesce(a.score >= (j.value #>> '{}')::integer,false)
 from jsonb_each(req) j left join public.list_character_attributes(p_character) a on upper(a.attribute_code)=upper(j.key)
 where jsonb_typeof(j.value)='number' and (j.value #>> '{}') ~ '^[0-9]{1,3}$'
 order by upper(j.key);
end $function$
;
revoke all on function public.list_character_item_equip_requirements(uuid,uuid) from public,anon;
grant execute on function public.list_character_item_equip_requirements(uuid,uuid) to authenticated;
