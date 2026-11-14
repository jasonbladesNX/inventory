
create or replace function public.invite_existing_campaign_user(p_campaign uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 if p_email is null or length(trim(p_email))<5 or length(p_email)>254 then
  raise exception 'Valid account email required' using errcode='22023';end if;
 select id into v_user from auth.users where lower(email)=lower(trim(p_email)) limit 1;
 if v_user is null then
  raise exception 'Account not registered. Ask the player to create a Nexus account first.' using errcode='22023';end if;
 return public.manage_campaign_administration(p_campaign,'invite',v_user,null,null,null,'Email invitation');
end $$;
revoke all on function public.invite_existing_campaign_user(uuid,text) from public,anon;
grant execute on function public.invite_existing_campaign_user(uuid,text) to authenticated;
