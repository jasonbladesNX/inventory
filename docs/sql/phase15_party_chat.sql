
-- Phase 15: party-only discussion, distinct from campaign-wide messaging.
create table if not exists public.campaign_party_messages(
 id uuid primary key default gen_random_uuid(),
 party_id uuid not null references public.campaign_parties(id) on delete cascade,
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 sender_user_id uuid not null references auth.users(id),
 sender_character_id uuid references public.characters(id),
 message_body text not null check(length(btrim(message_body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists campaign_party_messages_recent
 on public.campaign_party_messages(party_id,created_at desc,id desc);
alter table public.campaign_party_messages enable row level security;
revoke all on public.campaign_party_messages from public,anon,authenticated;

create or replace function public.list_party_messages(
 p_party uuid,p_character uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_party public.campaign_parties%rowtype;actor uuid:=auth.uid();authorized boolean;
begin
 select * into v_party from public.campaign_parties where id=p_party;
 if actor is null or v_party.id is null then raise exception 'Party unavailable' using errcode='42501';end if;
 authorized:=app_private.is_gm(v_party.campaign_id) or exists(
  select 1 from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=v_party.id and pm.character_id=p_character and m.user_id=actor
 );
 if not authorized then raise exception 'Party messages are restricted to members and GMs' using errcode='42501';end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',recent.id,'sender',coalesce(recent.character_name,recent.display_name,'Game Master'),
   'is_gm',recent.is_gm,'is_mine',recent.sender_user_id=actor,
   'body',recent.message_body,'created_at',recent.created_at)
   order by recent.created_at, recent.id)
  from (
   select msg.*, c.name character_name,pr.display_name,
    (msg.sender_character_id is null) is_gm
   from public.campaign_party_messages msg
   left join public.characters c on c.id=msg.sender_character_id
   left join public.profiles pr on pr.id=msg.sender_user_id
   where msg.party_id=v_party.id
   order by msg.created_at desc,msg.id desc
   limit greatest(1,least(coalesce(p_limit,50),100))
  ) recent
 ),'[]'::jsonb);
end $$;
revoke all on function public.list_party_messages(uuid,uuid,integer) from public,anon;
grant execute on function public.list_party_messages(uuid,uuid,integer) to authenticated;

create or replace function public.send_party_message(
 p_party uuid,p_character uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_party public.campaign_parties%rowtype;actor uuid:=auth.uid();
v_sender uuid;v_message uuid;v_gm boolean;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into v_party from public.campaign_parties where id=p_party;
 if v_party.id is null then raise exception 'Party unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.campaigns c where c.id=v_party.campaign_id and c.status='active') then
  raise exception 'Campaign inactive' using errcode='22023';end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
  raise exception 'Message length must be 1 to 2000 characters' using errcode='22023';end if;
 v_gm:=app_private.is_gm(v_party.campaign_id);
 if p_character is not null then
  select c.id into v_sender from public.campaign_party_members pm
  join public.characters c on c.id=pm.character_id and c.is_active
  join public.campaign_members m on m.id=c.member_id and m.status='active'
  where pm.party_id=v_party.id and c.id=p_character and m.user_id=actor;
 end if;
 if v_sender is null and not (v_gm and p_character is null) then
  raise exception 'Only active party members or campaign GMs may send party messages' using errcode='42501';
 end if;
 insert into public.campaign_party_messages(party_id,campaign_id,sender_user_id,sender_character_id,message_body)
 values(v_party.id,v_party.campaign_id,actor,v_sender,btrim(p_body)) returning id into v_message;
 return jsonb_build_object('id',v_message,'ok',true);
end $$;
revoke all on function public.send_party_message(uuid,uuid,text) from public,anon;
grant execute on function public.send_party_message(uuid,uuid,text) to authenticated;
