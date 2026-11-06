import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync('src/main.tsx','utf8');
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
assert.match(app,/Request Character Transfer/);
assert.match(app,/Coming soon from the landing screen/);
assert.match(styles,/\.nx-app-playing \.mv-tabs\{position:fixed/);
assert.match(styles,/env\(safe-area-inset-bottom\)/);
assert.match(app,/id="nx-grant-recipient"/);
assert.match(app,/value=\{grantCharacter\}/);
assert.match(app,/p_character:recipient.id/);
assert.match(app,/if\(!recipient\)throw Error\('Choose a recipient character/);
assert.doesNotMatch(app,/window\.prompt\(/);
console.log('PASS separate landing/player/GM/setup/play routes, role gating, iPhone fixed navigation, in-page GM controls');
