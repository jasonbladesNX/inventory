import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('docs/sql/character-item-consumption.sql','utf8');
const indicator=readFileSync('docs/sql/character-item-consumable-indicator.sql','utf8');
const ui=readFileSync('src/CharacterScreen.tsx','utf8');
for(const [pattern,label] of [
 [/use_character_inventory_item/,'authenticated consumption RPC'],
 [/p_quantity<>trunc\(p_quantity\)/,'whole-unit quantity only'],
 [/m\.user_id=v_actor and m\.status='active'/,'character ownership check'],
 [/for update of i/,'row locking'],
 [/app_private\.item_can_auto_stack/,'non-equippable guard'],
 [/transaction_lines/,'historical trade reference guard'],
 [/character_item_used/,'activity event'],
 [/revoke all on function public\.use_character_inventory_item/,'anonymous permission revoked'],
 [/grant execute on function public\.use_character_inventory_item.*authenticated/,'authenticated permission']
]) assert.match(sql,pattern,label);
assert.match(indicator,/'can_consume'/);
assert.match(ui,/Use \/ Consume…/);
assert.match(ui,/Quantity to use/);
assert.match(ui,/confirmItemUse/);
assert.match(ui,/db\.rpc\('use_character_inventory_item'/);
assert.match(ui,/itemDetails\.can_consume/);
assert.match(ui,/!Number\.isSafeInteger\(Number\(useQuantity\)\)/);
console.log('PASS consumable use access, quantities, history and UI contracts');
