-- Inventory sort metadata and safe stack-candidate hints.
-- Source rows are restricted by the existing character-scoped inventory
-- indicator RPC. Unidentified items do not reveal their value.
create or replace function public.list_character_inventory_sort_metadata(p_character uuid)
returns table(item_id uuid, unit_value text, definition_id uuid, stackable boolean)
language sql stable security definer
set search_path=''
as $fn$
  select ind.item_id,
    case when ind.identified then
      nullif(trim(coalesce(i.properties->>'value',d.default_properties->>'value','')),'')
    else null end as unit_value,
    i.definition_id,
    app_private.item_can_auto_stack(i.definition_id) as stackable
  from public.list_character_inventory_indicators(p_character) ind
  join public.item_instances i on i.id=ind.item_id
  join public.item_definitions d on d.id=i.definition_id
  order by ind.item_id
$fn$;
revoke all on function public.list_character_inventory_sort_metadata(uuid) from public,anon;
grant execute on function public.list_character_inventory_sort_metadata(uuid) to authenticated;
