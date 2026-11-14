CREATE OR REPLACE FUNCTION public.manage_bank_item(p_character uuid, p_bank uuid, p_item uuid, p_action text, p_quantity numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ch public.characters%rowtype;b public.campaign_banks%rowtype;
 i public.item_instances%rowtype; source_holder uuid; destination_holder uuid;
 v_id uuid;v_name text;session_running boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.id=p_character and m.user_id=auth.uid() and m.status='active' and c.is_active;
 if ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select is_running into session_running from public.campaign_session_state where campaign_id=ch.campaign_id for update;
 if session_running then raise exception 'Banks are locked while the GM session is running' using errcode='42501';end if;
 select * into b from public.campaign_banks where id=p_bank and campaign_id=ch.campaign_id;
 if b.id is null or not ((b.bank_type='personal' and b.character_id=ch.id)
 or (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
  where pm.party_id=b.party_id and pm.character_id=ch.id)))
 then raise exception 'Bank access denied' using errcode='42501';end if;
 if p_action not in ('deposit','withdraw') or p_quantity is null or p_quantity<=0 or p_quantity>1000000
 then raise exception 'Invalid bank transfer' using errcode='22023';end if;
 select h.id into source_holder from public.inventory_holders h
 where h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character';
 if source_holder is null then raise exception 'Character inventory unavailable';end if;
 select * into i from public.item_instances where id=p_item for update;
 if i.id is null or i.campaign_id<>ch.campaign_id then raise exception 'Item unavailable';end if;
 if p_action='deposit' then
  if i.holder_id<>source_holder then raise exception 'Item is not carried by this character' using errcode='42501';end if;
  destination_holder:=b.holder_id;
 else
  if i.holder_id<>b.holder_id then raise exception 'Item is not stored in this bank' using errcode='42501';end if;
  destination_holder:=source_holder;
 end if;
 if i.quantity<p_quantity or i.container_id is not null or
  exists(select 1 from public.equipment_assignments ea where ea.item_instance_id=i.id) or
  exists(select 1 from public.containers co where co.id=i.id or co.properties->>'source_item_id'=i.id::text) or
  exists(select 1 from public.item_effects eff where eff.item_instance_id=i.id) or
  exists(select 1 from public.item_definitions d where d.id=i.definition_id and d.category='container') or
  exists(select 1 from public.trade_offers t where t.status in('proposed','countered','accepted')
    and position(i.id::text in t.offer::text)>0)
 then raise exception 'Item is equipped, nested, a container, reserved in an active trade, or has insufficient quantity' using errcode='22023';end if;
 select coalesce(i.custom_name,d.name) into v_name from public.item_definitions d where d.id=i.definition_id;
 if i.quantity=p_quantity then
  update public.item_instances set holder_id=destination_holder where id=i.id;
  v_id:=i.id;
 else
  update public.item_instances set quantity=quantity-p_quantity where id=i.id;
  insert into public.item_instances(campaign_id,definition_id,holder_id,container_id,quantity,
    condition_code,identified,custom_name,properties,private_properties,version)
  values(i.campaign_id,i.definition_id,destination_holder,null,p_quantity,
   i.condition_code,i.identified,i.custom_name,i.properties,i.private_properties,i.version)
  returning id into v_id;
 end if;
 insert into public.campaign_bank_activity(campaign_id,bank_id,character_id,actor_user_id,action,item_instance_id,item_name,quantity)
 values(ch.campaign_id,b.id,ch.id,auth.uid(),p_action,v_id,v_name,p_quantity);
 return jsonb_build_object('ok',true,'item_id',v_id,'quantity',p_quantity,'action',p_action);
end $function$
;
