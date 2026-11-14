
create or replace function public.validate_character_migration_manifest(p_request uuid,p_mapping jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare preview jsonb;v_section text;rec jsonb;chosen text;v_match jsonb;missing jsonb:='[]'::jsonb;invalid jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(p_mapping)<>'object' then raise exception 'Mapping object required' using errcode='22023';end if;
 preview:=public.preview_character_migration(p_request);
 foreach v_section in array array['item_definitions','equipment_slots','currency_balances','learned_recipes'] loop
  if p_mapping?v_section and jsonb_typeof(p_mapping->v_section)<>'object' then
    raise exception 'Mapping section must be an object: %',v_section using errcode='22023';end if;
  for rec in select value from jsonb_array_elements(preview->v_section) loop
   chosen:=p_mapping->v_section->>(rec->>'source_id');
   if chosen is null or chosen='' then
    missing:=missing||jsonb_build_array(jsonb_build_object('section',v_section,'source_id',rec->>'source_id','name',coalesce(rec->>'name',rec->>'code',rec->>'label')));
   elsif not exists(select 1 from jsonb_array_elements(rec->'matches') choice where choice->>'id'=chosen) then
    invalid:=invalid||jsonb_build_array(jsonb_build_object('section',v_section,'source_id',rec->>'source_id','target_id',chosen));
   end if;
  end loop;
 end loop;
 return jsonb_build_object('valid',jsonb_array_length(missing)=0 and jsonb_array_length(invalid)=0,
  'missing',missing,'invalid',invalid,'missing_count',jsonb_array_length(missing),
  'invalid_count',jsonb_array_length(invalid));
end $$;
revoke all on function public.validate_character_migration_manifest(uuid,jsonb) from public,anon;
grant execute on function public.validate_character_migration_manifest(uuid,jsonb) to authenticated;
