-- GM multi-item grants (7.13 post-acceptance UI refinement).
-- One RPC call / one PostgreSQL transaction; the existing add_inventory_item
-- routine retains category stacking, character inventory rules and per-line
-- acquisition history. Any failure rolls back the entire grant.
create or replace function public.grant_inventory_items_bulk(
  p_campaign uuid,
  p_character uuid,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  v_line jsonb;
  v_definition uuid;
  v_def_text text;
  v_quantity_text text;
  v_quantity numeric;
  v_total numeric:=0;
  v_count integer:=0;
  v_seen uuid[]:=array[]::uuid[];
  v_granted jsonb:='[]'::jsonb;
  v_item_id uuid;
begin
  if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
    raise exception 'GM permission required to grant multiple items' using errcode='42501';
  end if;
  if p_character is null or not exists (
    select 1 from public.characters c
    where c.id=p_character and c.campaign_id=p_campaign and c.is_active
  ) then
    raise exception 'Select an active character in this campaign' using errcode='22023';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 25 then
    raise exception 'Select between 1 and 25 different catalog items' using errcode='22023';
  end if;

  -- Validate the whole request before creating any inventory records.
  for v_line in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_line)<>'object' then
      raise exception 'Each grant line must be an item with a quantity' using errcode='22023';
    end if;
    v_def_text:=v_line->>'definition_id';
    v_quantity_text:=v_line->>'quantity';
    if v_def_text is null or v_def_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_quantity_text is null or v_quantity_text !~ '^[0-9]{1,7}$' then
      raise exception 'Select a valid catalog item and a whole-number quantity' using errcode='22023';
    end if;
    v_definition:=v_def_text::uuid;
    v_quantity:=v_quantity_text::numeric;
    if v_quantity < 1 or v_quantity > 1000000 then
      raise exception 'Each item quantity must be between 1 and 1,000,000' using errcode='22023';
    end if;
    if v_definition=any(v_seen) then
      raise exception 'Each catalog item may appear only once per grant' using errcode='22023';
    end if;
    v_seen:=array_append(v_seen,v_definition);
    v_total:=v_total+v_quantity;
    if v_total>1000000 then
      raise exception 'A single grant cannot exceed 1,000,000 total units' using errcode='22023';
    end if;
    v_count:=v_count+1;
  end loop;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_definition:=(v_line->>'definition_id')::uuid;
    v_quantity:=(v_line->>'quantity')::numeric;
    v_item_id:=public.add_inventory_item(p_campaign,p_character,v_definition,v_quantity);
    v_granted:=v_granted || jsonb_build_array(jsonb_build_object(
      'definition_id',v_definition,'quantity',v_quantity,'item_id',v_item_id));
  end loop;
  return jsonb_build_object('character_id',p_character,'item_types',v_count,
    'total_quantity',v_total,'granted',v_granted);
end
$fn$;

revoke all on function public.grant_inventory_items_bulk(uuid,uuid,jsonb) from public,anon;
grant execute on function public.grant_inventory_items_bulk(uuid,uuid,jsonb) to authenticated;
