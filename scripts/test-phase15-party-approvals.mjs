import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_approval_invites.sql');
const updates=read('docs/sql/phase15_party_policy_rpc_updates.sql');
const candidates=read('docs/sql/phase15_party_invite_candidates.sql');
const player=read('src/PlayerPartyManager.tsx');
const gm=read('src/GmSessionPartyManager.tsx');
for(const phrase of [
 'party_membership_requests','join_policy','set_party_join_policy',
 'manage_party_membership_request','list_party_membership_requests',
 'requested_by','can_respond','can_cancel',
 'join','invite','accept','decline','cancel',
 'Party changes locked during game','Only organizer or GM can respond',
 'Only invited player can respond',
 'party_membership_one_pending','enable row level security'
]) assert.ok(sql.includes(phrase),'Missing approval/invitation contract: '+phrase);
assert.match(sql,/revoke all on public.party_membership_requests from public,anon,authenticated/);
assert.match(sql,/p_policy not in\('open','approval'\)/);
assert.match(updates,/This party requires an approved join request/);
assert.match(updates,/join_policy/);
assert.match(candidates,/list_party_invitable_characters/);
assert.match(candidates,/p.created_by=auth.uid\(\) or app_private.is_gm/);
assert.match(player,/Pending Party Invitations & Requests/);
assert.match(player,/Request to Join/);
assert.match(player,/Approve Request/);
assert.match(player,/Accept Invitation/);
assert.match(player,/Send Invitation/);
assert.match(player,/onSubmit=\{e=>\{e.preventDefault\(\);if\(!choice\)return/);
assert.match(gm,/set_party_join_policy/);
assert.match(gm,/Approval required — organizer\/GM reviews requests/);
console.log('Phase 15 party approvals and invitations source contract passed.');
