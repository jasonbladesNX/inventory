-- Milestone 8.3: GM-only, atomic merchant stock import.
-- A merchant/item/currency triple identifies one listing. Existing stock/prices
-- are REPLACED; nothing outside the supplied rows is removed.
-- p_expected is an exact snapshot of preview rows for optimistic concurrency.
create or replace function public.gm_import_shop_stock_csv(
  p_campaign uuid,
  p_rows jsonb,
  p_dry_run boolean default true,
  p_expected jsonb default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_ruleset uuid;
  v_row jsonb;
  v_no integer:=0;
  v_merchant_id_text text; v_merchant_name_text text; v_merchant_id uuid; v_merchant_name text; v_merchant_active boolean;
  v_item_id_text text; v_item_name_text text; v_item_id uuid; v_item_name text;
  v_currency_code text; v_currency_id uuid; v_currency_precision integer;
  v_price_text text; v_buyback_text text; v_quantity_text text; v_buys_text text;
  v_price numeric; v_buyback numeric; v_quantity integer; v_buys boolean;
  v_matches integer; v_key text; v_seen text[]:=array[]::text[];
  v_listing_id uuid; v_old_price numeric; v_old_buyback numeric;
  v_old_quantity integer; v_old_buys boolean;
  v_plan jsonb:='[]'::jsonb; v_committed jsonb:='[]'::jsonb;
  v_action text; v_record jsonb; v_new_id uuid;
  v_created integer:=0; v_updated integer:=0;
begin
  if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
    raise exception 'GM permission required for shop imports' using errcode='42501';
  end if;
  if p_dry_run is null then
    raise exception 'Import mode must be specified' using errcode='22023';
  end if;
  -- Serialize concurrent CSV imports for this campaign. The individual listing
  -- rows are locked below on apply to protect against concurrent purchases.
  if not p_dry_run then
    perform 1 from public.campaigns where id=p_campaign for update;
  end if;
  select c.ruleset_version_id into v_ruleset from public.campaigns c where c.id=p_campaign;
  if not found then
    raise exception 'Campaign not found' using errcode='22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array'
     or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Shop import requires 1–200 rows' using errcode='22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_no:=v_no+1;
    if jsonb_typeof(v_row)<>'object' then
      raise exception 'Row %: expected a CSV record',v_no using errcode='22023';
    end if;
    v_merchant_id_text:=btrim(coalesce(v_row->>'merchant_id',''));
    v_merchant_name_text:=btrim(coalesce(v_row->>'merchant_name',''));
    v_item_id_text:=btrim(coalesce(v_row->>'item_definition_id',''));
    v_item_name_text:=btrim(coalesce(v_row->>'item_name',''));
    v_currency_code:=upper(btrim(coalesce(v_row->>'currency_code','')));
    v_price_text:=btrim(coalesce(v_row->>'unit_price',''));
    v_buyback_text:=btrim(coalesce(v_row->>'buyback_price',''));
    v_quantity_text:=btrim(coalesce(v_row->>'quantity',''));
    v_buys_text:=lower(btrim(coalesce(v_row->>'buys_from_players','')));

    if v_merchant_id_text='' and v_merchant_name_text='' then
      raise exception 'Row %: merchant_name or merchant_id is required',v_no using errcode='22023';
    end if;
    if v_item_id_text='' and v_item_name_text='' then
      raise exception 'Row %: item_name or item_definition_id is required',v_no using errcode='22023';
    end if;
    if v_buys_text not in ('true','false') then
      raise exception 'Row %: buys_from_players must be true or false',v_no using errcode='22023';
    end if;
    v_buys:=v_buys_text='true';
    if v_quantity_text !~ '^[0-9]{1,7}$' then
      raise exception 'Row %: quantity must be a whole number from 0 to 1,000,000',v_no using errcode='22023';
    end if;
    v_quantity:=v_quantity_text::integer;
    if v_quantity not between 0 and 1000000 then
      raise exception 'Row %: quantity must be between 0 and 1,000,000',v_no using errcode='22023';
    end if;
    if v_price_text !~ '^[0-9]{1,10}(\.[0-9]{1,6})?$'
       or v_buyback_text !~ '^[0-9]{1,10}(\.[0-9]{1,6})?$' then
      raise exception 'Row %: prices must be nonnegative decimals with no more than six fractional digits',v_no using errcode='22023';
    end if;
    v_price:=v_price_text::numeric;
    v_buyback:=v_buyback_text::numeric;
    if v_price>1000000000 or v_buyback>1000000000 then
      raise exception 'Row %: prices cannot exceed 1,000,000,000',v_no using errcode='22023';
    end if;

    v_merchant_id:=null; v_merchant_name:=null; v_merchant_active:=null;
    if v_merchant_id_text<>'' then
      if v_merchant_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row %: merchant_id is not a UUID',v_no using errcode='22023';
      end if;
      v_merchant_id:=v_merchant_id_text::uuid;
      select m.name,m.active into v_merchant_name,v_merchant_active
        from public.campaign_merchants m
        where m.id=v_merchant_id and m.campaign_id=p_campaign;
      if not found then
        raise exception 'Row %: merchant_id does not belong to this campaign',v_no using errcode='22023';
      end if;
      if v_merchant_name_text<>'' and lower(v_merchant_name_text)<>lower(btrim(v_merchant_name)) then
        raise exception 'Row %: merchant_name does not match merchant_id',v_no using errcode='22023';
      end if;
    else
      select count(*),(array_agg(m.id))[1],min(m.name),bool_or(m.active)
        into v_matches,v_merchant_id,v_merchant_name,v_merchant_active
        from public.campaign_merchants m
        where m.campaign_id=p_campaign and lower(btrim(m.name))=lower(v_merchant_name_text);
      if v_matches<>1 then
        raise exception 'Row %: merchant name missing or ambiguous: %',v_no,v_merchant_name_text using errcode='22023';
      end if;
    end if;

    v_item_id:=null; v_item_name:=null;
    if v_item_id_text<>'' then
      if v_item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row %: item_definition_id is not a UUID',v_no using errcode='22023';
      end if;
      v_item_id:=v_item_id_text::uuid;
      select d.name into v_item_name
        from public.item_definitions d
        where d.id=v_item_id and (d.campaign_id=p_campaign
          or (d.campaign_id is null and d.ruleset_version_id=v_ruleset));
      if not found then
        raise exception 'Row %: item_definition_id is unavailable to this campaign',v_no using errcode='22023';
      end if;
      if v_item_name_text<>'' and lower(v_item_name_text)<>lower(btrim(v_item_name)) then
        raise exception 'Row %: item_name does not match item_definition_id',v_no using errcode='22023';
      end if;
    else
      select count(*),(array_agg(d.id))[1],min(d.name)
        into v_matches,v_item_id,v_item_name
        from public.item_definitions d
        where lower(btrim(d.name))=lower(v_item_name_text)
          and (d.campaign_id=p_campaign or (d.campaign_id is null and d.ruleset_version_id=v_ruleset));
      if v_matches<>1 then
        raise exception 'Row %: item name missing or ambiguous: %',v_no,v_item_name_text using errcode='22023';
      end if;
    end if;

    select count(*),(array_agg(c.id))[1],max(c.precision_digits)
      into v_matches,v_currency_id,v_currency_precision
      from public.currencies c
      where c.campaign_id=p_campaign and upper(btrim(c.code))=v_currency_code;
    if v_matches<>1 or v_currency_precision not between 0 and 6 then
      raise exception 'Row %: unknown or ambiguous campaign currency code: %',v_no,v_currency_code using errcode='22023';
    end if;
    if round(v_price,v_currency_precision)<>v_price
      or round(v_buyback,v_currency_precision)<>v_buyback then
      raise exception 'Row %: price or buyback exceeds currency % precision (% decimals)',
        v_no,v_currency_code,v_currency_precision using errcode='22023';
    end if;
    v_key:=v_merchant_id::text||'|'||v_item_id::text||'|'||v_currency_id::text;
    if v_key=any(v_seen) then
      raise exception 'Row %: duplicate merchant/item/currency listing in CSV; combine into one row',
        v_no using errcode='22023';
    end if;
    v_seen:=array_append(v_seen,v_key);

    v_listing_id:=null;v_old_price:=null;v_old_buyback:=null;v_old_quantity:=null;v_old_buys:=null;
    if p_dry_run then
      select l.id,l.unit_price,l.buyback_price,l.quantity,l.buys_from_players
        into v_listing_id,v_old_price,v_old_buyback,v_old_quantity,v_old_buys
        from public.merchant_listings l
        where l.merchant_id=v_merchant_id and l.definition_id=v_item_id
          and l.currency_id=v_currency_id;
    else
      select l.id,l.unit_price,l.buyback_price,l.quantity,l.buys_from_players
        into v_listing_id,v_old_price,v_old_buyback,v_old_quantity,v_old_buys
        from public.merchant_listings l
        where l.merchant_id=v_merchant_id and l.definition_id=v_item_id
          and l.currency_id=v_currency_id
        for update;
    end if;
    v_action:=case when v_listing_id is null then 'create' else 'replace' end;
    v_plan:=v_plan||jsonb_build_array(jsonb_build_object(
      'row',v_no,'action',v_action,
      'merchant_id',v_merchant_id,'merchant_name',v_merchant_name,'merchant_active',v_merchant_active,
      'item_definition_id',v_item_id,'item_name',v_item_name,
      'currency_id',v_currency_id,'currency_code',v_currency_code,
      'unit_price',v_price,'buyback_price',v_buyback,'quantity',v_quantity,
      'buys_from_players',v_buys,'listing_id',v_listing_id,
      'old_unit_price',v_old_price,'old_buyback_price',v_old_buyback,
      'old_quantity',v_old_quantity,'old_buys_from_players',v_old_buys));
  end loop;

  if not p_dry_run then
    if p_expected is null or jsonb_typeof(p_expected)<>'array' or p_expected<>v_plan then
      raise exception 'Shop listings changed since preview, or preview missing. Validate & Preview again before importing'
        using errcode='40001';
    end if;
    for v_record in select value from jsonb_array_elements(v_plan) loop
      -- New listings can be concurrently created outside the CSV importer.
      -- Reject rather than silently overwriting a listing not seen in preview.
      if v_record->>'action'='create' and exists(
        select 1 from public.merchant_listings l where l.merchant_id=(v_record->>'merchant_id')::uuid
          and l.definition_id=(v_record->>'item_definition_id')::uuid
          and l.currency_id=(v_record->>'currency_id')::uuid
      ) then
        raise exception 'A new listing appeared since preview; validate again' using errcode='40001';
      end if;
      v_new_id:=public.save_merchant_listing(
        (v_record->>'merchant_id')::uuid,(v_record->>'item_definition_id')::uuid,
        (v_record->>'currency_id')::uuid,(v_record->>'unit_price')::numeric,
        (v_record->>'buyback_price')::numeric,(v_record->>'quantity')::integer,
        (v_record->>'buys_from_players')::boolean);
      if v_record->>'action'='create' then v_created:=v_created+1;
      else v_updated:=v_updated+1; end if;
      v_committed:=v_committed||jsonb_build_array(jsonb_build_object(
        'row',v_record->'row','listing_id',v_new_id,'action',v_record->'action'));
    end loop;
  end if;
  return jsonb_build_object(
    'mode',case when p_dry_run then 'preview' else 'imported' end,
    'row_count',v_no,'rows',v_plan,'created',v_created,'updated',v_updated,
    'applied',v_committed,'stock_mode','replace');
end
$function$;

revoke all on function public.gm_import_shop_stock_csv(uuid,jsonb,boolean,jsonb) from public,anon;
grant execute on function public.gm_import_shop_stock_csv(uuid,jsonb,boolean,jsonb) to authenticated;