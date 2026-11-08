CREATE OR REPLACE FUNCTION public.get_character_combat_state(p_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campaign uuid; v_data jsonb;
begin
 select c.campaign_id,c.sheet_data into v_campaign,v_data from public.characters c
 where c.id=p_character and c.is_active;
 if v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
   select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=v_campaign and c.is_active
   and m.user_id=(select auth.uid()) and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501'; end if;
 return jsonb_build_object(
  'temporary_hp',coalesce((v_data->>'temporary_hp')::integer,0),
  'temporary_hp_duration',v_data->'temporary_hp_duration',
  'conditions',coalesce(v_data->'conditions','[]'::jsonb),
  'effects',coalesce(v_data->'timed_effects','[]'::jsonb),
  'death_saves',coalesce(v_data->'death_saves','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb)
 );
end $function$;

CREATE OR REPLACE FUNCTION public.update_character_combat_state(p_character uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=(select auth.uid()); v_campaign uuid; v_data jsonb;
 v_temp integer; v_amount integer; v_code text; v_duration integer; v_unit text;
 v_conditions jsonb; v_effects jsonb; v_death jsonb; v_roll integer;
 v_success integer; v_failure integer; v_current integer; v_max integer;
 v_next jsonb; v_entry jsonb; v_key text; v_value integer; v_kind text;
 v_temp_time jsonb;
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action not in ('temp_hp','condition_add','condition_remove','effect_add','effect_remove','advance','death_roll','death_reset')
 then raise exception 'Unsupported combat action' using errcode='22023'; end if;
 select c.campaign_id,c.sheet_data into v_campaign,v_data from public.characters c
 where c.id=p_character and c.is_active for update;
 if v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
   select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
   where c.id=p_character and c.campaign_id=v_campaign and c.is_active
   and m.user_id=v_actor and m.status='active'
 )) then raise exception 'Not authorized' using errcode='42501'; end if;
 v_data:=coalesce(v_data,'{}'::jsonb);
 v_conditions:=coalesce(v_data->'conditions','[]'::jsonb);
 v_effects:=coalesce(v_data->'timed_effects','[]'::jsonb);
 v_death:=coalesce(v_data->'death_saves','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb);
 v_temp:=coalesce((v_data->>'temporary_hp')::integer,0);
 if v_temp<0 or v_temp>100000 then raise exception 'Invalid temporary HP' using errcode='22023'; end if;
 v_current:=coalesce((v_data#>>'{hp,current}')::integer,0);
 v_max:=coalesce((v_data#>>'{hp,max}')::integer,0);
 if p_action='temp_hp' then
   if coalesce(p_payload->>'amount','') !~ '^[0-9]{1,6}$' then raise exception 'Enter a whole number of temporary HP' using errcode='22023'; end if;
   v_amount:=(p_payload->>'amount')::integer;
   if v_amount>100000 then raise exception 'Temporary HP exceeds limit' using errcode='22023'; end if;
   -- Standard temporary HP grants do not stack; an explicit clear is permitted.
   if v_amount=0 then
     v_data:=jsonb_set(v_data,'{temporary_hp}','0'::jsonb,true)-'temporary_hp_duration';
   elsif v_amount>=v_temp then
     v_data:=jsonb_set(v_data,'{temporary_hp}',to_jsonb(v_amount),true);
     v_unit:=coalesce(p_payload->>'unit','permanent');
     if v_unit not in ('round','turn','minute','hour','rest','permanent') then
       raise exception 'Invalid temporary HP duration unit' using errcode='22023'; end if;
     if v_unit='permanent' then
       v_data:=v_data-'temporary_hp_duration';
     else
       if coalesce(p_payload->>'duration','') !~ '^[0-9]{1,6}$' then raise exception 'Enter a temporary HP duration' using errcode='22023'; end if;
       v_duration:=(p_payload->>'duration')::integer;
       if v_duration not between 1 and 100000 then raise exception 'Temporary HP duration out of range' using errcode='22023'; end if;
       v_data:=jsonb_set(v_data,'{temporary_hp_duration}',jsonb_build_object('unit',v_unit,'remaining',v_duration),true);
     end if;
   end if;
 elsif p_action in ('condition_add','condition_remove','effect_add','effect_remove') then
   v_code:=lower(trim(coalesce(p_payload->>'code','')));
   if v_code !~ '^[a-z][a-z0-9_ -]{0,59}$' then raise exception 'Enter a condition or effect name' using errcode='22023'; end if;
   v_key:=case when p_action like 'condition_%' then 'conditions' else 'timed_effects' end;
   v_next:=case when v_key='conditions' then v_conditions else v_effects end;
   select coalesce(jsonb_agg(e.value),'[]'::jsonb) into v_next from jsonb_array_elements(v_next) e
    where e.value->>'code'<>v_code;
   if p_action in ('condition_add','effect_add') then
     v_unit:=coalesce(p_payload->>'unit','round');
     if v_unit not in ('round','turn','minute','hour','rest','permanent') then raise exception 'Unsupported duration unit' using errcode='22023'; end if;
     if v_unit='permanent' then v_duration:=null;
     else
       if coalesce(p_payload->>'duration','') !~ '^[0-9]{1,6}$' then raise exception 'Enter duration as a whole number' using errcode='22023'; end if;
       v_duration:=(p_payload->>'duration')::integer;
       if v_duration<1 or v_duration>100000 then raise exception 'Duration out of range' using errcode='22023'; end if;
     end if;
     v_entry:=jsonb_build_object('code',v_code,'unit',v_unit,'remaining',v_duration,'source',coalesce(left(p_payload->>'source',120),'manual'));
     if p_action='effect_add' then
       v_kind:=coalesce(p_payload->>'kind','bonus');
       if v_kind not in ('bonus','other') then raise exception 'Unsupported effect kind' using errcode='22023'; end if;
       if v_kind='bonus' then
         v_code:=upper(v_code);
         if v_code not in ('STR','DEX','CON','INT','WIS','CHA') then raise exception 'Bonus effect must specify an ability score' using errcode='22023'; end if;
         if coalesce(p_payload->>'value','') !~ '^-?[0-9]{1,3}$' then raise exception 'Invalid bonus value' using errcode='22023'; end if;
         v_value:=(p_payload->>'value')::integer;
         if v_value not between -30 and 30 then raise exception 'Effect value outside supported range' using errcode='22023'; end if;
         v_entry:=v_entry||jsonb_build_object('code',lower(v_code),'kind','bonus','value',v_value);
       else v_entry:=v_entry||jsonb_build_object('kind','other'); end if;
     end if;
     v_next:=v_next||jsonb_build_array(v_entry);
   end if;
   v_data:=jsonb_set(v_data,array[v_key],v_next,true);
 elsif p_action='advance' then
   v_unit:=coalesce(p_payload->>'unit','');
   if v_unit not in ('round','turn','minute','hour','rest') then raise exception 'Unsupported advance unit' using errcode='22023'; end if;
   if coalesce(p_payload->>'amount','') !~ '^[0-9]{1,6}$' then raise exception 'Enter an advance amount' using errcode='22023'; end if;
   v_amount:=(p_payload->>'amount')::integer;
   if v_amount not between 1 and 100000 then raise exception 'Advance amount out of range' using errcode='22023'; end if;
   v_temp_time:=v_data->'temporary_hp_duration';
   if v_temp_time is not null and v_temp_time->>'unit'=v_unit and v_temp>0 then
     v_duration:=coalesce((v_temp_time->>'remaining')::integer,0)-v_amount;
     if v_duration<=0 then
       v_data:=(jsonb_set(v_data,'{temporary_hp}','0'::jsonb,true))-'temporary_hp_duration';
     else
       v_data:=jsonb_set(v_data,'{temporary_hp_duration,remaining}',to_jsonb(v_duration),true);
     end if;
   end if;
   for v_key in select unnest(array['conditions','timed_effects']) loop
     v_next:='[]'::jsonb;
     for v_entry in select value from jsonb_array_elements(coalesce(v_data->v_key,'[]'::jsonb)) loop
       if v_entry->>'unit'=v_unit and v_entry->>'remaining' is not null then
         v_duration:=(v_entry->>'remaining')::integer-v_amount;
         if v_duration>0 then v_next:=v_next||jsonb_build_array(jsonb_set(v_entry,'{remaining}',to_jsonb(v_duration),true)); end if;
       else v_next:=v_next||jsonb_build_array(v_entry); end if;
     end loop;
     v_data:=jsonb_set(v_data,array[v_key],v_next,true);
   end loop;
 elsif p_action='death_reset' then
   v_data:=jsonb_set(v_data,'{death_saves}','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb,true);
 elsif p_action='death_roll' then
   if v_max<1 or v_current>0 then raise exception 'Death saves only apply at 0 HP' using errcode='22023'; end if;
   if coalesce((v_death->>'dead')::boolean,false) or coalesce((v_death->>'stable')::boolean,false)
   then raise exception 'Death saves already resolved. Reset them first.' using errcode='22023'; end if;
   if coalesce(p_payload->>'roll','') !~ '^[0-9]{1,2}$' then raise exception 'Enter a d20 roll' using errcode='22023'; end if;
   v_roll:=(p_payload->>'roll')::integer;
   if v_roll not between 1 and 20 then raise exception 'Death save roll must be 1 to 20' using errcode='22023'; end if;
   v_success:=coalesce((v_death->>'successes')::integer,0);
   v_failure:=coalesce((v_death->>'failures')::integer,0);
   if v_roll=20 then
     v_data:=jsonb_set(v_data,'{hp,current}','1'::jsonb,true);
     v_death:='{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb;
   elsif v_roll=1 then v_failure:=least(3,v_failure+2);
   elsif v_roll>=10 then v_success:=least(3,v_success+1);
   else v_failure:=least(3,v_failure+1); end if;
   if v_roll<>20 then
     v_death:=jsonb_build_object('successes',v_success,'failures',v_failure,'stable',v_success>=3,'dead',v_failure>=3);
   end if;
   v_data:=jsonb_set(v_data,'{death_saves}',v_death,true);
 end if;
 update public.characters c set sheet_data=v_data where c.id=p_character;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_combat_action',
 jsonb_build_object('character_id',p_character,'operation',p_action,'quantity',1,
 'payload',coalesce(p_payload,'{}'::jsonb)));
 return public.get_character_combat_state(p_character);
end $function$;

CREATE OR REPLACE FUNCTION public.adjust_character_hit_points(p_character uuid, p_operation text, p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_campaign uuid;
  v_hp jsonb;
  v_current integer;
  v_max integer;
  v_new integer;
  v_applied integer;
  v_temp integer:=0;
  v_absorb integer:=0;
  v_fail integer;
  v_death jsonb;
  v_at_zero_damage boolean:=false;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_operation is null or p_operation not in ('damage','heal')
    or p_amount is null or p_amount<1 or p_amount>100000 then
    raise exception 'Enter a valid HP adjustment between 1 and 100000' using errcode='22023';
  end if;
  select c.campaign_id,c.sheet_data->'hp'
    into v_campaign,v_hp
    from public.characters c
    where c.id=p_character and c.is_active
    for update;
  if v_campaign is null or not (
    app_private.is_gm(v_campaign)
    or exists(
      select 1 from public.characters c
      join public.campaign_members m on m.id=c.member_id
      where c.id=p_character and c.campaign_id=v_campaign and c.is_active
        and m.user_id=v_actor and m.status='active'
    )
  ) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_hp is null or jsonb_typeof(v_hp)<>'object'
    or coalesce(v_hp->>'current','') !~ '^[0-9]+$'
    or coalesce(v_hp->>'max','') !~ '^[0-9]+$'
  then raise exception 'Configure hit points first' using errcode='22023'; end if;
  v_current := (v_hp->>'current')::integer;
  v_max := (v_hp->>'max')::integer;
  if v_max not between 1 and 100000 or v_current<0 or v_current>v_max
  then raise exception 'Character hit points are invalid' using errcode='22023'; end if;
  select coalesce((c.sheet_data->>'temporary_hp')::integer,0) into v_temp from public.characters c where c.id=p_character;
  if v_temp not between 0 and 100000 then raise exception 'Invalid temporary HP' using errcode='22023'; end if;
  if p_operation='damage' then
    v_absorb:=least(v_temp,p_amount);
    v_new := greatest(0,v_current-(p_amount-v_absorb));
    v_applied := v_current-v_new;
  else
    v_new := least(v_max,v_current+p_amount);
    v_applied := v_new-v_current;
  end if;
  v_at_zero_damage:=(p_operation='damage' and v_current=0 and p_amount>v_absorb);
  if v_applied+v_absorb=0 and not v_at_zero_damage then
    raise exception 'No HP change is possible at the current limit' using errcode='22023';
  end if;
  update public.characters c
    set sheet_data=jsonb_set(jsonb_set(c.sheet_data,'{hp,current}',to_jsonb(v_new),true),'{temporary_hp}',to_jsonb(v_temp-v_absorb),true)
    where c.id=p_character;
  if v_temp-v_absorb=0 and v_absorb>0 then update public.characters c set sheet_data=c.sheet_data-'temporary_hp_duration' where c.id=p_character; end if;
  if v_at_zero_damage then
    select coalesce(c.sheet_data->'death_saves','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb) into v_death from public.characters c where c.id=p_character;
    v_fail:=least(3,coalesce((v_death->>'failures')::integer,0)+1);
    v_death:=v_death||jsonb_build_object('failures',v_fail,'stable',false,'dead',v_fail>=3);
    update public.characters c set sheet_data=jsonb_set(c.sheet_data,'{death_saves}',v_death,true) where c.id=p_character;
  end if;
  if p_operation='heal' and v_new>0 then update public.characters c set sheet_data=jsonb_set(c.sheet_data,'{death_saves}','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb,true) where c.id=p_character; end if;
  insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
    values(v_campaign,v_actor,'character_hp_adjusted',
      jsonb_build_object('character_id',p_character,'operation',p_operation,
        'quantity',v_applied+v_absorb,'requested',p_amount,'applied',v_applied+v_absorb,'temp_absorbed',v_absorb,'death_failure',v_at_zero_damage,
        'previous_hp',v_current,'current_hp',v_new,'maximum_hp',v_max));
  return jsonb_build_object('configured',true,'current',v_new,'max',v_max,
    'operation',p_operation,'requested',p_amount,'applied',v_applied+v_absorb,'temp_absorbed',v_absorb,'temporary_hp',v_temp-v_absorb);
end
$function$;
