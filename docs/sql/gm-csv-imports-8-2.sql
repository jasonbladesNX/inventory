-- Milestone 8.2: GM-only, all-or-nothing catalog + character CSV imports.
-- Both functions validate the entire request before writing. Dry runs never mutate.
create or replace function public.gm_import_catalog_csv(
  p_campaign uuid, p_rows jsonb, p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_ruleset uuid; v_row jsonb; v_no int:=0; v_name text; v_category text;
  v_description text; v_stack text; v_use text; v_handed text;
  v_attribute text; v_bonus_text text; v_bonus numeric;
  v_allowed boolean; v_seen text[]:=array[]::text[];
  v_plan jsonb:='[]'::jsonb; v_created jsonb:='[]'::jsonb;
  v_record jsonb; v_id uuid; v_count int;
begin
  if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
    raise exception 'GM permission required for CSV imports' using errcode='42501';
  end if;
  if p_dry_run is null then raise exception 'Import mode required' using errcode='22023'; end if;
  if not p_dry_run then perform 1 from public.campaigns where id=p_campaign for update; end if;
  select ruleset_version_id into v_ruleset from public.campaigns where id=p_campaign;
  if not found then raise exception 'Campaign not found' using errcode='22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array'
     or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Catalog import requires 1–100 rows' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_no:=v_no+1;
    if jsonb_typeof(v_row)<>'object' then
      raise exception 'Row %: expected a CSV record',v_no using errcode='22023';
    end if;
    v_name:=btrim(coalesce(v_row->>'item_name',''));
    v_category:=lower(btrim(coalesce(v_row->>'category','')));
    v_description:=coalesce(v_row->>'description','');
    v_stack:=lower(btrim(coalesce(v_row->>'stackable','')));
    v_use:=lower(btrim(coalesce(v_row->>'consumable','')));
    v_handed:=lower(btrim(coalesce(nullif(v_row->>'two_handed',''),'false')));
    v_attribute:=upper(btrim(coalesce(v_row->>'bonus_attribute','')));
    v_bonus_text:=btrim(coalesce(v_row->>'bonus_amount',''));

    if length(v_name) not between 2 and 120 then
      raise exception 'Row %: item_name must be 2–120 characters',v_no using errcode='22023';
    end if;
    if length(v_description)>3000 then
      raise exception 'Row %: description is too long (max 3000)',v_no using errcode='22023';
    end if;
    if v_stack not in ('true','false') or v_use not in ('true','false')
       or v_handed not in ('true','false') then
      raise exception 'Row %: stackable, consumable and two_handed must be true or false',v_no using errcode='22023';
    end if;
    select
      v_category in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies')
      or exists(select 1 from public.campaign_item_categories c
        where c.campaign_id=p_campaign and c.code=v_category and c.active)
    into v_allowed;
    if v_category not in ('gear','ingredient','consumable','ammunition','material','component','misc','supplies',
       'weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous',
       'container','recipe')
       and not v_allowed then
      raise exception 'Row %: unknown or inactive item category "%"',v_no,v_category using errcode='22023';
    end if;
    if v_use='true' and not v_allowed then
      raise exception 'Row %: this category cannot be a consumable',v_no using errcode='22023';
    end if;
    if v_category='consumable' and v_use<>'true' then
      raise exception 'Row %: category consumable requires consumable=true',v_no using errcode='22023';
    end if;
    if v_use='true' and v_stack<>'true' then
      raise exception 'Row %: consumable items must be stackable',v_no using errcode='22023';
    end if;
    if not v_allowed and v_stack='true' then
      raise exception 'Row %: equippable/special items cannot be stackable',v_no using errcode='22023';
    end if;
    if v_handed='true' and v_category<>'weapon' then
      raise exception 'Row %: two_handed is only available for weapons',v_no using errcode='22023';
    end if;
    if (v_attribute='')<>(v_bonus_text='') then
      raise exception 'Row %: bonus_attribute and bonus_amount must be provided together',v_no using errcode='22023';
    end if;
    v_bonus:=null;
    if v_attribute<>'' then
      if v_attribute !~ '^[A-Z][A-Z0-9_]{1,24}$' or length(v_bonus_text)>14
         or v_bonus_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$' then
        raise exception 'Row %: invalid bonus attribute or amount',v_no using errcode='22023';
      end if;
      v_bonus:=v_bonus_text::numeric;
      if abs(v_bonus)>1000 or v_use='true' then
        raise exception 'Row %: equipment bonus must be within ±1000 and not consumable',v_no using errcode='22023';
      end if;
    end if;
    if lower(v_name)=any(v_seen) then
      raise exception 'Row %: item_name is duplicated in this CSV',v_no using errcode='22023';
    end if;
    v_seen:=array_append(v_seen,lower(v_name));
    select count(*) into v_count from public.item_definitions d
      where lower(btrim(d.name))=lower(v_name)
        and (d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=v_ruleset));
    if v_count>0 then
      raise exception 'Row %: item_name already exists in the campaign or ruleset: %',v_no,v_name using errcode='22023';
    end if;
    v_plan:=v_plan||jsonb_build_array(jsonb_build_object(
      'row',v_no,'item_name',v_name,'category',v_category,
      'description',v_description,'stackable',v_stack='true',
      'consumable',v_use='true','two_handed',v_handed='true',
      'bonus_attribute',nullif(v_attribute,''),'bonus_amount',v_bonus,
      'action','create'));
  end loop;
  if not p_dry_run then
    for v_record in select value from jsonb_array_elements(v_plan) loop
      v_id:=public.create_campaign_custom_item_with_stacking(
        p_campaign,v_record->>'item_name',v_record->>'category',
        v_record->>'bonus_attribute',(v_record->>'bonus_amount')::numeric,
        (v_record->>'two_handed')::boolean,(v_record->>'consumable')::boolean,
        null,(v_record->>'stackable')::boolean
      );
      update public.item_definitions set description=v_record->>'description'
        where id=v_id and campaign_id=p_campaign;
      v_created:=v_created||jsonb_build_array(jsonb_build_object(
        'row',v_record->'row','item_id',v_id,'item_name',v_record->>'item_name'));
    end loop;
  end if;
  return jsonb_build_object('mode',case when p_dry_run then 'preview' else 'imported' end,
    'row_count',v_no,'rows',v_plan,'created',v_created);
end
$function$;

create or replace function public.gm_import_character_inventory_csv(
  p_campaign uuid, p_rows jsonb, p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_ruleset uuid; v_approval boolean;
  v_row jsonb; v_no int:=0; v_quantity_text text; v_qty int;
  v_char_id_text text; v_char_name text; v_char_id uuid; v_resolved_char_name text;
  v_def_id_text text; v_def_name text; v_def_id uuid; v_resolved_def_name text;
  v_matches int; v_total int:=0; v_key text;
  v_seen text[]:=array[]::text[];
  v_plan jsonb:='[]'::jsonb; v_done jsonb:='[]'::jsonb;
  v_record jsonb; v_instance uuid;
begin
  if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
    raise exception 'GM permission required for CSV imports' using errcode='42501';
  end if;
  if p_dry_run is null then raise exception 'Import mode required' using errcode='22023'; end if;
  if not p_dry_run then perform 1 from public.campaigns where id=p_campaign for update; end if;
  select ruleset_version_id,coalesce((settings->>'approval_required')::boolean,false)
    into v_ruleset,v_approval from public.campaigns where id=p_campaign;
  if not found then raise exception 'Campaign not found' using errcode='22023'; end if;
  if v_approval then
    raise exception 'This campaign requires the item approval workflow; direct grants are disabled' using errcode='22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array'
     or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Character inventory import requires 1–200 rows' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_no:=v_no+1;
    if jsonb_typeof(v_row)<>'object' then
      raise exception 'Row %: expected a CSV record',v_no using errcode='22023';
    end if;
    v_char_id_text:=btrim(coalesce(v_row->>'character_id',''));
    v_char_name:=btrim(coalesce(v_row->>'character_name',''));
    v_def_id_text:=btrim(coalesce(v_row->>'item_definition_id',''));
    v_def_name:=btrim(coalesce(v_row->>'item_name',''));
    v_quantity_text:=btrim(coalesce(v_row->>'quantity',''));
    if v_quantity_text !~ '^[0-9]{1,3}$' then
      raise exception 'Row %: quantity must be a whole number from 1 to 500',v_no using errcode='22023';
    end if;
    v_qty:=v_quantity_text::int;
    if v_qty not between 1 and 500 then
      raise exception 'Row %: quantity must be between 1 and 500',v_no using errcode='22023';
    end if;
    v_total:=v_total+v_qty;
    if v_total>10000 then
      raise exception 'Import exceeds 10,000 total units; split into smaller files' using errcode='22023';
    end if;
    if v_char_id_text='' and v_char_name='' then
      raise exception 'Row %: character_name or character_id is required',v_no using errcode='22023';
    end if;
    if v_def_id_text='' and v_def_name='' then
      raise exception 'Row %: item_name or item_definition_id is required',v_no using errcode='22023';
    end if;
    v_char_id:=null;
    if v_char_id_text<>'' then
      if v_char_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row %: invalid character_id UUID',v_no using errcode='22023';
      end if;
      v_char_id:=v_char_id_text::uuid;
      select c.name into v_resolved_char_name from public.characters c
        where c.id=v_char_id and c.campaign_id=p_campaign and c.is_active;
      if not found then
        raise exception 'Row %: character_id is not an active character in this campaign',v_no using errcode='22023';
      end if;
      if v_char_name<>'' and lower(v_char_name)<>lower(v_resolved_char_name) then
        raise exception 'Row %: character_name does not match character_id',v_no using errcode='22023';
      end if;
    else
      select count(*),(array_agg(c.id))[1],min(c.name) into v_matches,v_char_id,v_resolved_char_name
      from public.characters c where c.campaign_id=p_campaign and c.is_active
        and lower(btrim(c.name))=lower(v_char_name);
      if v_matches<>1 then
        raise exception 'Row %: character_name not found or ambiguous: %',v_no,v_char_name using errcode='22023';
      end if;
    end if;
    v_def_id:=null;
    if v_def_id_text<>'' then
      if v_def_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row %: invalid item_definition_id UUID',v_no using errcode='22023';
      end if;
      v_def_id:=v_def_id_text::uuid;
      select d.name into v_resolved_def_name from public.item_definitions d
      where d.id=v_def_id and (d.campaign_id=p_campaign
        or (d.campaign_id is null and d.ruleset_version_id=v_ruleset));
      if not found then
        raise exception 'Row %: item_definition_id unavailable to this campaign',v_no using errcode='22023';
      end if;
      if v_def_name<>'' and lower(v_def_name)<>lower(v_resolved_def_name) then
        raise exception 'Row %: item_name does not match item_definition_id',v_no using errcode='22023';
      end if;
    else
      select count(*),(array_agg(d.id))[1],min(d.name) into v_matches,v_def_id,v_resolved_def_name
      from public.item_definitions d where lower(btrim(d.name))=lower(v_def_name)
        and (d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=v_ruleset));
      if v_matches<>1 then
        raise exception 'Row %: item_name not found or ambiguous: %',v_no,v_def_name using errcode='22023';
      end if;
    end if;
    v_key:=v_char_id::text||'|'||v_def_id::text;
    if v_key=any(v_seen) then
      raise exception 'Row %: duplicate character/item pair; combine quantities into one row',v_no using errcode='22023';
    end if;
    v_seen:=array_append(v_seen,v_key);
    v_plan:=v_plan||jsonb_build_array(jsonb_build_object(
      'row',v_no,'character_id',v_char_id,'character_name',v_resolved_char_name,
      'item_definition_id',v_def_id,'item_name',v_resolved_def_name,
      'quantity',v_qty,'action','grant'));
  end loop;
  if not p_dry_run then
    for v_record in select value from jsonb_array_elements(v_plan) loop
      v_instance:=public.add_inventory_item(p_campaign,
        (v_record->>'character_id')::uuid,(v_record->>'item_definition_id')::uuid,
        (v_record->>'quantity')::numeric);
      v_done:=v_done||jsonb_build_array(jsonb_build_object(
        'row',v_record->'row','character_id',v_record->'character_id',
        'item_definition_id',v_record->'item_definition_id',
        'quantity',v_record->'quantity','item_id',v_instance));
    end loop;
  end if;
  return jsonb_build_object('mode',case when p_dry_run then 'preview' else 'imported' end,
    'row_count',v_no,'total_units',v_total,'rows',v_plan,'granted',v_done);
end
$function$;

revoke all on function public.gm_import_catalog_csv(uuid,jsonb,boolean) from public,anon;
revoke all on function public.gm_import_character_inventory_csv(uuid,jsonb,boolean) from public,anon;
grant execute on function public.gm_import_catalog_csv(uuid,jsonb,boolean) to authenticated;
grant execute on function public.gm_import_character_inventory_csv(uuid,jsonb,boolean) to authenticated;