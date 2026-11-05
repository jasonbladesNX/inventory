-- M6.6 — ruleset-configured character ability list and D&D 5e score writer.
-- Score editor updates six attributes and creature size atomically; no inventing unset scores.
-- Non-D&D rulesets expose configured attributes read-only until validated editors are implemented.

CREATE OR REPLACE FUNCTION public.list_character_attributes(p_character uuid)
 RETURNS TABLE(attribute_code text, attribute_label text, score integer, modifier integer, is_editable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;v_system text;v_attrs jsonb;
begin
 select c.campaign_id,gs.code,coalesce(cp.ruleset_overrides->'attributes',rv.configuration->'attributes','[]'::jsonb)
 into v_campaign,v_system,v_attrs
 from public.characters c
 join public.campaigns cp on cp.id=c.campaign_id
 join public.ruleset_versions rv on rv.id=cp.ruleset_version_id
 join public.game_systems gs on gs.id=rv.system_id
 where c.id=p_character and c.is_active;
 if v_campaign is null or not (
  app_private.is_gm(v_campaign) or exists(
   select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=v_campaign and c.is_active
    and m.user_id=(select auth.uid()) and m.status='active'
  )
 ) then raise exception 'Not authorized' using errcode='42501';end if;
 if jsonb_typeof(v_attrs)<>'array' then raise exception 'Invalid ruleset attributes configuration';end if;
 return query with codes as (
   select upper(x.code) code,x.ordinality
   from jsonb_array_elements_text(v_attrs) with ordinality x(code,ordinality)
   where length(x.code) between 1 and 32
 ), scores as (
 select codes.code,codes.ordinality,
  case when a.value #>> '{}' ~ '^[0-9]{1,2}$'
       and (a.value #>> '{}')::integer between 1 and 30 then (a.value #>> '{}')::integer
       else null::integer end as base_score
 from codes left join public.character_attributes a
 on a.character_id=p_character and upper(a.attribute_code)=codes.code
 )
 select sc.code,
 case sc.code when 'STR' then 'Strength' when 'DEX' then 'Dexterity'
 when 'CON' then 'Constitution' when 'INT' then 'Intelligence'
 when 'WIS' then 'Wisdom' when 'CHA' then 'Charisma' else sc.code end,
 sc.base_score,
 case when v_system='dnd5e' and sc.base_score is not null then floor((sc.base_score-10)::numeric/2)::integer else null::integer end,
 (v_system='dnd5e' and sc.code=any(array['STR','DEX','CON','INT','WIS','CHA']))
 from scores sc order by sc.ordinality;
end $function$
;
CREATE OR REPLACE FUNCTION public.save_character_ability_scores(p_character uuid, p_scores jsonb, p_size text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid;v_system text;v_attrs jsonb;v_size text;v_key text;v_value text;v_count integer;
begin
 select c.campaign_id,gs.code,coalesce(cp.ruleset_overrides->'attributes',rv.configuration->'attributes','[]'::jsonb)
 into v_campaign,v_system,v_attrs
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
  )
 ) then raise exception 'Not authorized' using errcode='42501';end if;
 if v_system<>'dnd5e' then raise exception 'Attribute editing is not configured for this ruleset';end if;
 if jsonb_typeof(v_attrs)<>'array' then raise exception 'Invalid ruleset attributes configuration';end if;
 if p_scores is null or jsonb_typeof(p_scores)<>'object' then raise exception 'Scores must be an object';end if;
 select count(*) into v_count from jsonb_object_keys(p_scores);
 if v_count<>6 then raise exception 'Provide all six D&D ability scores';end if;
 for v_key,v_value in select key,value #>> '{}' from jsonb_each(p_scores) loop
  if not (v_key=any(array['STR','DEX','CON','INT','WIS','CHA'])) then
    raise exception 'Unsupported ability score %',v_key;end if;
  if not exists(select 1 from jsonb_array_elements_text(v_attrs) a(code) where upper(a.code)=v_key) then
    raise exception 'Ability % is not part of this ruleset',v_key;end if;
  if v_value is null or v_value !~ '^[0-9]{1,2}$' or v_value::integer not between 1 and 30 then
    raise exception 'Ability scores must be between 1 and 30';end if;
 end loop;
 v_size:=lower(trim(coalesce(p_size,'')));
 if v_size not in ('tiny','small','medium','large','huge','gargantuan') then
 raise exception 'Choose a valid creature size';end if;
 insert into public.character_attributes(character_id,attribute_code,value)
 select p_character,key,to_jsonb((value #>> '{}')::integer)
 from jsonb_each(p_scores)
 on conflict(character_id,attribute_code) do update set value=excluded.value;
 update public.characters set sheet_data=jsonb_set(coalesce(sheet_data,'{}'::jsonb),'{size}',to_jsonb(initcap(v_size)),true)
 where id=p_character;
end $function$
;

revoke all on function public.list_character_attributes(uuid) from public,anon;
revoke all on function public.save_character_ability_scores(uuid,jsonb,text) from public,anon;
grant execute on function public.list_character_attributes(uuid) to authenticated;
grant execute on function public.save_character_ability_scores(uuid,jsonb,text) to authenticated;
