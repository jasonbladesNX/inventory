create or replace function public.list_character_merchant_sale_items(p_character uuid)
returns table(item_id uuid,definition_id uuid,item_name text,quantity numeric)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid;
begin
 select c.campaign_id into v_campaign from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=(select auth.uid()) and m.status='active';
 if v_campaign is null then raise exception 'Not authorized' using errcode='42501';end if;
 return query select i.id,i.definition_id,coalesce(i.custom_name,d.name),i.quantity
 from public.item_instances i join public.inventory_holders h on h.id=i.holder_id
 join public.item_definitions d on d.id=i.definition_id
 where h.character_id=p_character and h.campaign_id=v_campaign
 and i.container_id is null and i.identified and i.condition_code='normal'
 and i.custom_name is null and i.properties='{}'::jsonb and i.private_properties='{}'::jsonb
 and i.quantity=trunc(i.quantity) and i.quantity>0
 and not exists(select 1 from public.equipment_assignments a where a.item_instance_id=i.id)
 and not exists(select 1 from public.item_instances nested where nested.container_id=i.id)
 order by d.name,i.id;
end $function$;
revoke all on function public.list_character_merchant_sale_items(uuid) from public,anon;
grant execute on function public.list_character_merchant_sale_items(uuid) to authenticated;