import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync('src/main.tsx','utf8');
const grant=readFileSync('src/GmBulkGrantItems.tsx','utf8');
const styles=readFileSync('src/app-pages.css','utf8');
for(const route of ["landing","player","gm","create","play"]){
  assert.match(app,new RegExp("page==='"+route+"'"),"missing "+route+" page");
}
assert.match(app,/campaign&&gmAccess&&!campaignBusy&&/);
assert.match(app,/<EffectEditorBoundary campaign=\{campaign\}>/);
assert.match(app,/page==='gm'\?/);
assert.match(app,/page==='play'&&campaign&&char/);
assert.match(app,/list_trade_recipients/);
assert.match(app,/list_character_inventory_for_trade/);
assert.match(app,/<CharacterTransfers db=\{db!\} characters=\{playerCharacters\}\/>/,'player transfer UI stays in Player Portal');
const transfers=readFileSync('src/CharacterTransfers.tsx','utf8');
assert.match(transfers,/Request Character Transfer/,'transfer request action stays available');
assert.match(app,/Coming soon from the landing screen/);
assert.match(styles,/\.nx-app-playing \.mv-tabs\{position:fixed/);
assert.match(styles,/env\(safe-area-inset-bottom\)/);
assert.match(app,/<GmBulkGrantItems db=\{db!\}/,'GM dashboard renders grant controls');
assert.match(grant,/id="nx-grant-recipient"/,'grant recipient remains a labeled select');
assert.match(grant,/value=\{recipient\}/,'recipient choice remains controlled');
assert.match(grant,/p_character:recipient,p_items:payload/,'grant targets selected character with item payload');
assert.match(grant,/if\(!character\)\{setError\('Select a recipient character/,'character required before grant');
assert.doesNotMatch(app,/window\.prompt\(/);
console.log('PASS separate landing/player/GM/setup/play routes, role gating, iPhone fixed navigation, in-page GM controls');
