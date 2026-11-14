import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
const load=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const schema=load('docs/sql/phase15_party_leadership.sql');
const access=load('docs/sql/phase15_party_leadership_authorization.sql');
const fix=load('docs/sql/phase15_party_leadership_auth_correction.sql');
const ui=load('src/PlayerPartyManager.tsx');
for(const required of [
 'leader_character_id','maintain_party_leader','transfer_party_leadership',
 'p_target_character','leader_character_id=new.character_id',
 'Transfer party leadership to another member before the leader leaves',
 'Only the current party leader may transfer leadership',
 'Leadership changes are locked during an active game',
 'campaign_admin_party_leadership_transfer',
 'update public.campaign_parties set leader_character_id=p_target_character'])
 assert.ok(schema.includes(required),'Missing party leadership contract: '+required);
assert.match(schema,/ranked/);
assert.match(access,/'leader_character_id',p.leader_character_id/);
assert.match(access,/'is_leader'/);
assert.match(access,/list_party_invitable_characters/);
assert.match(access,/list_party_membership_requests/);
assert.match(fix,/creator:=app_private.is_gm\(party.campaign_id\) or party.leader_character_id/);
assert.match(fix,/organizer:=party.leader_character_id/);
assert.match(ui,/Transfer Party Leadership/);
assert.match(ui,/transfer_party_leadership/);
assert.match(ui,/You are now a regular party member/);
assert.match(ui,/setConfigOpen\(false\)/);
assert.match(ui,/ownParty.is_organizer/);
assert.match(ui,/m.is_leader/);
assert.match(ui,/window.confirm\('Transfer party leadership/);
const pending=load('docs/sql/phase15_party_leadership_pending_request_guard.sql');
assert.match(pending,/request_row.request_type='join' and request_row.requested_by=actor/);
assert.match(pending,/leader_character_id/);
assert.match(pending,/can_cancel/);
console.log('Phase 15 party leader transfer source checks passed.');
