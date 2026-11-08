-- Milestone 7.6: character rest actions and manually configured hit dice.
-- Rest effects advance rest-scoped timers. Hours are only advanced when explicitly requested.
create or replace function public.get_character_rest_state(p_character uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_campaign uuid; v_data jsonb; v_dice jsonb;
begin
 select c.campaign_id,c.sheet_data into v_campaign,v_data from public.characters c where c.id=p_character and c.is_active;
 if v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
 select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.campaign_id=v_campaign and c.is_active
 and m.user_id=(select auth.uid()) and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 v_dice:=coalesce(v_data->'hit_dice','{"max":0,"remaining":0,"sides":8}'::jsonb);
 return jsonb_build_object('hit_dice',v_dice,'hp',v_data->'hp','last_rest',v_data->'last_rest');
end $function$;

create or replace function public.configure_character_hit_dice(
 p_character uuid,p_max integer,p_remaining integer,p_sides integer
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_data jsonb;v_old jsonb;
begin
 select c.campaign_id,c.sheet_data into v_campaign,v_data from public.characters c where c.id=p_character and c.is_active for update;
 if v_actor is null or v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
 select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.campaign_id=v_campaign and c.is_active and m.user_id=v_actor and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 if p_max is null or p_remaining is null or p_sides is null or p_max not between 0 and 100
 or p_remaining<0 or p_remaining>p_max or p_sides not in (4,6,8,10,12,20) then
 raise exception 'Hit dice must have 0–100 maximum, remaining within maximum, and a valid die size' using errcode='22023';end if;
 v_old:=v_data->'hit_dice';
 update public.characters c set sheet_data=jsonb_set(coalesce(c.sheet_data,'{}'::jsonb),'{hit_dice}',
 jsonb_build_object('max',p_max,'remaining',p_remaining,'sides',p_sides),true) where c.id=p_character;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_rest_action',jsonb_build_object('character_id',p_character,'operation','configure_hit_dice','previous',v_old,'max',p_max,'remaining',p_remaining,'sides',p_sides));
 return public.get_character_rest_state(p_character);
end $function$;

create or replace function public.take_character_rest(
 p_character uuid,p_kind text,p_hit_dice integer default 0,p_advance_hours integer default 0
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_actor uuid:=(select auth.uid());v_campaign uuid;v_data jsonb;
 v_dice jsonb;v_max_dice integer;v_remaining integer;v_sides integer;v_con integer:=0;
 v_hp jsonb;v_current integer;v_max integer;v_new integer;v_roll integer:=0;v_recovered integer:=0;
 v_i integer;v_entry jsonb;v_items jsonb;v_list jsonb;v_key text;v_new_remaining integer;
 v_temp_duration jsonb;v_temp integer;v_recover_dice integer;v_rest_type text;
begin
 if p_kind not in ('short','long') then raise exception 'Choose short or long rest' using errcode='22023';end if;
 if p_hit_dice is null or p_hit_dice not between 0 and 100 or p_advance_hours is null or p_advance_hours not between 0 and 24
 then raise exception 'Invalid rest parameters' using errcode='22023';end if;
 if p_kind='long' and p_hit_dice<>0 then raise exception 'Long rests do not spend hit dice' using errcode='22023';end if;
 select c.campaign_id,c.sheet_data into v_campaign,v_data from public.characters c where c.id=p_character and c.is_active for update;
 if v_actor is null or v_campaign is null or not (app_private.is_gm(v_campaign) or exists(
 select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.campaign_id=v_campaign and c.is_active and m.user_id=v_actor and m.status='active'))
 then raise exception 'Not authorized' using errcode='42501';end if;
 v_data:=coalesce(v_data,'{}'::jsonb);
 v_hp:=v_data->'hp';
 if v_hp is null or coalesce(v_hp->>'current','') !~ '^[0-9]+$' or coalesce(v_hp->>'max','') !~ '^[0-9]+$'
 then raise exception 'Configure hit points before taking a rest' using errcode='22023';end if;
 v_current:=(v_hp->>'current')::integer;v_max:=(v_hp->>'max')::integer;
 if v_max not between 1 and 100000 or v_current not between 0 and v_max then raise exception 'Invalid character hit points' using errcode='22023';end if;
 if v_current=0 then raise exception 'A character at 0 HP must recover before taking a rest' using errcode='22023';end if;
 v_dice:=coalesce(v_data->'hit_dice','{"max":0,"remaining":0,"sides":8}'::jsonb);
 v_max_dice:=coalesce((v_dice->>'max')::integer,0);
 v_remaining:=coalesce((v_dice->>'remaining')::integer,0);
 v_sides:=coalesce((v_dice->>'sides')::integer,8);
 if v_max_dice not between 0 and 100 or v_remaining not between 0 and v_max_dice or v_sides not in (4,6,8,10,12,20)
 then raise exception 'Configure valid character hit dice' using errcode='22023';end if;
 if p_hit_dice>v_remaining then raise exception 'Not enough hit dice remaining' using errcode='22023';end if;
 v_new:=v_current;
 if p_kind='short' then
   -- Effective CON modifier is derived from current attributes and equipment.
   select coalesce(a.effective_modifier,0) into v_con from public.list_character_derived_attributes(p_character) a where a.attribute_code='CON';
   v_con:=coalesce(v_con,0);
   for v_i in 1..p_hit_dice loop v_roll:=v_roll+floor(random()*v_sides+1)::integer;end loop;
   v_recovered:=greatest(0,v_roll+p_hit_dice*v_con);
   v_new:=least(v_max,v_current+v_recovered);
   v_remaining:=v_remaining-p_hit_dice;
 else
   v_new:=v_max;
   -- 5e-style default: regain at least 1 and up to half the total hit dice.
   v_recover_dice:=case when v_max_dice=0 then 0 else greatest(1,floor(v_max_dice/2.0)::integer) end;
   v_remaining:=least(v_max_dice,v_remaining+v_recover_dice);
 end if;
 v_data:=jsonb_set(v_data,'{hp,current}',to_jsonb(v_new),true);
 v_data:=jsonb_set(v_data,'{hit_dice}',jsonb_build_object('max',v_max_dice,'remaining',v_remaining,'sides',v_sides),true);
 -- A rest advances rest-scoped effects once; hours only when explicitly supplied.
 foreach v_key in array array['conditions','timed_effects'] loop
   v_list:='[]'::jsonb;
   for v_entry in select value from jsonb_array_elements(coalesce(v_data->v_key,'[]'::jsonb)) loop
     if v_entry->>'unit'='rest' or (v_entry->>'unit'='hour' and p_advance_hours>0) then
       v_new_remaining:=coalesce((v_entry->>'remaining')::integer,0)-
         case when v_entry->>'unit'='rest' then 1 else p_advance_hours end;
       if v_new_remaining>0 then v_list:=v_list||jsonb_build_array(jsonb_set(v_entry,'{remaining}',to_jsonb(v_new_remaining),true));end if;
     else v_list:=v_list||jsonb_build_array(v_entry);end if;
   end loop;
   v_data:=jsonb_set(v_data,array[v_key],v_list,true);
 end loop;
 v_temp_duration:=v_data->'temporary_hp_duration';
 v_temp:=coalesce((v_data->>'temporary_hp')::integer,0);
 if v_temp>0 and v_temp_duration is not null and
    ((v_temp_duration->>'unit'='rest') or (v_temp_duration->>'unit'='hour' and p_advance_hours>0)) then
   v_new_remaining:=coalesce((v_temp_duration->>'remaining')::integer,0)-
     case when v_temp_duration->>'unit'='rest' then 1 else p_advance_hours end;
   if v_new_remaining<=0 then v_data:=jsonb_set(v_data,'{temporary_hp}','0'::jsonb,true)-'temporary_hp_duration';
   else v_data:=jsonb_set(v_data,'{temporary_hp_duration,remaining}',to_jsonb(v_new_remaining),true);end if;
 end if;
 if v_new>0 then v_data:=jsonb_set(v_data,'{death_saves}','{"successes":0,"failures":0,"stable":false,"dead":false}'::jsonb,true);end if;
 v_data:=jsonb_set(v_data,'{last_rest}',jsonb_build_object('type',p_kind,'at',clock_timestamp(),'hp_recovered',v_new-v_current,'hit_dice_spent',p_hit_dice,'hit_dice_remaining',v_remaining,'hours_advanced',p_advance_hours),true);
 update public.characters c set sheet_data=v_data where c.id=p_character;
 insert into public.inventory_transactions(campaign_id,actor_user_id,kind,details)
 values(v_campaign,v_actor,'character_rest_action',jsonb_build_object('character_id',p_character,'operation',p_kind||'_rest',
 'quantity',1,'hp_before',v_current,'hp_after',v_new,'hp_recovered',v_new-v_current,
 'hit_dice_spent',p_hit_dice,'hit_dice_remaining',v_remaining,'roll_total',v_roll,'con_modifier',v_con,
 'hours_advanced',p_advance_hours));
 return jsonb_build_object('rest',public.get_character_rest_state(p_character),'combat',public.get_character_combat_state(p_character),
 'hp_recovered',v_new-v_current,'rolled',v_roll,'con_modifier',v_con);
end $function$;
revoke all on function public.get_character_rest_state(uuid) from public,anon;
revoke all on function public.configure_character_hit_dice(uuid,integer,integer,integer) from public,anon;
revoke all on function public.take_character_rest(uuid,text,integer,integer) from public,anon;
grant execute on function public.get_character_rest_state(uuid) to authenticated;
grant execute on function public.configure_character_hit_dice(uuid,integer,integer,integer) to authenticated;
grant execute on function public.take_character_rest(uuid,text,integer,integer) to authenticated;
