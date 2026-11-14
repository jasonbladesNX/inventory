import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('docs/sql/phase13_migration_manifest.sql');
const ui=read('src/CharacterTransfers.tsx');
for(const x of [
 'character_migration_manifests','enable row level security','preview_character_migration',
 'save_character_migration_manifest','source_campaign_id','target_campaign_id',
 'item_definitions','equipment_slots','currency_balances','learned_recipes',
 'app_private.is_gm(t.target_campaign_id)','approved_pending_migration',
 'automatic_populated_migration'
])assert.ok(migration.includes(x),'missing phase13: '+x);
assert.match(ui,/Preview Campaign Resource Mapping/);
assert.match(ui,/Review & Save Mapping/);
assert.match(ui,/Save Unresolved Mapping Draft/);
assert.match(ui,/mappingComplete/);
assert.match(ui,/mappingChoices/);
assert.match(ui,/preview_character_migration/);
assert.match(ui,/save_character_migration_manifest/);
assert.match(ui,/This preview does not transfer items or currency/);
const validation=read('docs/sql/phase13_mapping_validation.sql');
const reviewed=read('docs/sql/phase13_review_validation_guard.sql');
assert.match(validation,/validate_character_migration_manifest/);
assert.match(validation,/missing_count/);
assert.match(validation,/invalid_count/);
assert.match(reviewed,/p_review and not/);
assert.match(reviewed,/Cannot mark migration mapping as reviewed/);
console.log('Phase 13 mapping and review source contracts passed.');
