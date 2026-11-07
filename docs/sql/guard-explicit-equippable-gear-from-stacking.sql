-- Additional protection for custom/system-agnostic catalog entries.
-- An item explicitly marked equippable or unique must not auto-stack,
-- even when its broad category is "gear" or another supply category.
-- Does not change previously approved category and equipment-slot rules.
CREATE OR REPLACE FUNCTION app_private.item_can_auto_stack(p_definition uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
 SELECT coalesce((
   SELECT
     (d.category IN ('gear','consumable','ammunition','material','component','misc','supplies')
       OR d.default_properties->>'stackable'='true')
     AND d.category NOT IN ('weapon','armor','shield','ring','jewelry','headgear',
       'footwear','clothing','focus','wondrous','container','tool')
     AND coalesce(d.default_properties->>'stackable','true') <> 'false'
     AND coalesce(lower(d.default_properties->>'equippable'),'false') NOT IN ('true','1')
     AND coalesce(lower(d.default_properties->>'unique'),'false') NOT IN ('true','1')
     AND NOT EXISTS (
       SELECT 1 FROM public.equipment_slot_definitions slot
       WHERE slot.campaign_id=d.campaign_id AND d.category=ANY(slot.allowed_categories)
     )
   FROM public.item_definitions d WHERE d.id=p_definition
 ),false)
$function$;
REVOKE ALL ON FUNCTION app_private.item_can_auto_stack(uuid) FROM public,anon,authenticated;
