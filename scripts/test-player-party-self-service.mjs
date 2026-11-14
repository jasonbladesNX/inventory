import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_player_party_self_service.sql');
const ui=read('src/PlayerPartyManager.tsx');
const main=read('src/main.tsx');
const css=read('src/player-party.css');
for(const part of ['list_player_party_options','manage_player_party',
 'p_action','create','join','leave','auth.uid()','campaign_party_members',
 'campaign_banks','campaign_session_state','for update',
 'Party membership is locked while the GM game is running',
 'campaign_admin_party_self_','character_id=p_character'])
 assert.ok(sql.includes(part),'Missing party security flow: '+part);
assert.match(sql,/Leave your current party before/);
assert.match(sql,/m.user_id=v_actor and m.status='active'/);
assert.match(sql,/create or replace function public.manage_player_party/);
assert.match(ui,/Create a Party/);
assert.match(ui,/Join a Party/);
assert.match(ui,/Leave Party/);
assert.match(ui,/current_party_id/);
assert.match(ui,/list_player_party_options/);
assert.match(ui,/manage_player_party/);
assert.match(ui,/state.is_running/);
assert.match(ui,/window.confirm/);
assert.match(main,/<PlayerPartyManager/);
assert.match(main,/<FeatureErrorBoundary key=\{'party-player-/);
assert.match(main,/Manage \{person.character_name\}'s Party/);
assert.match(css,/nx-player-parties/);
console.log('Player party self-service source contracts passed.');
