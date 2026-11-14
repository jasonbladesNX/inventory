
create or replace function public.list_character_bank_activity(p_character uuid,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ch public.characters%rowtype;
begin
 select c.* into ch from public.characters c join public.campaign_members m on m.id=c.member_id
 where c.id=p_character and c.is_active and m.user_id=auth.uid() and m.status='active';
 if auth.uid() is null or ch.id is null then raise exception 'Character not authorized' using errcode='42501';end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'bank_id',recent.bank_id,'actor_character',recent.character_name,
   'action',recent.action,'kind',recent.kind,'item_name',recent.item_name,
   'amount',recent.amount,'occurred_at',recent.occurred_at)
   order by recent.occurred_at desc,recent.event_id desc)
  from (
   select activity.*,cc.name character_name
   from (
    select a.id event_id,a.bank_id,a.character_id,a.action,'item'::text kind,
      a.item_name,a.quantity amount,a.occurred_at from public.campaign_bank_activity a
    union all
    select a.id,a.bank_id,a.character_id,a.action,'currency',
      c.code,a.amount,a.occurred_at
      from public.campaign_bank_currency_activity a join public.currencies c on c.id=a.currency_id
   ) activity
   join public.campaign_banks b on b.id=activity.bank_id
   join public.characters cc on cc.id=activity.character_id
   where b.campaign_id=ch.campaign_id and
     ((b.bank_type='personal' and b.character_id=ch.id) or
      (b.bank_type='party' and exists(select 1 from public.campaign_party_members pm
       where pm.party_id=b.party_id and pm.character_id=ch.id)))
   order by activity.occurred_at desc,activity.event_id desc
   limit greatest(1,least(coalesce(p_limit,40),100))
  ) recent
 ),'[]'::jsonb);
end $$;
revoke all on function public.list_character_bank_activity(uuid,integer) from public,anon;
grant execute on function public.list_character_bank_activity(uuid,integer) to authenticated;
