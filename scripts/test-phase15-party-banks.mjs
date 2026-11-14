import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_banks.sql');
const safe=read('docs/sql/phase15_bank_equipment_guard.sql');
const hardening=read('docs/sql/phase15_bank_effect_container_guard.sql');
const wallet=read('docs/sql/phase15_bank_treasury.sql');
const main=read('src/main.tsx');
const bank=read('src/BankPanel.tsx');
const treasury=read('src/BankTreasury.tsx');
const gm=read('src/GmSessionPartyManager.tsx');
const history=read('docs/sql/phase15_bank_activity.sql');
for(const x of ['campaign_session_state','campaign_parties','campaign_party_members','campaign_banks',
 'campaign_bank_activity','enable row level security','manage_campaign_session','manage_campaign_party',
 'list_character_banks','manage_bank_item','block_live_bank_items','guard_live_bank_inventory',
 'is_running','session_running','character_id=ch.id','auth.uid()','deposit','withdraw'])
 assert.ok(sql.includes(x),'missing phase15: '+x);
assert.match(sql,/where campaign_id=ch.campaign_id for update/);
assert.match(sql,/Banks are locked while the GM session is running/);
assert.match(sql,/bank_type='personal'/);
assert.match(sql,/bank_type='party'/);
assert.match(safe,/guard_bank_equipment/);
assert.match(hardening,/item_effects/);
assert.match(hardening,/source_item_id/);
assert.match(wallet,/manage_bank_currency/);
assert.match(wallet,/guard_live_bank_currency/);
assert.match(wallet,/Bank treasury locked during the game/);
assert.match(history,/list_character_bank_activity/);
assert.match(bank,/Home & Party Banks/);
assert.match(bank,/Banks locked — game in progress/);
assert.match(bank,/BankTreasury/);
assert.match(treasury,/Bank Treasury/);
assert.match(gm,/Start Game/);
assert.match(gm,/End Game/);
assert.match(main,/<BankPanel/);
assert.match(main,/<GmSessionPartyManager/);
assert.match(main,/<FeatureErrorBoundary/);
console.log('Phase 15 party and bank access/lock source contracts passed.');
