import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_combat_board.sql');
const ui=read('src/PartyCombatBoard.tsx');
const player=read('src/PlayerPartyManager.tsx');
const gm=read('src/GmPartyGameplay.tsx');
for(const key of ['get_party_combat_board','zone_initiative_sessions',
 'zone_initiative_entries','active_position','round_number',
 'campaign_party_members','character_zone_assignments',
 'm.user_id=v_actor','m.status=\\'active\\'',
 'Only party members and campaign GMs may view party combat',
 'revoke all on function public.get_party_combat_board',
 'grant execute on function public.get_party_combat_board'])
 assert.ok(sql.includes(key),'Missing party initiative access or projection: '+key);
assert.match(sql,/left join public.zone_initiative_sessions/);
assert.match(ui,/get_party_combat_board/);
assert.match(ui,/Party Combat Board/);
assert.match(ui,/Another participant is acting/);
assert.match(ui,/Acting Now/);
assert.match(ui,/15000/);
assert.match(player,/<PartyCombatBoard key=\{'combat-'/);
assert.match(gm,/<PartyCombatBoard db=\{db\} party=\{party\} character=\{null\}/);
console.log('Phase 15 party combat board source contracts passed.');
