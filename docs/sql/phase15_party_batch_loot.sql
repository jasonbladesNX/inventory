
-- Atomic GM batch distribution from an existing party bank. Dry-run by default.
-- Each allocation: {item_id, character_id, quantity, expected_quantity}.
-- Quantities use original bank stack state (optimistic freshness protection).
create or replace function public.batch_distribute_party_bank_loot(
 p_party uuid,p_allocations jsonb,p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_party public.campaign_parties%rowtype;v_bank public.campaign_banks%rowtype;
 v_running boolean;v_count integer;v_row jsonb;v_item uuid;v_character uuid;
 v_qty numeric;v_expected numeric;v_actual numeric;v_name text;v_total numeric;
 v_preview jsonb:='[]'::jsonb;v_results jsonb:='[]'::jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into v_party from public.campaign_parties where id=p_party for update;
 if v_party.id is null or not app_private.is_gm(v_party.campaign_id) then
  raise exception 'GM access required' using errcode='42501';end if;
 if not exists(select 1 from public.campaigns c where c.id=v_party.campaign_id and c.status='active')
 then raise exception 'Campaign inactive' using errcode='22023';end if;
 if p_allocations is null or jsonb_typeof(p_allocations)<>'array' then
  raise exception 'Allocations must be an array' using errcode='22023';end if;
 v_count:=jsonb_array_length(p_allocations);
 if v_count<1 or v_count>25 then
  raise exception 'Select 1 to 25 allocations' using errcode='22023';end if;
 select * into v_bank from public.campaign_banks b
 where b.party_id=p_party and b.bank_type='party';
 if v_bank.id is null then raise exception 'Party bank unavailable' using errcode='22023';end if;
 insert into public.campaign_session_state(campaign_id) values(v_party.campaign_id) on conflict do nothing;
 select is_running into v_running from public.campaign_session_state
 where campaign_id=v_party.campaign_id for update;
 if v_running then raise exception 'Party loot cannot be distributed during a running game' using errcode='42501';end if;
 -- Validate all rows BEFORE any destructive inventory mutation.
 for v_row in select value from jsonb_array_elements(p_allocations) loop
  if jsonb_typeof(v_row)<>'object' or
   coalesce(v_row->>'item_id','')='' or coalesce(v_row->>'character_id','')='' or
   coalesce(v_row->>'quantity','')='' or coalesce(v_row->>'expected_quantity','')=''
  then raise exception 'Every allocation needs item, recipient, quantity and expected stock' using errcode='22023';end if;
  begin
   v_item:=(v_row->>'item_id')::uuid;
   v_character:=(v_row->>'character_id')::uuid;
   v_qty:=(v_row->>'quantity')::numeric;
   v_expected:=(v_row->>'expected_quantity')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
   raise exception 'Allocation contains invalid numbers or identifiers' using errcode='22023';
  end;
  if v_qty is null or v_qty<=0 or v_expected is null or v_expected<=0 then
   raise exception 'Quantity and expected stock must be positive' using errcode='22023';end if;
  if not exists(
   select 1 from public.campaign_party_members pm
   join public.characters c on c.id=pm.character_id and c.is_active
   join public.campaign_members m on m.id=c.member_id and m.status='active'
   join public.inventory_holders h on h.character_id=c.id
    and h.campaign_id=v_party.campaign_id and h.holder_type='character'
   where pm.party_id=v_party.id and pm.character_id=v_character
  ) then raise exception 'Allocation recipient must be an active party member with inventory' using errcode='42501';end if;
 end loop;

 -- Acquire item locks deterministically, so concurrent batches cannot double spend.
 perform 1 from public.item_instances i
 where i.id in (
  select (value->>'item_id')::uuid from jsonb_array_elements(p_allocations)
 ) order by i.id for update;

 for v_row in select value from jsonb_array_elements(p_allocations) loop
  v_item:=(v_row->>'item_id')::uuid;
  v_character:=(v_row->>'character_id')::uuid;
  v_qty:=(v_row->>'quantity')::numeric;
  v_expected:=(v_row->>'expected_quantity')::numeric;
  select i.quantity,case when i.identified then coalesce(i.custom_name,d.name) else 'Unidentified Item' end
  into v_actual,v_name from public.item_instances i
  join public.item_definitions d on d.id=i.definition_id
  where i.id=v_item and i.campaign_id=v_party.campaign_id and i.holder_id=v_bank.holder_id
    and i.container_id is null
    and not exists(select 1 from public.item_effects e where e.item_instance_id=i.id)
    and not exists(select 1 from public.containers c where c.properties->>'source_item_id'=i.id::text);
  if v_actual is null then raise exception 'An item is missing or cannot be distributed' using errcode='22023';end if;
  if v_actual is distinct from v_expected then
   raise exception 'Bank stock changed: refresh the party bank and preview again' using errcode='40001';end if;
  select coalesce(sum((a.value->>'quantity')::numeric),0) into v_total
  from jsonb_array_elements(p_allocations) a where (a.value->>'item_id')::uuid=v_item;
  if v_total>v_actual then raise exception 'Allocations exceed available bank stock' using errcode='22023';end if;
  v_preview:=v_preview||jsonb_build_array(jsonb_build_object(
   'item_id',v_item,'item_name',v_name,'recipient',v_character,
   'quantity',v_qty,'expected_stock',v_actual
  ));
 end loop;

 if p_apply then
  for v_row in select value from jsonb_array_elements(p_allocations) loop
   v_results:=v_results||jsonb_build_array(
    public.distribute_party_bank_loot(
     p_party,(v_row->>'item_id')::uuid,(v_row->>'character_id')::uuid,
     (v_row->>'quantity')::numeric
    )
   );
  end loop;
 end if;
 return jsonb_build_object('ok',true,'applied',coalesce(p_apply,false),
  'allocation_count',v_count,'allocations',v_preview,'results',v_results);
end $$;
revoke all on function public.batch_distribute_party_bank_loot(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.batch_distribute_party_bank_loot(uuid,jsonb,boolean) to authenticated;
