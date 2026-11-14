CREATE OR REPLACE FUNCTION public.get_party_gameplay_summary(p_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.campaign_parties%rowtype;actor uuid:=auth.uid();
begin
 select * into p from public.campaign_parties where id=p_party;
 if actor is null or p.id is null or not (
   app_private.is_gm(p.campaign_id) or exists(
    select 1 from public.campaign_party_members pm
    join public.characters c on c.id=pm.character_id and c.is_active
    join public.campaign_members m on m.id=c.member_id
    where pm.party_id=p.id and m.user_id=actor and m.status='active'))
 then raise exception 'Party access required' using errcode='42501';end if;
 return jsonb_build_object('party_id',p.id,'name',p.name,
  'bank_items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',i.id,'name',case when i.identified then coalesce(i.custom_name,d.name) else 'Unidentified Item' end,
 'quantity',i.quantity) order by d.name,i.id)
 from public.campaign_banks b join public.item_instances i on i.holder_id=b.holder_id
 join public.item_definitions d on d.id=i.definition_id
 where b.party_id=p.id and b.bank_type='party'),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(jsonb_build_object(
   'character_id',c.id,'name',c.name,'zone_id',z.id,'zone_name',z.name,
   'hp',c.sheet_data->'hp','initiative_roll',i.roll,'initiative_score',i.score,'initiative_position',i.position)
   order by c.name,c.id)
   from public.campaign_party_members pm join public.characters c on c.id=pm.character_id and c.is_active
   left join public.character_zone_assignments a on a.character_id=c.id
   left join public.campaign_zones z on z.id=a.zone_id
   left join public.zone_initiative_entries i on i.character_id=c.id and i.zone_id=z.id
   where pm.party_id=p.id),'[]'::jsonb));
end $function$
;
