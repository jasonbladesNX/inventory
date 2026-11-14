
-- Phase 15: party membership and home-storage banks.
create table public.campaign_session_state(
 campaign_id uuid primary key references public.campaigns(id) on delete cascade,
 is_running boolean not null default false,
 started_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.campaign_session_state enable row level security;
revoke all on public.campaign_session_state from public,anon,authenticated;

create table public.campaign_parties(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(id,campaign_id)
);
create table public.campaign_party_members(
 party_id uuid not null,
 campaign_id uuid not null,
 character_id uuid not null,
 joined_at timestamptz not null default now(),
 primary key(party_id,character_id),
 foreign key(party_id,campaign_id) references public.campaign_parties(id,campaign_id) on delete cascade,
 foreign key(character_id,campaign_id) references public.characters(id,campaign_id) on delete cascade,
 unique(campaign_id,character_id)
);
create table public.campaign_banks(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 bank_type text not null check(bank_type in ('personal','party')),
 character_id uuid references public.characters(id) on delete cascade,
 party_id uuid references public.campaign_parties(id) on delete cascade,
 holder_id uuid not null unique references public.inventory_holders(id),
 created_at timestamptz not null default now(),
 check((bank_type='personal' and character_id is not null and party_id is null)
    or (bank_type='party' and party_id is not null and character_id is null))
);
create unique index campaign_banks_personal on public.campaign_banks(character_id) where bank_type='personal';
create unique index campaign_banks_party on public.campaign_banks(party_id) where bank_type='party';
create table public.campaign_bank_activity(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 bank_id uuid not null references public.campaign_banks(id) on delete cascade,
 character_id uuid not null references public.characters(id),
 actor_user_id uuid not null references auth.users(id),
 action text not null check(action in('deposit','withdraw')),
 item_instance_id uuid not null,
 item_name text not null,
 quantity numeric not null check(quantity>0),
 occurred_at timestamptz not null default now()
);
create index bank_activity_time on public.campaign_bank_activity(bank_id,occurred_at desc);
alter table public.campaign_parties enable row level security;
alter table public.campaign_party_members enable row level security;
alter table public.campaign_banks enable row level security;
alter table public.campaign_bank_activity enable row level security;
revoke all on public.campaign_parties,public.campaign_party_members,public.campaign_banks,public.campaign_bank_activity from public,anon,authenticated;

create or replace function public.manage_campaign_session(p_campaign uuid,p_running boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old boolean;
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(p_campaign) on conflict do nothing;
 select is_running into old from public.campaign_session_state where campaign_id=p_campaign for update;
 update public.campaign_session_state set is_running=p_running,
   started_at=case when p_running then now() else started_at end,
   updated_at=now(),updated_by=auth.uid() where campaign_id=p_campaign;
 return jsonb_build_object('is_running',p_running,'changed',old is distinct from p_running);
end $$;

create or replace function public.manage_campaign_party(
 p_campaign uuid,p_action text,p_party uuid default null,p_name text default null,p_character uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_party uuid; holder uuid; bank_id uuid;
begin
 if auth.uid() is null or not app_private.is_gm(p_campaign) then raise exception 'GM access required' using errcode='42501';end if;
 if p_action='create' then
  insert into public.campaign_parties(campaign_id,name,created_by)
   values(p_campaign,trim(p_name),auth.uid()) returning id into v_party;
  insert into public.inventory_holders(campaign_id,holder_type,name)
   values(p_campaign,'party',trim(p_name)||' Bank') returning id into holder;
  insert into public.campaign_banks(campaign_id,bank_type,party_id,holder_id)
   values(p_campaign,'party',v_party,holder) returning id into bank_id;
  return jsonb_build_object('id',v_party,'bank_id',bank_id);
 end if;
 select id into v_party from public.campaign_parties where id=p_party and campaign_id=p_campaign for update;
 if v_party is null then raise exception 'Party not found' using errcode='22023';end if;
 if p_action='add_member' then
  if not exists(select 1 from public.characters c join public.campaign_members m on m.id=c.member_id
    where c.id=p_character and c.campaign_id=p_campaign and c.is_active and m.status='active') then
   raise exception 'Active character required' using errcode='22023';end if;
  insert into public.campaign_party_members(party_id,campaign_id,character_id) values(v_party,p_campaign,p_character);
 elsif p_action='remove_member' then
  delete from public.campaign_party_members where party_id=v_party and campaign_id=p_campaign and character_id=p_character;
 elsif p_action='rename' then
  if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Invalid party name';end if;
  update public.campaign_parties set name=trim(p_name) where id=v_party;
 else raise exception 'Invalid party operation';end if;
 return jsonb_build_object('id',v_party,'ok',true);
end $$;

create or replace function public.list_character_banks(p_character uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ch public.characters%rowtype;actor uuid:=auth.uid(); h uuid;v_bank uuid;
begin
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=actor and m.status='active';
 if actor is null or ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select id into v_bank from public.campaign_banks where character_id=ch.id and bank_type='personal';
 if v_bank is null then
  insert into public.inventory_holders(campaign_id,holder_type,name)
    values(ch.campaign_id,'gm',ch.name||' — Home Bank') returning id into h;
  insert into public.campaign_banks(campaign_id,bank_type,character_id,holder_id)
    values(ch.campaign_id,'personal',ch.id,h) returning id into v_bank;
 end if;
 return jsonb_build_object(
  'is_running',coalesce((select is_running from public.campaign_session_state where campaign_id=ch.campaign_id),false),
  'banks',coalesce((select jsonb_agg(jsonb_build_object(
   'id',b.id,'type',b.bank_type,'name',case when b.bank_type='personal' then 'Personal Bank' else p.name||' Party Bank' end,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',case when i.identified then coalesce(i.custom_name,d.name) else 'Unidentified Item' end,
      'quantity',i.quantity,'category',d.category,'identified',i.identified) order by d.name,i.id)
    from public.item_instances i join public.item_definitions d on d.id=i.definition_id where i.holder_id=b.holder_id),'[]'::jsonb))
   order by b.bank_type,b.created_at)
   from public.campaign_banks b left join public.campaign_parties p on p.id=b.party_id
   where b.campaign_id=ch.campaign_id and
    ((b.bank_type='personal' and b.character_id=ch.id) or
     (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
      where pm.party_id=b.party_id and pm.character_id=ch.id)))),'[]'::jsonb)
 );
end $$;

create or replace function public.manage_bank_item(
 p_character uuid,p_bank uuid,p_item uuid,p_action text,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ch public.characters%rowtype;b public.campaign_banks%rowtype;
 i public.item_instances%rowtype; source_holder uuid; destination_holder uuid;
 v_id uuid;v_name text;session_running boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
  where c.id=p_character and m.user_id=auth.uid() and m.status='active' and c.is_active;
 if ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 insert into public.campaign_session_state(campaign_id) values(ch.campaign_id) on conflict do nothing;
 select is_running into session_running from public.campaign_session_state where campaign_id=ch.campaign_id for update;
 if session_running then raise exception 'Banks are locked while the GM session is running' using errcode='42501';end if;
 select * into b from public.campaign_banks where id=p_bank and campaign_id=ch.campaign_id;
 if b.id is null or not ((b.bank_type='personal' and b.character_id=ch.id)
 or (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
  where pm.party_id=b.party_id and pm.character_id=ch.id)))
 then raise exception 'Bank access denied' using errcode='42501';end if;
 if p_action not in ('deposit','withdraw') or p_quantity is null or p_quantity<=0 or p_quantity>1000000
 then raise exception 'Invalid bank transfer' using errcode='22023';end if;
 select h.id into source_holder from public.inventory_holders h
 where h.character_id=ch.id and h.campaign_id=ch.campaign_id and h.holder_type='character';
 if source_holder is null then raise exception 'Character inventory unavailable';end if;
 select * into i from public.item_instances where id=p_item for update;
 if i.id is null or i.campaign_id<>ch.campaign_id then raise exception 'Item unavailable';end if;
 if p_action='deposit' then
  if i.holder_id<>source_holder then raise exception 'Item is not carried by this character' using errcode='42501';end if;
  destination_holder:=b.holder_id;
 else
  if i.holder_id<>b.holder_id then raise exception 'Item is not stored in this bank' using errcode='42501';end if;
  destination_holder:=source_holder;
 end if;
 if i.quantity<p_quantity or i.container_id is not null or
  exists(select 1 from public.equipment_assignments ea where ea.item_instance_id=i.id) or
  exists(select 1 from public.containers co where co.id=i.id) or
  exists(select 1 from public.item_definitions d where d.id=i.definition_id and d.category='container') or
  exists(select 1 from public.trade_offers t where t.status in('proposed','countered','accepted')
    and position(i.id::text in t.offer::text)>0)
 then raise exception 'Item is equipped, nested, a container, reserved in an active trade, or has insufficient quantity' using errcode='22023';end if;
 select coalesce(i.custom_name,d.name) into v_name from public.item_definitions d where d.id=i.definition_id;
 if i.quantity=p_quantity then
  update public.item_instances set holder_id=destination_holder where id=i.id;
  v_id:=i.id;
 else
  update public.item_instances set quantity=quantity-p_quantity where id=i.id;
  insert into public.item_instances(campaign_id,definition_id,holder_id,container_id,quantity,
    condition_code,identified,custom_name,properties,private_properties,version)
  values(i.campaign_id,i.definition_id,destination_holder,null,p_quantity,
   i.condition_code,i.identified,i.custom_name,i.properties,i.private_properties,i.version)
  returning id into v_id;
 end if;
 insert into public.campaign_bank_activity(campaign_id,bank_id,character_id,actor_user_id,action,item_instance_id,item_name,quantity)
 values(ch.campaign_id,b.id,ch.id,auth.uid(),p_action,v_id,v_name,p_quantity);
 return jsonb_build_object('ok',true,'item_id',v_id,'quantity',p_quantity,'action',p_action);
end $$;

-- Independent defense: even privileged paths must not manipulate bank-held stock during games.
create or replace function app_private.block_live_bank_items()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_bank uuid;new_bank uuid;v_running boolean;
begin
 if tg_op<>'INSERT' then select id into old_bank from public.campaign_banks where holder_id=old.holder_id;end if;
 if tg_op<>'DELETE' then select id into new_bank from public.campaign_banks where holder_id=new.holder_id;end if;
 if old_bank is not null or new_bank is not null then
  select is_running into v_running from public.campaign_session_state
   where campaign_id=coalesce(new.campaign_id,old.campaign_id);
  if coalesce(v_running,false) then
   raise exception 'Banked items cannot be changed while a game is running' using errcode='42501';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_live_bank_inventory before insert or update or delete on public.item_instances
 for each row execute function app_private.block_live_bank_items();

revoke all on function public.manage_campaign_session(uuid,boolean),public.manage_campaign_party(uuid,text,uuid,text,uuid),
 public.list_character_banks(uuid),public.manage_bank_item(uuid,uuid,uuid,text,numeric) from public,anon;
grant execute on function public.manage_campaign_session(uuid,boolean),public.manage_campaign_party(uuid,text,uuid,text,uuid),
 public.list_character_banks(uuid),public.manage_bank_item(uuid,uuid,uuid,text,numeric) to authenticated;
