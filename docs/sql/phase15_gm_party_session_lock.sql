CREATE OR REPLACE FUNCTION public.manage_campaign_party(p_campaign uuid, p_action text, p_party uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_character uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_party uuid; holder uuid; bank_id uuid;
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 if p_action in('create','add_member','remove_member') then
  insert into public.campaign_session_state(campaign_id) values(p_campaign) on conflict do nothing;
  if exists(select 1 from public.campaign_session_state where campaign_id=p_campaign and is_running for update) then
   raise exception 'Party membership is locked during an active game' using errcode='42501';
  end if;
 end if;
 if p_action='create' then
  insert into public.campaign_parties(campaign_id,name,created_by)
   values(p_campaign,trim(p_name),auth.uid()) returning id into v_party;
  insert into public.inventory_holders(campaign_id,holder_type,name)
   values(p_campaign,'party',trim(p_name)||' Bank') returning id into holder;
  insert into public.campaign_banks(campaign_id,bank_type,party_id,holder_id)
   values(p_campaign,'party',v_party,holder) returning id into bank_id;
  return jsonb_build_object('id',v_party,'bank_id',bank_id);
 end if;
 select id into v_party from public.campaign_parties where id=p_party and campaign_id=p_campaign for update;
 if v_party is null then raise exception 'Party not found' using errcode='22023';end if;
 if p_action='add_member' then
  if not exists(select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
    where c.id=p_character and c.campaign_id=p_campaign and c.is_active and m.status='active') then
   raise exception 'Active character required' using errcode='22023';end if;
  insert into public.campaign_party_members(party_id,campaign_id,character_id) values(v_party,p_campaign,p_character);
 elsif p_action='remove_member' then
  delete from public.campaign_party_members where party_id=v_party and campaign_id=p_campaign and character_id=p_character;
 elsif p_action='rename' then
  if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Invalid party name';end if;
  update public.campaign_parties set name=trim(p_name) where id=v_party;
 else raise exception 'Invalid party operation';end if;
 return jsonb_build_object('id',v_party,'ok',true);
end $function$
;
