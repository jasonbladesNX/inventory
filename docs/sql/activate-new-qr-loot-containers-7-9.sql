create or replace function public.create_qr_loot_container(p_campaign uuid,p_name text)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_holder uuid;v_source uuid;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then raise exception 'GM required' using errcode='42501';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Name must be 2–120 characters' using errcode='22023';end if;
 v_holder:=public.create_gm_loot_holder(p_campaign,trim(p_name));
 v_source:=public.create_loot_source(p_campaign,v_holder,trim(p_name),'first_claim','instant');
 update public.loot_sources set is_active=true where id=v_source;
 return v_source;
end $function$;