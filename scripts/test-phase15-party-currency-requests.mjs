import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_currency_requests.sql');
const ui=read('src/PartyCurrencyRequests.tsx');
const player=read('src/PlayerPartyManager.tsx');
const gm=read('src/GmPartyGameplay.tsx');
const bank=read('docs/sql/phase15_party_bank_withdrawal_policy.sql');
for(const phrase of [
 'party_currency_requests','enable row level security',
 'revoke all on public.party_currency_requests',
 'party_currency_request_pending_unique',
 'list_party_currency_requests','manage_party_currency_request',
 'Only your own active party character can request currency',
 'Only current leader or campaign GM may approve currency',
 'Currency requests locked during an active game',
 'app_private.move_wallet_amount',
 'campaign_bank_currency_activity',
 'p_amount<>round(p_amount,v_precision)',
 'Only requester may cancel',
 'Recipient is no longer a party member',
 'Pending request unavailable'
])assert.ok(sql.includes(phrase),'Missing currency request contract: '+phrase);
assert.match(bank,/p_action='withdraw' and b.bank_type='party'/);
for(const phrase of ['Request Currency','Approve & Transfer','Decline','Cancel',
 'manage_party_currency_request','list_party_currency_requests','can_review','is_running'])
 assert.ok(ui.includes(phrase),'Missing currency UI: '+phrase);
assert.match(player,/<PartyCurrencyRequests key=\{'money-'/);
assert.match(gm,/<PartyCurrencyRequests db=\{db\} party=\{party\} character=\{null\}/);
console.log('Phase 15 currency request source contracts passed.');
