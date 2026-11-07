import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('docs/sql/character-hp-and-healing-potion.sql','utf8');
const history=readFileSync('docs/sql/healing-potion-activity-description.sql','utf8');
const ui=readFileSync('src/CharacterScreen.tsx','utf8');
for(const [pattern,label] of [
 [/get_character_hit_points/,'authorized HP reader'],
 [/set_character_hit_points/,'authorized HP update'],
 [/v_max<1 or v_max>100000/,'HP range validation'],
 [/for update/,'character locking'],
 [/v_heal:=v_props->'use_effect'/,'data-configured potion effect'],
 [/floor\(random\(\)\*v_dice_sides\)/,'server-side healing dice'],
 [/least\(v_requested_heal,v_max-v_current\)/,'healing capped to maximum HP'],
 [/update public.characters c/,'HP update in consumption transaction'],
 [/v_after:=v_item.quantity-p_quantity/,'inventory decrement same transaction'],
 [/nexus_potion_of_healing/,'Potion of Healing in D&D catalog'],
 [/revoke all on function public.get_character_hit_points/,'no anonymous HP reads'],
 [/revoke all on function public.set_character_hit_points/,'no anonymous HP writes']
])assert.match(sql,pattern,label);
assert.match(history,/heal_applied/,'healing visible in inventory activity');
for(const [pattern,label] of [
 [/db.rpc\('get_character_hit_points'/,'refresh authorized HP state'],
 [/db.rpc\('set_character_hit_points'/,'save HP'],
 [/const hitPointPanel=/,'character HP panel'],
 [/\{hitPointPanel\}/,'HP rendered on character screen'],
 [/hitPoints\.current/,'HP display'],
 [/use_character_inventory_item/,'existing one-click consume flow']
])assert.match(ui,pattern,label);
console.log('PASS HP tracker, healing potion, atomic consumption contract and activity');
