-- Player portal: list only the signed-in user's assigned active characters.
-- The campaign label is included so no separate campaign selection is needed.
create or replace function public.list_my_player_characters()
returns table(character_id uuid,character_name text,campaign_id uuid,campaign_name text)
language sql stable security invoker
set search_path = ''
as $function$
  select c.id,c.name,c.campaign_id,cp.name
  from public.characters c
  join public.campaign_members m
    on m.id=c.member_id
   and m.campaign_id=c.campaign_id
  join public.campaigns cp on cp.id=c.campaign_id
  where m.user_id=(select auth.uid())
    and m.status='active'
    and c.is_active
  order by lower(cp.name),lower(c.name),c.id;
$function$;
revoke all on function public.list_my_player_characters() from public,anon;
grant execute on function public.list_my_player_characters() to authenticated;
