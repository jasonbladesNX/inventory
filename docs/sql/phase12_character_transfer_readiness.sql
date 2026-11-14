
create or replace function public.get_character_transfer_readiness(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.character_transfer_requests%rowtype; actor uuid:=auth.uid();
 sc record;tc record; v_holder uuid; v_inventory bigint;v_equipped bigint;v_wallets bigint;
 v_jobs bigint;v_trades bigint;v_attributes bigint;v_recipes bigint;v_initiative bigint;
begin
 select * into t from public.character_transfer_requests where id=p_request;
 if actor is null or t.id is null or not (t.requested_by=actor
 or app_private.is_gm(t.source_campaign_id) or app_private.is_gm(t.target_campaign_id)) then
 raise exception 'Not authorized' using errcode='42501';end if;
 select ruleset_version_id into sc from public.campaigns where id=t.source_campaign_id;
 select ruleset_version_id into tc from public.campaigns where id=t.target_campaign_id;
 select id into v_holder from public.inventory_holders where character_id=t.character_id and campaign_id=t.source_campaign_id limit 1;
 select count(*) into v_inventory from public.item_instances where holder_id in
 (select id from public.inventory_holders where character_id=t.character_id and campaign_id=t.source_campaign_id);
 select count(*) into v_equipped from public.equipment_assignments where character_id=t.character_id;
 select count(*) into v_wallets from public.wallets where holder_id in
 (select id from public.inventory_holders where character_id=t.character_id and campaign_id=t.source_campaign_id);
 select count(*) into v_jobs from public.character_crafting_jobs where character_id=t.character_id;
 select count(*) into v_trades from public.trade_offers where proposer_character_id=t.character_id or recipient_character_id=t.character_id;
 select count(*) into v_attributes from public.character_attributes where character_id=t.character_id;
 select count(*) into v_recipes from public.character_learned_crafting_recipes where character_id=t.character_id;
 select count(*) into v_initiative from public.zone_initiative_entries where character_id=t.character_id;
 return jsonb_build_object(
 'request_id',t.id,'status',t.status,'ruleset_match',sc.ruleset_version_id is not distinct from tc.ruleset_version_id,
 'dependencies',jsonb_build_object('item_instances',v_inventory,'equipment_assignments',v_equipped,
  'wallets',v_wallets,'crafting_jobs',v_jobs,'trade_offers',v_trades,
  'character_attributes',v_attributes,'learned_recipes',v_recipes,'initiative_entries',v_initiative),
 'migration_available',false,
 'guidance','Cross-campaign transfer requires a reviewed, atomic conversion of character-owned inventory, currency, crafting, zone and ruleset references. Approval does not transfer these records.'
 );
end $$;
revoke all on function public.get_character_transfer_readiness(uuid) from public,anon;
grant execute on function public.get_character_transfer_readiness(uuid) to authenticated;
