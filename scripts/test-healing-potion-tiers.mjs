import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const catalog=readFileSync('docs/sql/dnd-healing-potion-tiers.sql','utf8');
const engine=readFileSync('docs/sql/character-hp-and-healing-potion.sql','utf8');
const tiers=[
 ['nexus_potion_of_greater_healing',4,4],
 ['nexus_potion_of_superior_healing',8,8],
 ['nexus_potion_of_supreme_healing',10,20]
];
for(const [code,count,bonus] of tiers){
 assert.ok(catalog.includes("'"+code+"'"),'missing potion tier '+code);
 assert.ok(catalog.includes(","+count+","+bonus+")"),'wrong healing parameters for '+code);
}
assert.match(catalog,/gs.code='dnd5e'/,'D&D campaigns only');
assert.match(catalog,/not exists/,'idempotent, preserves campaign customization');
assert.match(catalog,/'type','heal_hp'/,'data-driven healing');
assert.match(engine,/v_dice_count not between 1 and 10/,'healing engine allows all tiers');
assert.match(engine,/least\(v_requested_heal,v_max-v_current\)/,'healing capped at max HP');
assert.match(engine,/character_item_used/,'history recorded for all tiers');
console.log('PASS all D&D healing potion tiers, ruleset scope, limits and activity contracts');
