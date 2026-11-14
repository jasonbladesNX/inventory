
create or replace function public.distribute_party_bank_loot(
 p_party uuid,p_item uuid,p_target_character uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare party public.campaign_parties%rowtype;bank public.campaign_banks%rowtype;
 i public.item_instances%rowtype;dest uuid;v_id uuid;v_name text;is_running boolean;
begin
 select * into party from public.campaign_parties where id=p_party for update;
 if auth.uid() is null or party.id is null or not app_private.is_gm(party.campaign_id)
 then raise exception 'GM permission required' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(party.campaign_id) on conflict do nothing;
 select s.is_running into is_running from public.campaign_session_state s where s.campaign_id=party.campaign_id for update;
 if is_running then raise exception 'Party bank loot distribution is unavailable during play' using errcode='42501';end if;
 select * into bank from public.campaign_banks where party_id=party.id and bank_type='party';
 if bank.id is null then raise exception 'Party bank not found';end if;
 if not exists(select 1 from public.campaign_party_members pm
 join public.characters c on c.id=pm.character_id and c.is_active
 join public.campaign_members m on m.id=c.member_id and m.status='active'
 where pm.party_id=party.id and pm.character_id=p_target_character) then
  raise exception 'Recipient must be an active party member' using errcode='42501';end if;
 select id into dest from public.inventory_holders
 where character_id=p_target_character and campaign_id=party.campaign_id and holder_type='character' limit 1;
 if dest is null then raise exception 'Recipient inventory missing' using errcode='22023';end if;
 select * into i from public.item_instances where id=p_item for update;
 if i.id is null or i.holder_id<>bank.holder_id or i.campaign_id<>party.campaign_id or
 p_quantity is null or p_quantity<=0 or p_quantity>i.quantity or i.container_id is not null or
 exists(select 1 from public.item_effects e where e.item_instance_id=i.id) or
 exists(select 1 from public.containers c where c.properties->>'source_item_id'=i.id::text)
 then raise exception 'Bank item cannot be distributed' using errcode='22023';end if;
 select case when i.identified then coalesce(i.custom_name,d.name) else 'Unidentified Item' end
 into v_name from public.item_definitions d where d.id=i.definition_id;
 if i.quantity=p_quantity then
  update public.item_instances set holder_id=dest where id=i.id;v_id:=i.id;
 else
  update public.item_instances set quantity=quantity-p_quantity where id=i.id;
  insert into public.item_instances(campaign_id,definition_id,holder_id,quantity,condition_code,identified,custom_name,properties,private_properties,version)
   values(i.campaign_id,i.definition_id,dest,p_quantity,i.condition_code,i.identified,i.custom_name,i.properties,i.private_properties,i.version)
  returning id into v_id;
 end if;
 insert into public.campaign_bank_activity(campaign_id,bank_id,character_id,actor_user_id,action,item_instance_id,item_name,quantity)
 values(party.campaign_id,bank.id,p_target_character,auth.uid(),'withdraw',v_id,v_name,p_quantity);
 return jsonb_build_object('ok',true,'recipient',p_target_character,'item_id',v_id,'quantity',p_quantity);
end $$;
revoke all on function public.distribute_party_bank_loot(uuid,uuid,uuid,numeric) from public,anon;
grant execute on function public.distribute_party_bank_loot(uuid,uuid,uuid,numeric) to authenticated;
