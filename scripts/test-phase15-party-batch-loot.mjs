import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_batch_loot.sql');
const ui=read('src/GmPartyLootBatch.tsx');
const gm=read('src/GmPartyGameplay.tsx');
for(const requirement of [
 'batch_distribute_party_bank_loot','p_allocations jsonb','p_apply boolean default false',
 'jsonb_array_length','v_count>25','is_running','app_private.is_gm',
 'for update','expected_quantity','v_total>v_actual',
 'Party loot cannot be distributed during a running game',
 'distribute_party_bank_loot','revoke all on function public.batch_distribute_party_bank_loot'
])assert.ok(sql.includes(requirement),'Missing batch distribution safety contract: '+requirement);
assert.match(sql,/if p_apply then/);
assert.match(sql,/jsonb_agg|jsonb_build_array/);
assert.match(ui,/Add Allocation/);
assert.match(ui,/Preview All/);
assert.match(ui,/Confirm & Distribute All/);
assert.match(ui,/window.confirm/);
assert.match(ui,/onApplied/);
assert.match(ui,/previewKey!==key/);
assert.match(ui,/overAllocated/);
assert.match(gm,/<GmPartyLootBatch/);
assert.match(gm,/get_party_gameplay_summary/);
console.log('Phase 15 batch party loot distribution source contracts passed.');
