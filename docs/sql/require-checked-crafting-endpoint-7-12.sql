-- The Phase 1 endpoint may be invoked only internally by the security-definer
-- checked crafting wrapper; clients must not bypass configured checks.
revoke execute on function public.craft_character_recipe(uuid,uuid,integer) from authenticated;
revoke all on function public.craft_character_recipe(uuid,uuid,integer) from public,anon;