import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('docs/sql/phase14_campaign_admin.sql');
const email=read('docs/sql/phase14_email_invitations.sql');
const main=read('src/main.tsx');
const ui=read('src/GmCampaignAdministration.tsx');
for(const x of ['list_campaign_administration','manage_campaign_administration',
 'respond_to_campaign_invitation','list_my_campaign_invitations',
 'campaign_admin_','audit_events','app_private.is_gm',
 'reassign_character','promote','demote','remove','reinstate','invited'])
 assert.ok(sql.includes(x),'missing phase14: '+x);
assert.match(sql,/Only owner promotes active members/);
assert.match(sql,/Reassign or deactivate active characters/);
assert.match(email,/invite_existing_campaign_user/);
assert.match(email,/auth.users/);
assert.match(ui,/type="email"/);
assert.match(ui,/GmCampaignAdministration/);
assert.match(main,/Campaign Invitations/);
assert.match(main,/Join Campaign/);
assert.match(main,/respond_to_campaign_invitation/);
const lifecycle=read('docs/sql/phase14_campaign_lifecycle.sql');
const archiveFilter=read('docs/sql/phase14_hide_archived_player_campaigns.sql');
const settings=read('docs/sql/phase14_campaign_settings.sql');
const settingsUi=read('src/GmCampaignSettings.tsx');
for(const part of ['manage_campaign_lifecycle','campaign_archive_snapshots','archived','restore','audit_events'])
 assert.ok(lifecycle.includes(part),'missing archive feature: '+part);
assert.match(archiveFilter,/cp.status='active'/);
assert.match(settings,/update_campaign_admin_settings/);
assert.match(settings,/campaign_admin_settings/);
assert.match(settingsUi,/allow_trades/);
assert.match(main,/<GmCampaignSettings/);
console.log('Phase 14 GM administration and invitation source contracts passed.');
