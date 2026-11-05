-- Milestone 6.7: read-only additive derived attribute projection.
-- Reuses authorized list_character_attributes and list_character_effects.
-- This does not write character_attributes or change equipment effects.
-- Set/flag/conditional/stacking operations remain outside this additive preview.

CREATE OR REPLACE FUNCTION public.list_character_derived_attributes(p_character uuid)
 RETURNS TABLE(attribute_code text, attribute_label text, base_score integer, equipment_bonus numeric, effective_score numeric, effective_modifier integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with attrs as (
 select a.attribute_code,a.attribute_label,a.score from public.list_character_attributes(p_character) a
), additions as (
 select upper(e.attribute_code) code, sum(e.total_bonus)::numeric bonus
 from public.list_character_effects(p_character) e
 group by upper(e.attribute_code)
)
select a.attribute_code,a.attribute_label,a.score,
 coalesce(ad.bonus,0)::numeric,
 case when a.score is null then null::numeric else a.score::numeric+coalesce(ad.bonus,0) end,
 case when a.score is null then null::integer else floor((a.score::numeric+coalesce(ad.bonus,0)-10)/2)::integer end
from attrs a left join additions ad on ad.code=upper(a.attribute_code);
$function$
;
revoke all on function public.list_character_derived_attributes(uuid) from public,anon;
grant execute on function public.list_character_derived_attributes(uuid) to authenticated;
