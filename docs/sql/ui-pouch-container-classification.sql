-- Nexus Multiverse inventory presentation correction.
-- The standard SRD Pouch is an actual 6 lb capacity container and is already
-- recognized by secure character storage and container movement RPCs.
-- Only the specific imported Pouch definition is reclassified. The distinct
-- spellcasting Component Pouch remains a focus.
update public.item_definitions
set category='container'
where id='262fef47-4feb-4071-9d0c-569ed002974c'
  and code='srd521_pouch'
  and name='Pouch'
  and category='gear';
