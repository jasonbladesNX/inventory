create or replace function public.list_campaign_crafting_attributes(p_campaign uuid)
returns table(code text,label text)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if (select auth.uid()) is null or (
 not app_private.is_gm(p_campaign) and not exists(select 1 from public.campaign_members m
 where m.campaign_id=p_campaign and m.user_id=(select auth.uid()) and m.status='active')
 ) then raise exception 'Not authorized' using errcode='42501';end if;
 return query select upper(a.attribute),case upper(a.attribute)
 when 'STR' then 'Strength' when 'DEX' then 'Dexterity'
 when 'CON' then 'Constitution' when 'INT' then 'Intelligence'
 when 'WIS' then 'Wisdom' when 'CHA' then 'Charisma' else upper(a.attribute) end
 from public.campaigns c join public.ruleset_versions rv on rv.id=c.ruleset_version_id
 cross join lateral jsonb_array_elements_text(coalesce(c.ruleset_overrides->'attributes',rv.configuration->'attributes','[]'::jsonb)) a(attribute)
 where c.id=p_campaign and length(a.attribute) between 1 and 32;
end $function$;
revoke all on function public.list_campaign_crafting_attributes(uuid) from public,anon;
grant execute on function public.list_campaign_crafting_attributes(uuid) to authenticated;