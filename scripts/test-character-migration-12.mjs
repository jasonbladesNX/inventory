import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(f)=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const migration=read('docs/sql/phase12_dependency_free_character_migration.sql');
const visibility=read('docs/sql/phase12_finalize_target_gm_visibility.sql');
const alignment=read('docs/sql/phase12_migration_readiness_alignment.sql');
const component=read('src/CharacterTransfers.tsx');
const main=read('src/main.tsx');
for(const fragment of [
 'app_private.character_transfer_blockers','pg_constraint','inventory_dependency',
 'item_instances','wallets','containers','character_reference',
 'get_character_transfer_migration_check','existing_active_character',
 'ruleset_mismatch','approved_pending_migration','finalize_character_campaign_transfer',
 'source_approved_by is null','target_approved_by is null','app_private.is_gm(tr.target_campaign_id)',
 'for update','delete from public.character_zone_assignments',
 'update public.inventory_holders set campaign_id','update public.characters set campaign_id',
 'insert into public.character_zone_assignments','status=\'migrated\'',
 'migrated_by','notify_campaign_user'
]) assert.ok(migration.toLowerCase().includes(fragment.toLowerCase()),'Missing migration gate: '+fragment);
assert.match(visibility,/can_finalize_target/);
assert.match(alignment,/get_character_transfer_migration_check/);
assert.match(component,/get_character_transfer_migration_check/);
assert.match(component,/finalize_character_campaign_transfer/);
assert.match(component,/migrationChecks\[t.id\]\.can_migrate/);
assert.match(component,/t.can_finalize_target/);
assert.match(component,/Finalize Character Transfer/);
assert.match(component,/window.confirm/);
assert.match(main,/<CharacterTransfers db=\{db!\} campaign=\{campaign\}/);
assert.doesNotMatch(migration,/delete from public.item_instances/);
assert.doesNotMatch(migration,/delete from public.wallets/);
console.log('Phase 12 dependency-free character migration source contract passed.');
