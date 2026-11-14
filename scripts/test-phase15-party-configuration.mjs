import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('docs/sql/phase15_party_configuration.sql');
const ui=read('src/PlayerPartyManager.tsx');
const css=read('src/player-party.css');
for(const fragment of [
 'configure_party','remove_party_member',
 'party.created_by=actor','app_private.is_gm',
 'campaign_party_members','for update',
 'Party configuration is locked during an active game',
 'Cannot remove members during an active game',
 'Party name must have 1 to 100 characters',
 'campaign_banks','inventory_holders',
 'campaign_admin_party_configure',
 'campaign_admin_party_remove_member',
 'revoke all on function public.configure_party',
 'revoke all on function public.remove_party_member'])
 assert.ok(sql.includes(fragment),'Missing configuration contract: '+fragment);
for(const fragment of ['Configure Party','Party Settings','Party Name','Join Policy','Save Party Settings',
 'Manage Members','configure_party','remove_party_member','ownParty.is_organizer','state.is_running'])
 assert.ok(ui.includes(fragment),'Missing player party settings UI: '+fragment);
assert.match(ui,/m.character_id!==character/);
assert.match(css,/nx-party-settings/);
console.log('Phase 15 organizer party configuration source contract passed.');
