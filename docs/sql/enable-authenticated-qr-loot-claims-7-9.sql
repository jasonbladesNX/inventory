revoke all on function public.claim_loot_qr(text,uuid) from public,anon;
grant execute on function public.claim_loot_qr(text,uuid) to authenticated;