import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('src/CharacterScreen.tsx','utf8');
const css=readFileSync('src/character-screen.css','utf8');
const contracts=[
  [/function equipmentSlotIcon\(/,'distinct slot icons'],
  [/main_hand:Sword,off_hand:Hand,armor:ShieldCheck/,'slot-specific icon mapping'],
  [/const Icon=slotIcons\[category\]/,'inventory icon selection'],
  [/mv-loadout-launch/,'loadout trigger in equipped card'],
  [/loadoutOpen&&tab==='character'&&createPortal/,'loadout rendered as modal'],
  [/onReviewRemoval=\{assignmentId=>/,'existing secure unequip handoff'],
  [/mv-inventory-quick-action/,'direct inventory equip action'],
  [/void requestUnequip\(equippedRow\)/,'quick unequip uses dependency preview'],
  [/allowed.length===1/,'single eligible slot shortcut'],
  [/onEquip\(item.item_id,allowed\[0\]\)/,'authorized equip callback'],
  [/openDetails\(item.item_id,event\)/,'blocked and multiple-slot item details'],
  [/isContainer\?/,'containers kept to view contents'],
  [/Stored in \{storage\[item.item_id\].location_name\}/,'stored-in tag'],
  [/mv-slot-category-filter/,'inventory category selector'],
  [/visibleCarried/,'filter carried items'],
  [/visibleStored/,'filter stored items'],
  [/mv-carry-capacity-help/,'collapsible carrying capacity information'],
  [/onClick=\{\(\)=>\{const row=equippedByItem.get\(selectedItem.item_id\)/,'detail Unequip uses dependency check']
];
for(const [pattern,label] of contracts) assert.match(ui,pattern,String(label));
assert.match(css,/\.mv-loadout-dialog-body/);
assert.match(css,/\.mv-stored-tag/);
assert.match(css,/\.mv-inventory-slot-filter/);
assert.match(css,/\.mv-inventory-quick-action/);
assert.doesNotMatch(ui,/window\.prompt\(/);
console.log('PASS 7 requested UI changes, secure equip and unequip handoff, loadout modal and storage filtering');
