
-- Phase 12.6: guarded in-place migration for dependency-free characters.
-- Populated characters remain blocked pending an explicit item/currency/recipe conversion design.
alter table public.character_transfer_requests drop constraint character_transfer_requests_status_check;
alter table public.character_transfer_requests add constraint character_transfer_requests_status_check
 check (status in ('requested','awaiting_target','approved_pending_migration','rejected','cancelled','migrated'));
alter table public.character_transfer_requests add column if not exists migrated_at timestamptz;
alter table public.character_transfer_requests add column if not exists migrated_by uuid references auth.users(id);

create or replace function app_private.character_transfer_blockers(p_character uuid, p_source uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb:='[]'::jsonb; r record; n bigint; holder_count bigint;
begin
 -- All character foreign-key references not explicitly migrated by the finalizer.
 for r in
  select distinct ns.nspname schema_name, cl.relname table_name, attr.attname column_name
  from pg_constraint fk
  join pg_class cl on cl.oid=fk.conrelid
  join pg_namespace ns on ns.oid=cl.relnamespace
  join lateral unnest(fk.conkey,fk.confkey) as k(local_attnum,foreign_attnum) on true
  join pg_attribute attr on attr.attrelid=cl.oid and attr.attnum=k.local_attnum
  join pg_attribute target on target.attrelid=fk.confrelid and target.attnum=k.foreign_attnum
  where fk.contype='f' and fk.confrelid='public.characters'::regclass and target.attname='id'
    and cl.relkind in ('r','p')
    and (ns.nspname,cl.relname) not in (
       ('public','character_transfer_requests'),
       ('public','character_attributes'),
       ('public','character_initiative_preferences'),
       ('public','character_zone_assignments'),
       ('public','inventory_holders'))
 loop
  execute format('select count(*) from %I.%I where %I=$1',r.schema_name,r.table_name,r.column_name)
    into n using p_character;
  if n>0 then
   v:=v||jsonb_build_array(jsonb_build_object('type','character_reference','source',r.schema_name||'.'||r.table_name,'count',n));
  end if;
 end loop;
 -- Inventory holders may move only when completely empty; source wallet and
 -- container data must never be silently dropped.
 select count(*) into holder_count from public.inventory_holders
 where character_id=p_character and campaign_id=p_source;
 if holder_count>1 then
  v:=v||jsonb_build_array(jsonb_build_object('type','multiple_inventory_holders','count',holder_count));
 end if;
 for r in
  select 'item_instances' as name,count(*) n from public.item_instances i
  join public.inventory_holders h on h.id=i.holder_id where h.character_id=p_character and h.campaign_id=p_source
  union all
  select 'wallets',count(*) from public.wallets w
  join public.inventory_holders h on h.id=w.holder_id where h.character_id=p_character and h.campaign_id=p_source
  union all
  select 'containers',count(*) from public.containers co
  join public.inventory_holders h on h.id=co.holder_id where h.character_id=p_character and h.campaign_id=p_source
 loop
  if r.n>0 then v:=v||jsonb_build_array(jsonb_build_object('type','inventory_dependency','source',r.name,'count',r.n));end if;
 end loop;
 return v;
end $$;
revoke all on function app_private.character_transfer_blockers(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_character_transfer_migration_check(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tr public.character_transfer_requests%rowtype; actor uuid:=auth.uid(); v_source record;v_target record;
 blockers jsonb;target_member uuid;active_count bigint;
begin
 select * into tr from public.character_transfer_requests where id=p_request;
 if actor is null or tr.id is null or not (tr.requested_by=actor or
  app_private.is_gm(tr.source_campaign_id) or app_private.is_gm(tr.target_campaign_id)) then
   raise exception 'Not authorized' using errcode='42501';end if;
 select ruleset_version_id,settings, ruleset_overrides into v_source from public.campaigns where id=tr.source_campaign_id;
 select ruleset_version_id,settings, ruleset_overrides into v_target from public.campaigns where id=tr.target_campaign_id;
 blockers:=app_private.character_transfer_blockers(tr.character_id,tr.source_campaign_id);
 if v_source.ruleset_version_id is distinct from v_target.ruleset_version_id or
  v_source.ruleset_overrides is distinct from v_target.ruleset_overrides then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('type','ruleset_mismatch','source','campaign ruleset/version/overrides'));
 end if;
 select id into target_member from public.campaign_members
  where campaign_id=tr.target_campaign_id and user_id=tr.requested_by and status='active';
 if target_member is null then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('type','destination_membership','source','campaign_members'));
 end if;
 select count(*) into active_count from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.campaign_id=tr.target_campaign_id and m.user_id=tr.requested_by and c.is_active;
 if active_count>0 then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('type','existing_active_character','count',active_count));
 end if;
 if not exists(select 1 from public.campaign_zones z where z.campaign_id=tr.target_campaign_id and z.active) then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('type','no_active_destination_zone'));
 end if;
 if not exists(select 1 from public.characters c join public.campaign_members m on c.member_id=m.id
 where c.id=tr.character_id and c.campaign_id=tr.source_campaign_id and c.is_active and m.user_id=tr.requested_by and m.status='active') then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('type','source_character_unavailable'));
 end if;
 return jsonb_build_object('request_id',tr.id,'status',tr.status,'blockers',blockers,
  'can_migrate',tr.status='approved_pending_migration' and jsonb_array_length(blockers)=0,
  'mode','in_place_dependency_free',
  'guidance',case when jsonb_array_length(blockers)=0
    then 'The character has no blocked campaign-linked resources. A destination GM can finalize this atomic in-place transfer.'
    else 'Migration is blocked until dependencies are resolved. Inventory, currency, equipment, crafting, trades and active gameplay records are never silently removed or duplicated.' end);
end $$;
revoke all on function public.get_character_transfer_migration_check(uuid) from public,anon;
grant execute on function public.get_character_transfer_migration_check(uuid) to authenticated;

create or replace function public.finalize_character_campaign_transfer(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tr public.character_transfer_requests%rowtype; actor uuid:=auth.uid();ch public.characters%rowtype;
 dest_member uuid;dest_zone uuid;preflight jsonb;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into tr from public.character_transfer_requests where id=p_request for update;
 if tr.id is null or tr.status<>'approved_pending_migration' or
  tr.source_approved_by is null or tr.target_approved_by is null or
  not app_private.is_gm(tr.target_campaign_id) then
  raise exception 'Both approvals and destination GM authority required' using errcode='42501';end if;
 select * into ch from public.characters where id=tr.character_id for update;
 if ch.id is null or ch.campaign_id<>tr.source_campaign_id or not ch.is_active then
  raise exception 'Character changed since approval' using errcode='40001';end if;
 preflight:=public.get_character_transfer_migration_check(p_request);
 if not (preflight->>'can_migrate')::boolean then
  raise exception 'Character transfer blocked; review migration dependencies' using errcode='22023';end if;
 select id into dest_member from public.campaign_members
 where campaign_id=tr.target_campaign_id and user_id=tr.requested_by and status='active' for update;
 select id into dest_zone from public.campaign_zones
 where campaign_id=tr.target_campaign_id and active order by created_at,id limit 1;
 if dest_member is null or dest_zone is null then raise exception 'Destination unavailable' using errcode='40001';end if;
 -- Check other open requests before modifying primary campaign identities.
 if exists(select 1 from public.character_transfer_requests t where t.character_id=ch.id
 and t.id<>tr.id and t.status in ('requested','awaiting_target','approved_pending_migration')) then
  raise exception 'Conflicting pending transfer request' using errcode='40001';end if;
 delete from public.character_zone_assignments where character_id=ch.id;
 update public.character_initiative_preferences
   set campaign_id=tr.target_campaign_id where character_id=ch.id;
 update public.inventory_holders set campaign_id=tr.target_campaign_id
 where character_id=ch.id and campaign_id=tr.source_campaign_id;
 update public.characters set campaign_id=tr.target_campaign_id,member_id=dest_member where id=ch.id;
 insert into public.character_zone_assignments(character_id,campaign_id,zone_id)
 values(ch.id,tr.target_campaign_id,dest_zone);
 update public.character_transfer_requests set status='migrated',migrated_at=now(),migrated_by=actor,updated_at=now()
 where id=tr.id;
 perform app_private.notify_campaign_user(tr.target_campaign_id,tr.requested_by,'approval',
  'Character transfer complete','Your character is now assigned to the destination campaign.',null,'transfer:'||tr.id::text||':migrated');
 return jsonb_build_object('ok',true,'character_id',ch.id,'target_campaign_id',tr.target_campaign_id,'status','migrated');
end $$;
revoke all on function public.finalize_character_campaign_transfer(uuid) from public,anon;
grant execute on function public.finalize_character_campaign_transfer(uuid) to authenticated;
