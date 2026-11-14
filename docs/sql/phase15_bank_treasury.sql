
-- Phase 15.3: campaign currency treasury for personal and party bank storage.
create table public.campaign_bank_currency_activity(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 bank_id uuid not null references public.campaign_banks(id) on delete cascade,
 character_id uuid not null references public.characters(id),
 actor_user_id uuid not null references auth.users(id),
 action text not null check(action in('deposit','withdraw')),
 currency_id uuid not null references public.currencies(id),
 amount numeric not null check(amount>0),
 occurred_at timestamptz not null default now()
);
alter table public.campaign_bank_currency_activity enable row level security;
revoke all on public.campaign_bank_currency_activity from public,anon,authenticated;
create index bank_currency_history on public.campaign_bank_currency_activity(bank_id,occurred_at desc);

create or replace function app_private.block_live_bank_wallets()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_wallet uuid;v_campaign uuid;v_running boolean;
begin
 v_wallet:=case when tg_op='DELETE' then old.wallet_id else new.wallet_id end;
 select b.campaign_id into v_campaign
 from public.wallets w join public.campaign_banks b on b.holder_id=w.holder_id
 where w.id=v_wallet;
 if v_campaign is not null then
  select is_running into v_running from public.campaign_session_state where campaign_id=v_campaign;
  if coalesce(v_running,false) then
   raise exception 'Bank treasury is locked while the game is running' using errcode='42501';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_live_bank_currency before insert or update or delete on public.wallet_balances
 for each row execute function app_private.block_live_bank_wallets();

create or replace function public.list_bank_treasury(p_character uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ch public.characters%rowtype;
begin
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=auth.uid() and m.status='active';
 if auth.uid() is null or ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 return jsonb_build_object(
 'carried',coalesce((select jsonb_agg(jsonb_build_object('currency_id',c.id,'code',c.code,'name',c.name,
 'precision',c.precision_digits,'amount',v.amount) order by c.code)
 from public.wallet_balances v join public.currencies c on c.id=v.currency_id
 join public.wallets w on w.id=v.wallet_id join public.inventory_holders h on h.id=w.holder_id
 where h.character_id=ch.id and h.campaign_id=ch.campaign_id),'[]'::jsonb),
 'banks',coalesce((select jsonb_agg(jsonb_build_object('bank_id',b.id,
  'currency',coalesce((select jsonb_agg(jsonb_build_object('currency_id',c.id,'code',c.code,'name',c.name,
   'precision',c.precision_digits,'amount',v.amount) order by c.code)
   from public.wallet_balances v join public.currencies c on c.id=v.currency_id
   join public.wallets w on w.id=v.wallet_id where w.holder_id=b.holder_id),'[]'::jsonb)
  ) order by b.id)
  from public.campaign_banks b where b.campaign_id=ch.campaign_id
   and (b.bank_type='personal' and b.character_id=ch.id or
    b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
       where pm.party_id=b.party_id and pm.character_id=ch.id))),'[]'::jsonb));
end $$;
revoke all on function public.list_bank_treasury(uuid) from public,anon;
grant execute on function public.list_bank_treasury(uuid) to authenticated;

create or replace function public.manage_bank_currency(
 p_character uuid,p_bank uuid,p_currency uuid,p_action text,p_amount numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ch public.characters%rowtype;b public.campaign_banks%rowtype;
 carried_holder uuid;currency_precision int;source_wallet uuid;dest_wallet uuid;
 bank_wallet uuid;player_wallet uuid;running boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=auth.uid() and m.status='active';
 if ch.id is null then raise exception 'Character unavailable' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select is_running into running from public.campaign_session_state where campaign_id=ch.campaign_id for update;
 if running then raise exception 'Bank treasury locked during the game' using errcode='42501';end if;
 select * into b from public.campaign_banks where id=p_bank and campaign_id=ch.campaign_id;
 if b.id is null or not ((b.bank_type='personal' and b.character_id=ch.id) or
 (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm where pm.party_id=b.party_id and pm.character_id=ch.id)))
 then raise exception 'Bank access denied' using errcode='42501';end if;
 select precision_digits into currency_precision from public.currencies where id=p_currency and campaign_id=ch.campaign_id;
 if currency_precision is null or p_action not in('deposit','withdraw') or p_amount is null
 or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,currency_precision)
 then raise exception 'Invalid currency amount' using errcode='22023';end if;
 select id into carried_holder from public.inventory_holders
 where campaign_id=ch.campaign_id and character_id=ch.id and holder_type='character' limit 1;
 if carried_holder is null then raise exception 'Character inventory unavailable';end if;
 insert into public.wallets(campaign_id,holder_id) values(ch.campaign_id,carried_holder)
  on conflict(campaign_id,holder_id) do update set holder_id=excluded.holder_id returning id into player_wallet;
 insert into public.wallets(campaign_id,holder_id) values(ch.campaign_id,b.holder_id)
  on conflict(campaign_id,holder_id) do update set holder_id=excluded.holder_id returning id into bank_wallet;
 if p_action='deposit' then source_wallet:=player_wallet;dest_wallet:=bank_wallet;
 else source_wallet:=bank_wallet;dest_wallet:=player_wallet;end if;
 perform app_private.move_wallet_amount(source_wallet,dest_wallet,p_currency,p_amount);
 insert into public.campaign_bank_currency_activity(campaign_id,bank_id,character_id,actor_user_id,action,currency_id,amount)
 values(ch.campaign_id,b.id,ch.id,auth.uid(),p_action,p_currency,p_amount);
 return jsonb_build_object('ok',true,'action',p_action,'amount',p_amount,'currency_id',p_currency);
end $$;
revoke all on function public.manage_bank_currency(uuid,uuid,uuid,text,numeric) from public,anon;
grant execute on function public.manage_bank_currency(uuid,uuid,uuid,text,numeric) to authenticated;
