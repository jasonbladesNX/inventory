import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('src/main.tsx','utf8');
const css=readFileSync('src/app-pages.css','utf8');
const sql=readFileSync('docs/sql/list-my-player-characters.sql','utf8');
for(const [rule,label] of [
 [/type=\{showPassword\?'text':'password'\}/,'password visibility toggled'],
 [/aria-label=\{showPassword\?'Hide password':'Show password'\}/,'accessible password toggle'],
 [/type="button" className="nx-password-toggle"/,'toggle cannot submit login'],
 [/onClick=\{\(\)=>setShowPassword\(v=>!v\)\}/,'toggle is reversible'],
 [/db.rpc\('list_my_player_characters'\)/,'player list fetched for account'],
 [/playerCharacters.map\(person=>/,'character cards displayed'],
 [/\{person.campaign_name\}/,'campaign name shown for each character'],
 [/openPlayerCharacter\(person\)/,'one-click character selection'],
 [/await loadCampaign\(selected.campaign_id\)/,'campaign context loaded'],
 [/await loadChar\(selected.campaign_id,selected.character_id\)/,'chosen character loaded'],
 [/setChar\(selected.character_id\)/,'active character selected'],
 [/navigate\('play'\)/,'play page opened']
])assert.match(ui,rule,label);
assert.match(sql,/m.user_id=\(select auth.uid\(\)\)/,'scoped account membership');
assert.match(sql,/m.status='active'/,'active membership required');
assert.match(sql,/c.is_active/,'inactive characters excluded');
assert.match(sql,/m.campaign_id=c.campaign_id/,'membership and character campaign match');
assert.match(sql,/security invoker/,'use RLS under invoking account');
assert.match(sql,/revoke all on function public.list_my_player_characters\(\) from public,anon/,'anonymous access denied');
assert.match(css,/nx-player-character-card/,'card styles exist');
assert.match(css,/nx-password-toggle/,'password toggle styles exist');
assert.match(ui,/gmCampaignIds\.includes\(c\.id\)/,'GM campaign selection remains via filtered campaign cards');
assert.match(ui,/\{characterSelect\}/,'GM character selector remains');
assert.doesNotMatch(ui,/nx-player-character-avatar/,'player character icon removed');
assert.doesNotMatch(ui,/nx-player-character-open/,'Open label and icon removed');
assert.match(ui,/<strong>\{person.character_name\}<\/strong>/,'character name retained');
assert.match(ui,/<span>\{person.campaign_name\}<\/span>/,'campaign shown beneath character');
console.log('PASS player account character list and reversible password visibility UI contracts');
