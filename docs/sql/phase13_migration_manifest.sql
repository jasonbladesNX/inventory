
-- Phase 13: cross-campaign resource mapping / non-destructive transfer manifest.
create table if not exists public.character_migration_manifests(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.character_transfer_requests(id) on delete cascade,
 source_campaign_id uuid not null references public.campaigns(id),
 target_campaign_id uuid not null references public.campaigns(id),
 status text not null default 'draft' check(status in('draft','reviewed','invalidated')),
 mapping jsonb not null default '{}'::jsonb,
 created_by uuid not null references auth.users(id),
 reviewed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.character_migration_manifests enable row level security;
revoke all on public.character_migration_manifests from public,anon,authenticated;

create or replace function public.preview_character_migration(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.character_transfer_requests%rowtype;
 v_items jsonb;v_slots jsonb;v_money jsonb;v_recipes jsonb;
begin
 select * into t from public.character_transfer_requests where id=p_request;
 if auth.uid() is null or t.id is null or not (t.requested_by=auth.uid()
 or app_private.is_gm(t.source_campaign_id) or app_private.is_gm(t.target_campaign_id)) then
  raise exception 'Not authorized' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'source_id',d.id,'name',d.name,'code',d.code,'source_category',d.category,
  'matches',coalesce((select jsonb_agg(jsonb_build_object('id',other.id,'name',other.name,'code',other.code,'category',other.category) order by other.name,other.id)
   from public.item_definitions other
   where other.campaign_id=t.target_campaign_id and
   ((d.code is not null and other.code=d.code and other.category=d.category)
   or (d.code is null and lower(other.name)=lower(d.name) and other.category=d.category))), '[]'::jsonb),
  'instance_count',q.instance_count
 ) order by d.name,d.id),'[]'::jsonb) into v_items
 from (select i.definition_id,count(*) instance_count
   from public.item_instances i join public.inventory_holders h on h.id=i.holder_id
   where h.character_id=t.character_id group by i.definition_id) q
 join public.item_definitions d on d.id=q.definition_id;
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',e.id,'code',e.code,'label',e.label,
 'matches',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'label',d.label) order by d.id)
 from public.equipment_slot_definitions d
 where d.campaign_id=t.target_campaign_id and d.code=e.code),'[]'::jsonb)
 ) order by e.code),'[]'::jsonb) into v_slots
 from public.equipment_slot_definitions e
 where e.id in (select slot_id from public.equipment_assignments where character_id=t.character_id);
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',c.id,'code',c.code,'name',c.name,'base_factor',c.base_factor,
 'balance',b.amount,
 'matches',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'base_factor',d.base_factor) order by d.id)
 from public.currencies d where d.campaign_id=t.target_campaign_id and d.code=c.code),'[]'::jsonb)
 ) order by c.code),'[]'::jsonb) into v_money
 from public.wallet_balances b
 join public.wallets w on w.id=b.wallet_id
 join public.inventory_holders h on h.id=w.holder_id and h.character_id=t.character_id
 join public.currencies c on c.id=b.currency_id;
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',r.id,'name',r.name,
 'matches',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name) order by d.id)
 from public.campaign_crafting_recipes d where d.campaign_id=t.target_campaign_id and lower(d.name)=lower(r.name)),'[]'::jsonb)
 ) order by r.name),'[]'::jsonb) into v_recipes
 from public.character_learned_crafting_recipes lr
 join public.campaign_crafting_recipes r on r.id=lr.recipe_id
 where lr.character_id=t.character_id;
 return jsonb_build_object('request_id',t.id,'status',t.status,'item_definitions',v_items,
 'equipment_slots',v_slots,'currency_balances',v_money,'learned_recipes',v_recipes,
 'source_campaign_id',t.source_campaign_id,'target_campaign_id',t.target_campaign_id,
 'mode','preview_only','automatic_populated_migration',false);
end $$;
revoke all on function public.preview_character_migration(uuid) from public,anon;
grant execute on function public.preview_character_migration(uuid) to authenticated;

create or replace function public.save_character_migration_manifest(p_request uuid,p_mapping jsonb,p_review boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.character_transfer_requests%rowtype; v_id uuid;actor uuid:=auth.uid();
begin
 select * into t from public.character_transfer_requests where id=p_request for update;
 if actor is null or t.id is null or not app_private.is_gm(t.target_campaign_id) or t.status<>'approved_pending_migration'
 then raise exception 'Destination GM and dual approval required' using errcode='42501';end if;
 if jsonb_typeof(p_mapping)<>'object' or length(p_mapping::text)>100000 then
  raise exception 'Mapping must be an object below 100kb' using errcode='22023';end if;
 insert into public.character_migration_manifests(request_id,source_campaign_id,target_campaign_id,mapping,status,created_by,reviewed_by)
 values(t.id,t.source_campaign_id,t.target_campaign_id,p_mapping,
  case when p_review then 'reviewed' else 'draft' end,actor,case when p_review then actor else null end)
 on conflict(request_id) do update set mapping=excluded.mapping,status=excluded.status,
 reviewed_by=excluded.reviewed_by,updated_at=now()
 returning id into v_id;
 return jsonb_build_object('id',v_id,'status',case when p_review then 'reviewed' else 'draft' end);
end $$;
revoke all on function public.save_character_migration_manifest(uuid,jsonb,boolean) from public,anon;
grant execute on function public.save_character_migration_manifest(uuid,jsonb,boolean) to authenticated;
