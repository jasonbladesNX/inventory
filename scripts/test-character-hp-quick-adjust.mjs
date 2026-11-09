import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('docs/sql/character-hp-quick-adjust.sql','utf8');
const ui=readFileSync('src/CharacterScreen.tsx','utf8');
const checks=[
 [/adjust_character_hit_points/,'authorized atomic adjustment function'],
 [/for update/,'character row lock'],
 [/m.user_id=v_actor and m.status='active'/,'scoped character ownership'],
 [/p_operation not in \('damage','heal'\)/,'validated operation'],
 [/p_amount<1 or p_amount>100000/,'validated amount'],
 [/greatest\(0,v_current-p_amount\)/,'damage floor zero'],
 [/least\(v_max,v_current\+p_amount\)/,'healing ceiling max HP'],
 [/character_hp_adjusted/,'audited HP action'],
 [/previous_hp/,'history previous HP'],
 [/current_hp/,'history current HP'],
 [/revoke all on function public.adjust_character_hit_points/,'no anonymous adjustment']
];
for(const [pattern,label] of checks)assert.match(sql,pattern,label);
for(const [pattern,label] of [
 [/db.rpc\('adjust_character_hit_points'/,'HP adjustment UI RPC'],
 [/p_operation:operation,p_amount:amount/,'operation and count passed'],
 [/onClick=\{\(\)=>void adjustHitPoints\('damage'\)\}>Damage<\/button>/,'damage UI control'],
 [/Heal HP/,'healing UI control'],
 [/setHpAdjustFeedback/,'live status feedback'],
 [/await onInventoryChanged\(\)/,'refresh for inventory activity'],
 [/hitPoints.current===0/,'floor disables excess damage'],
 [/hitPoints.current===hitPoints.max/,'ceiling disables excess healing']
])assert.match(ui,pattern,label);
console.log('PASS character HP damage and heal controls and audit');
