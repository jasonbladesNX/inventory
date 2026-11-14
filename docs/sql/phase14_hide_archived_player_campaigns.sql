CREATE OR REPLACE FUNCTION public.list_my_player_characters()
 RETURNS TABLE(character_id uuid, character_name text, campaign_id uuid, campaign_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select c.id,c.name,c.campaign_id,cp.name
  from public.characters c
  join public.campaign_members m
    on m.id=c.member_id
   and m.campaign_id=c.campaign_id
  join public.campaigns cp on cp.id=c.campaign_id
  where m.user_id=(select auth.uid())
    and m.status='active'
    and c.is_active
    and cp.status='active'
  order by lower(cp.name),lower(c.name),c.id;
$function$
;
