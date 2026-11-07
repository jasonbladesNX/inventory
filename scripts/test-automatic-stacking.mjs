import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('docs/sql/automatic-stack-non-equippable-only.sql','utf8');
const explicitSafety=readFileSync('docs/sql/guard-explicit-equippable-gear-from-stacking.sql','utf8');
assert.match(explicitSafety,/default_properties->>'equippable'/,'explicitly equippable supplies must not stack');
assert.match(explicitSafety,/default_properties->>'unique'/,'explicitly unique items must not stack');
assert.match(explicitSafety,/slot.campaign_id=d.campaign_id/,'preserve campaign equipment slot matching');
const item=readFileSync('src/CharacterScreen.tsx','utf8');
const manager=readFileSync('src/StackManagement.tsx','utf8');
for(const [pattern,label] of [
 [/item_can_auto_stack/,'central stackability rule'],
 [/category not in \('weapon','armor','shield','ring'/,'equipment category exclusion'],
 [/item_effects e where e.item_instance_id=i.id/,'avoid merging item-instance effects'],
 [/properties=v_source.properties/,'public properties equality'],
 [/private_properties=v_source.private_properties/,'private properties equality'],
 [/condition_code=v_source.condition_code/,'condition equality'],
 [/container_id is not distinct from v_source.container_id/,'same container requirement'],
 [/app_private.consolidate_item_location\(iid\)/,'acquisition auto consolidation'],
 [/app_private.consolidate_item_location\(p_item\)/,'storage auto consolidation'],
 [/p_quantity>500/,'limit individual acquisitions'],
 [/values\(p_campaign,p_definition,hid,1\)/,'individual equipment instances'],
 [/v_action in \('split','merge','move_quantity'\)/,'stack-operation equipment guard'],
 [/character_id',p_character/,'character-scoped movement history']
])assert.match(sql,pattern,label);
assert.match(item,/chooseStorageMove\(selectedItem\.item_id,target\)/,'Put in dropdown must request quantity');
assert.match(item,/chooseStorageMove\(selectedItem\.item_id,null\)/,'Take out must request quantity');
assert.match(item,/Quantity to move/,'stack move quantity prompt');
assert.match(item,/p_action:'move_quantity'/,'partial stack moves use transactional RPC');
assert.match(item,/quantity===Number\(item.quantity\)/,'whole stack move retains existing handler');
assert.match(item,/Split stack…/);
assert.match(item,/splitSelectedStack/);
assert.match(item,/p_action:'split'/);
assert.match(manager,/Choose non-equippable supplies/);
assert.doesNotMatch(manager,/value="merge"/);
assert.match(item,/value="__trash__"/);
console.log('PASS automatic stack rules, individual equipment, contextual splitting and scoped history');
