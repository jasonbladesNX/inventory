import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_bank_withdrawal_policy.sql');
const gm=read('src/GmSessionPartyManager.tsx');
const bank=read('src/BankPanel.tsx');
const currency=read('src/BankTreasury.tsx');
const requests=read('src/PartyLootRequests.tsx');
for(const key of [
 "bank_withdrawal_policy","default 'direct'","set_party_bank_withdrawal_policy",
 "app_private.is_gm","Cannot change withdrawal policy during a game",
 "p_action='withdraw' and b.bank_type='party'",
 "Party bank withdrawals require leader or GM approval",
 "list_character_banks","list_campaign_parties","list_party_loot_requests",
 "manage_bank_item","manage_bank_currency",
 "grant execute on function public.set_party_bank_withdrawal_policy"
])assert.ok(sql.includes(key),'Missing withdrawal-policy backend contract: '+key);
assert.equal((sql.match(/p_action='withdraw' and b.bank_type='party'/g)||[]).length,2,
 'Item and currency withdrawal RPCs must both be gated');
assert.match(gm,/set_party_bank_withdrawal_policy/);
assert.match(gm,/Party bank withdrawal policy/);
assert.match(bank,/withdrawal_policy==='approval'/);
assert.match(currency,/withdrawal_policy==='approval'/);
assert.match(requests,/direct party-bank withdrawals are disabled/);
console.log('Phase 15 party-bank withdrawal policy source checks passed.');
