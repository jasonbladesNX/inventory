-- Milestone 7.9: GM-managed one-time QR loot containers.
create or replace function public.create_qr_loot_container(p_campaign uuid,p_name text)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_holder uuid;v_source uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Name must be 2–120 characters' using errcode='22023';end if;
 v_holder:=public.create_gm_loot_holder(p_campaign,trim(p_name));
 v_source:=public.create_loot_source(p_campaign,v_holder,trim(p_name),'first_claim','instant');
 return v_source;
end $function$;

create or replace function public.list_gm_qr_loot_containers(p_campaign uuid)
returns table(id uuid,name text,is_active boolean,holder_id uuid,item_count bigint,total_units numeric,claims bigint)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 return query
 select l.id,l.name,l.is_active,l.holder_id,
 (select count(*) from public.item_instances i where i.holder_id=l.holder_id)::bigint,
 (select coalesce(sum(i.quantity),0) from public.item_instances i where i.holder_id=l.holder_id)::numeric,
 (select count(*) from public.loot_claims c where c.loot_source_id=l.id and c.status='completed')::bigint
 from public.loot_sources l where l.campaign_id=p_campaign
 and l.claim_mode='first_claim' and l.scan_behavior='instant'
 order by l.created_at desc,l.id;
end $function$;

create or replace function public.list_gm_qr_loot_items(p_source uuid)
returns table(item_id uuid,definition_id uuid,name text,quantity numeric)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;v_holder uuid;
begin
 select l.campaign_id,l.holder_id into v_campaign,v_holder from public.loot_sources l where l.id=p_source;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then raise exception 'GM required' using errcode='42501';end if;
 return query select i.id,i.definition_id,d.name,i.quantity from public.item_instances i join public.item_definitions d on d.id=i.definition_id
 where i.holder_id=v_holder order by d.name,i.id;
end $function$;

create or replace function public.add_qr_loot_item(p_source uuid,p_definition uuid,p_quantity integer)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_holder uuid;v_active boolean;v_item uuid;v_i integer;
begin
 select l.campaign_id,l.holder_id,l.is_active into v_campaign,v_holder,v_active from public.loot_sources l where l.id=p_source for update;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if not v_active then raise exception 'Loot container already claimed or inactive' using errcode='22023';end if;
 if p_quantity is null or p_quantity not between 1 and 500 then raise exception 'Quantity must be 1–500' using errcode='22023';end if;
 if not exists(select 1 from public.item_definitions d join public.campaigns c on c.id=v_campaign
 where d.id=p_definition and (d.campaign_id=v_campaign or (d.campaign_id is null and d.ruleset_version_id=c.ruleset_version_id)))
 then raise exception 'Item unavailable to campaign' using errcode='22023';end if;
 if app_private.item_can_auto_stack(p_definition) then
   insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
   values(v_campaign,p_definition,v_holder,p_quantity) returning id into v_item;
   v_item:=app_private.consolidate_item_location(v_item);
 else
   for v_i in 1..p_quantity loop
     insert into public.item_instances(campaign_id,definition_id,holder_id,quantity)
     values(v_campaign,p_definition,v_holder,1) returning id into v_item;
   end loop;
 end if;
 return v_item;
end $function$;

create or replace function public.remove_qr_loot_item(p_source uuid,p_item uuid)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_holder uuid;v_active boolean;
begin
 select l.campaign_id,l.holder_id,l.is_active into v_campaign,v_holder,v_active from public.loot_sources l where l.id=p_source for update;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if not v_active then raise exception 'Container inactive' using errcode='22023';end if;
 delete from public.item_instances i where i.id=p_item and i.holder_id=v_holder
 and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)
 and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id);
 if not found then raise exception 'Item not removable from container' using errcode='22023';end if;
 return true;
end $function$;

create or replace function public.set_qr_loot_container_active(p_source uuid,p_active boolean)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_campaign uuid;v_claimed boolean;
begin
 select l.campaign_id into v_campaign from public.loot_sources l where l.id=p_source;
 if v_campaign is null or (select auth.uid()) is null or not app_private.is_gm(v_campaign) then raise exception 'GM required' using errcode='42501';end if;
 select exists(select 1 from public.loot_claims c where c.loot_source_id=p_source and c.status='completed') into v_claimed;
 if p_active and v_claimed then raise exception 'A claimed container cannot be reactivated' using errcode='22023';end if;
 update public.loot_sources set is_active=p_active where id=p_source;
 return p_active;
end $function$;

revoke all on function public.create_qr_loot_container(uuid,text) from public,anon;
revoke all on function public.list_gm_qr_loot_containers(uuid) from public,anon;
revoke all on function public.list_gm_qr_loot_items(uuid) from public,anon;
revoke all on function public.add_qr_loot_item(uuid,uuid,integer) from public,anon;
revoke all on function public.remove_qr_loot_item(uuid,uuid) from public,anon;
revoke all on function public.set_qr_loot_container_active(uuid,boolean) from public,anon;
grant execute on function public.create_qr_loot_container(uuid,text) to authenticated;
grant execute on function public.list_gm_qr_loot_containers(uuid) to authenticated;
grant execute on function public.list_gm_qr_loot_items(uuid) to authenticated;
grant execute on function public.add_qr_loot_item(uuid,uuid,integer) to authenticated;
grant execute on function public.remove_qr_loot_item(uuid,uuid) to authenticated;
grant execute on function public.set_qr_loot_container_active(uuid,boolean) to authenticated;