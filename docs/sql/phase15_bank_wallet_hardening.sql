
create or replace function app_private.block_live_bank_wallets()
returns trigger language plpgsql security definer set search_path='' as $$
declare source_campaign uuid;destination_campaign uuid;v_running boolean;
begin
 if tg_op<>'INSERT' then
  select b.campaign_id into source_campaign from public.wallets w
  join public.campaign_banks b on b.holder_id=w.holder_id where w.id=old.wallet_id;
 end if;
 if tg_op<>'DELETE' then
  select b.campaign_id into destination_campaign from public.wallets w
  join public.campaign_banks b on b.holder_id=w.holder_id where w.id=new.wallet_id;
 end if;
 if source_campaign is not null or destination_campaign is not null then
  select is_running into v_running from public.campaign_session_state
   where campaign_id=coalesce(source_campaign,destination_campaign);
  if coalesce(v_running,false) then
   raise exception 'Bank treasury locked while the game is running' using errcode='42501';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function app_private.block_live_bank_wallet_holder()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_running boolean;v_campaign uuid;
begin
 select b.campaign_id into v_campaign from public.campaign_banks b where b.holder_id=old.holder_id;
 if v_campaign is null and tg_op='UPDATE' then
  select b.campaign_id into v_campaign from public.campaign_banks b where b.holder_id=new.holder_id;
 end if;
 if v_campaign is not null then
  select is_running into v_running from public.campaign_session_state where campaign_id=v_campaign;
  if coalesce(v_running,false) then raise exception 'Bank wallet holder locked during the game' using errcode='42501';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_live_bank_wallet_holder before update or delete on public.wallets
for each row execute function app_private.block_live_bank_wallet_holder();
