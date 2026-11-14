import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_loot_requests.sql');
const ui=read('src/PartyLootRequests.tsx');
const player=read('src/PlayerPartyManager.tsx');
const gm=read('src/GmPartyGameplay.tsx');
for(const key of [
 'party_loot_requests','enable row level security','one_pending','list_party_loot_requests',
 'manage_party_loot_request','Only the owning party character can request loot',
 'Only current party leader or GM can review loot requests',
 'Party loot requests are locked during active gameplay',
 'item.quantity is distinct from req.expected_quantity',
 'campaign_bank_activity','equipment_assignments','item_effects',
 'trade_offers','distributed_item_id','grant execute on function public.manage_party_loot_request'
])assert.ok(sql.includes(key),'Missing loot request contract: '+key);
assert.match(ui,/Request Loot/);
assert.match(ui,/Approve & Transfer/);
assert.match(ui,/Decline/);
assert.match(ui,/Cancel/);
assert.match(ui,/list_party_loot_requests/);
assert.match(ui,/manage_party_loot_request/);
assert.match(ui,/window.confirm/);
assert.match(ui,/can_review/);
assert.match(ui,/is_running/);
assert.match(player,/<PartyLootRequests key=\{'loot-'/);
assert.match(gm,/<PartyLootRequests db=\{db\}/);
console.log('Phase 15 party loot requests source contract passed.');
