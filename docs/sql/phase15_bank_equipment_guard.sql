
create or replace function app_private.block_bank_equipment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.item_instances i join public.campaign_banks b on b.holder_id=i.holder_id
   where i.id=new.item_instance_id) then
  raise exception 'Banked items must be withdrawn before equipping' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_bank_equipment before insert or update on public.equipment_assignments
for each row execute function app_private.block_bank_equipment();
