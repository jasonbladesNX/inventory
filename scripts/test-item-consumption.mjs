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
const quickReader=readFileSync('docs/sql/list-character-usable-items.sql','utf8');
assert.match(quickReader,/m.user_id=\(select auth.uid\(\)\)/,'usable-item reader authorization');
assert.match(quickReader,/app_private.item_can_auto_stack/,'equipment exclusion');
assert.match(quickReader,/revoke all on function public.list_character_usable_items/,'anonymous reader revoked');
assert.match(ui,/db.rpc\('list_character_usable_items'/,'eligible item reader wired');
assert.match(ui,/Use one \$\{item\.display_name\}/,'normal consumable Use button remains');
assert.match(ui,/Study \$\{item\.display_name\} to learn recipe/,'Recipe items offer specialized Learn action');
assert.match(ui,/p_character:character,p_item:itemId,p_quantity:1/,'exactly one consumed');
assert.match(ui,/usableItemIds.has\(item.item_id\)/,'card eligibility gate');
assert.match(ui,/quickUseBusy!==null/,'double click protection');
console.log('PASS consumable use access, quantities, history and UI contracts');
