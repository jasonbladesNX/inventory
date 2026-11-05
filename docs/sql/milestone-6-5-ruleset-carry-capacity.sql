-- Nexus Multiverse M6.5: D&D5e size-sensitive carry capacity and explicit Strength/size profile.
-- Non-D&D ruleset calculations remain unconfigured, with a neutral no-capacity response.
-- Changes to equipment, inventory trading, and container capacities are not enforced by this preview.

CREATE OR REPLACE FUNCTION public.get_character_carry_capacity(p_character uuid)
 RETURNS TABLE(ruleset_code text, capacity_mode text, strength integer, creature_size text, capacity_lb numeric, drag_lift_push_lb numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid; v_system text; v_mode text; v_strength integer; v_size text; v_raw text; v_factor numeric;
begin
 select c.campaign_id,gs.code,coalesce(cp.ruleset_overrides->>'capacity_mode',rv.configuration->>'capacity_mode','optional'),
 c.sheet_data->>'size'
 into v_campaign,v_system,v_mode,v_size
 from public.characters c
 join public.campaigns cp on cp.id=c.campaign_id
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 join public.game_systems gs on gs.id=rv.system_id
 where c.id=p_character and c.is_active;
 if v_campaign is null or not(
 app_private.is_gm(v_campaign) or exists(
 select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.campaign_id=v_campaign and c.is_active
 and m.user_id=(select auth.uid()) and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501';end if;
 select a.value #>> '{}' into v_raw from public.character_attributes a
 where a.character_id=p_character and upper(a.attribute_code)='STR' limit 1;
 if v_raw ~ '^[0-9]{1,2}$' and v_raw::int between 1 and 30 then v_strength:=v_raw::int;end if;
 if v_system='dnd5e' and v_mode='weight' then
  v_factor:=case lower(v_size) when 'tiny' then 7.5 when 'small' then 15
    when 'medium' then 15 when 'large' then 30 when 'huge' then 60
    when 'gargantuan' then 120 else null end;
 else v_factor:=null;end if;
 return query select v_system,v_mode,v_strength,v_size,
   case when v_strength is not null and v_factor is not null then v_strength*v_factor else null::numeric end,
   case when v_strength is not null and v_factor is not null then v_strength*v_factor*2 else null::numeric end;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_character_carry_profile(p_character uuid, p_strength integer, p_size text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;v_system text;v_mode text;v_size text;
begin
 select c.campaign_id,gs.code,coalesce(cp.ruleset_overrides->>'capacity_mode',rv.configuration->>'capacity_mode','optional')
 into v_campaign,v_system,v_mode
 from public.characters c
 join public.campaigns cp on cp.id=c.campaign_id
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 join public.game_systems gs on gs.id=rv.system_id
 where c.id=p_character and c.is_active for update of c;
 if v_campaign is null or not(
 app_private.is_gm(v_campaign) or exists(
 select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.campaign_id=v_campaign and c.is_active
 and m.user_id=(select auth.uid()) and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501';end if;
 if v_system<>'dnd5e' or v_mode<>'weight' then
 raise exception 'Carrying profile editing is not configured for this ruleset';end if;
 if p_strength is null or p_strength<1 or p_strength>30 then
 raise exception 'Strength must be between 1 and 30';end if;
 v_size:=lower(trim(coalesce(p_size,'')));
 if v_size not in ('tiny','small','medium','large','huge','gargantuan') then
 raise exception 'Choose a valid creature size';end if;
 insert into public.character_attributes(character_id,attribute_code,value)
 values(p_character,'STR',to_jsonb(p_strength))
 on conflict(character_id,attribute_code) do update set value=excluded.value;
 update public.characters c set sheet_data=jsonb_set(coalesce(c.sheet_data,'{}'::jsonb),'{size}',to_jsonb(initcap(v_size)),true)
 where c.id=p_character;
end $function$
;

revoke all on function public.get_character_carry_capacity(uuid) from public,anon;
revoke all on function public.set_character_carry_profile(uuid,integer,text) from public,anon;
grant execute on function public.get_character_carry_capacity(uuid) to authenticated;
grant execute on function public.set_character_carry_profile(uuid,integer,text) to authenticated;
