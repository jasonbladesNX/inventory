import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('docs/sql/phase11_messaging_notifications_core.sql');
const triggers=read('docs/sql/phase11_gameplay_notification_triggers.sql');
const dualRoleFix=read('docs/sql/phase11_dual_role_announcement_notification_fix.sql');
const ui=read('src/CampaignComms.tsx');
const main=read('src/main.tsx');
const char=read('src/CharacterScreen.tsx');
for(const name of ['campaign_messages','campaign_message_recipients','campaign_notification_settings','member_notification_preferences','notification_inbox','notification_device_tokens']){
 assert.ok(sql.includes('create table public.'+name),'missing '+name);
 assert.ok(sql.includes('alter table public.'+name+' enable row level security'),'RLS missing '+name);
}
for(const fn of ['send_campaign_message','list_campaign_messages','list_campaign_message_targets','manage_campaign_notifications','get_campaign_notification_state','register_notification_device']){
 assert.ok(sql.includes('function public.'+fn),'missing RPC '+fn);
}
assert.match(sql,/notification_owner_read/);
assert.match(sql,/user_id=\(select auth\.uid\(\)\)/);
assert.match(sql,/alter publication supabase_realtime add table public\.notification_inbox/);
assert.match(sql,/app_private\.is_gm\(p_campaign\)/);
assert.match(sql,/Players may message only campaign GMs/);
assert.match(sql,/Direct messaging disabled/);
assert.match(sql,/char_length\(btrim\(p_body\)\) not between 1 and 4000/);
assert.match(sql,/join public\.campaign_message_recipients r on r\.message_id=m\.id and r\.user_id=auth\.uid\(\)/);
assert.match(sql,/unique\(user_id,source_key\)/);
assert.match(sql,/p_provider not in \('apns','fcm'\)/);
for(const name of ['notify_initiative_event','notify_trade_change','notify_approval_change'])assert.ok(triggers.includes('function app_private.'+name));
assert.match(triggers,/create trigger phase11_initiative_notifications/);
assert.match(triggers,/create trigger phase11_trade_notifications/);
assert.match(triggers,/create trigger phase11_approval_notifications/);
assert.match(ui,/postgres_changes/);
assert.match(ui,/get_campaign_notification_state/);
assert.match(ui,/send_campaign_message/);
assert.match(ui,/manage_campaign_notifications/);
assert.match(ui,/removeChannel/);
assert.match(main,/CampaignComms db=\{db!\} campaign=\{campaign\} isGm/);
assert.match(char,/CampaignComms db=\{db\} campaign=\{campaign\}/);
assert.match(dualRoleFix,/if p_audience in \('all','zone'\) and exists/);
assert.match(dualRoleFix,/perform app_private\.notify_campaign_user\(p_campaign,sender,'announcement'/);
assert.match(dualRoleFix,/insert into public\.notification_inbox/);
assert.match(char,/<details className="nx-character-comms" open>/);
console.log('Phase 11 messaging and notifications structural regression checks passed.');
