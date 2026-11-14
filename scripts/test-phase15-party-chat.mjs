import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_chat.sql');
const ui=read('src/PartyChat.tsx');
const player=read('src/PlayerPartyManager.tsx');
const gm=read('src/GmPartyGameplay.tsx');
for(const text of [
 'campaign_party_messages','enable row level security',
 'revoke all on public.campaign_party_messages',
 'list_party_messages','send_party_message','app_private.is_gm',
 'campaign_party_members','m.user_id=actor',"m.status='active'",
 'sender_character_id','p_character','btrim(p_body)',
 'Message length must be 1 to 2000 characters',
 'Party messages are restricted to members and GMs',
 'Only active party members or campaign GMs may send party messages'
])assert.ok(sql.includes(text),'Missing party chat server contract: '+text);
assert.match(ui,/list_party_messages/);
assert.match(ui,/send_party_message/);
assert.match(ui,/15000/);
assert.match(ui,/maxLength=\{2000\}/);
assert.match(ui,/role="log"/);
assert.match(ui,/role="alert"/);
assert.match(ui,/Party Messages/);
assert.match(player,/<PartyChat key=\{ownParty.id/);
assert.match(gm,/<PartyChat db=\{db\} party=\{party\} character=\{null\}/);
console.log('Phase 15 party chat source contract passed.');
