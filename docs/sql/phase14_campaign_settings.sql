
create or replace function public.get_campaign_admin_settings(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.campaigns%rowtype;
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 select * into v from public.campaigns where id=p_campaign;
 if v.id is null then raise exception 'Campaign not found';end if;
 return jsonb_build_object('status',v.status,'name',v.name,
  'settings',jsonb_build_object(
   'allow_trades',coalesce((v.settings->>'allow_trades')::boolean,false),
   'allow_shops',coalesce((v.settings->>'allow_shops')::boolean,false),
   'approval_required',coalesce((v.settings->>'approval_required')::boolean,false),
   'enforce_capacity',coalesce((v.settings->>'enforce_capacity')::boolean,false)));
end $$;
revoke all on function public.get_campaign_admin_settings(uuid) from public,anon;
grant execute on function public.get_campaign_admin_settings(uuid) to authenticated;

create or replace function public.update_campaign_admin_settings(p_campaign uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.campaigns%rowtype;actor uuid:=auth.uid();v_settings jsonb;k text;v jsonb;
begin
 if actor is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 if jsonb_typeof(p_changes)<>'object' or jsonb_object_length(p_changes)=0 or length(p_changes::text)>1000
 then raise exception 'Invalid changes' using errcode='22023';end if;
 select * into existing from public.campaigns where id=p_campaign for update;
 if existing.id is null or existing.status<>'active' then raise exception 'Campaign is not active' using errcode='22023';end if;
 v_settings:=existing.settings;
 for k,v in select key,value from jsonb_each(p_changes) loop
  if k not in ('allow_trades','allow_shops','approval_required','enforce_capacity')
   or jsonb_typeof(v)<>'boolean' then raise exception 'Unsupported campaign setting: %',k using errcode='22023';end if;
  v_settings:=jsonb_set(v_settings,array[k],v,true);
 end loop;
 update public.campaigns set settings=v_settings where id=p_campaign;
 insert into public.audit_events(campaign_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,reason)
 values(p_campaign,actor,'campaign_admin_settings','campaign',p_campaign,
 existing.settings,v_settings,'Campaign settings updated');
 return jsonb_build_object('ok',true,'settings',v_settings);
end $$;
revoke all on function public.update_campaign_admin_settings(uuid,jsonb) from public,anon;
grant execute on function public.update_campaign_admin_settings(uuid,jsonb) to authenticated;
