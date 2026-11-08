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
