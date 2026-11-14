-- Milestone 8.5: collect all independently failing CSV rows after an atomic preview failure.
-- This function performs only dry-run calls and never writes.
create or replace function public.gm_csv_diagnose_rows(
  p_campaign uuid,p_kind text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_row jsonb; v_no int:=0; v_message text; v_state text;
  v_issues jsonb:='[]'::jsonb;
begin
  if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
    raise exception 'GM permission required for CSV validation' using errcode='42501';
  end if;
  if p_kind not in ('catalog','character-inventory','shop-stock','loot-contents') then
    raise exception 'Unsupported CSV import type' using errcode='22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 200
    or (p_kind='catalog' and jsonb_array_length(p_rows)>100) then
    raise exception 'Invalid CSV diagnostic row count' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_no:=v_no+1;
    begin
      if p_kind='catalog' then
        perform public.gm_import_catalog_csv(p_campaign,jsonb_build_array(v_row),true);
      elsif p_kind='character-inventory' then
        perform public.gm_import_character_inventory_csv(p_campaign,jsonb_build_array(v_row),true);
      elsif p_kind='shop-stock' then
        perform public.gm_import_shop_stock_csv(p_campaign,jsonb_build_array(v_row),true,null);
      else
        perform public.gm_import_qr_loot_csv(p_campaign,jsonb_build_array(v_row),true,null);
      end if;
    exception when others then
      get stacked diagnostics v_message=message_text,v_state=returned_sqlstate;
      if v_state='42501' then raise;end if;
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
        'row',v_no,'message',v_message,'code',v_state));
    end;
  end loop;
  return jsonb_build_object('checked',v_no,'issues',v_issues);
end
$function$;
revoke all on function public.gm_csv_diagnose_rows(uuid,text,jsonb) from public,anon;
grant execute on function public.gm_csv_diagnose_rows(uuid,text,jsonb) to authenticated;