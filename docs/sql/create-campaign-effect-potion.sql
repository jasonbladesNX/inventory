-- GM-configured effect consumables for milestone 7.2.
create or replace function public.create_campaign_effect_potion(
 p_campaign uuid,p_name text,p_effect_type text,p_code text default null,
 p_amount integer default null,p_duration integer default null,p_unit text default 'round'
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_effect jsonb; v_id uuid; v_code text;
begin
 if (select auth.uid()) is null or not app_private.is_gm(p_campaign) then
   raise exception 'GM permission required' using errcode='42501';
 end if;
 if p_name is null or length(trim(p_name)) not between 3 and 120 or p_name !~* 'potion' then
   raise exception 'Enter a potion name containing the word Potion' using errcode='22023';
 end if;
 if p_effect_type not in ('temp_hp','remove_condition','add_condition','ability_bonus') then
   raise exception 'Unsupported consumable effect' using errcode='22023';
 end if;
 v_code:=lower(trim(coalesce(p_code,'')));
 if p_effect_type='temp_hp' then
   if p_amount is null or p_amount not between 1 and 100000 then
     raise exception 'Temporary HP must be from 1 to 100000' using errcode='22023'; end if;
   v_effect:=jsonb_build_object('type',p_effect_type,'amount',p_amount);
 else
   if v_code !~ '^[a-z][a-z0-9_ -]{0,59}$' then
     raise exception 'Invalid condition or attribute code' using errcode='22023'; end if;
   if p_effect_type='ability_bonus' and v_code not in ('str','dex','con','int','wis','cha') then
     raise exception 'Choose a supported ability' using errcode='22023'; end if;
   v_effect:=jsonb_build_object('type',p_effect_type,'code',v_code);
   if p_effect_type='ability_bonus' then
     if p_amount is null or p_amount not between -30 and 30 then
       raise exception 'Ability bonus must be -30 to 30' using errcode='22023'; end if;
     v_effect:=v_effect||jsonb_build_object('value',p_amount);
   end if;
   if p_effect_type in ('add_condition','ability_bonus') then
     if p_unit not in ('round','turn','minute','hour','rest','permanent') then
       raise exception 'Unsupported effect duration unit' using errcode='22023'; end if;
     if p_unit<>'permanent' and (p_duration is null or p_duration not between 1 and 100000) then
       raise exception 'Duration must be between 1 and 100000' using errcode='22023'; end if;
     v_effect:=v_effect||jsonb_build_object('unit',p_unit,'duration',case when p_unit='permanent' then null else p_duration end);
   end if;
 end if;
 insert into public.item_definitions(campaign_id,name,description,category,default_properties)
 values(p_campaign,trim(p_name),'GM-configured effect potion','consumable',
   jsonb_build_object('consumable',true,'stackable',true,'use_effect',v_effect))
 returning id into v_id;
 return v_id;
end $function$;
revoke all on function public.create_campaign_effect_potion(uuid,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.create_campaign_effect_potion(uuid,text,text,text,integer,integer,text) to authenticated;
