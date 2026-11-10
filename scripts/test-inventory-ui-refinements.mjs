import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('src/CharacterScreen.tsx','utf8');
const css=readFileSync('src/character-screen.css','utf8');
const workbench=readFileSync('src/InventoryWorkbench.tsx','utf8');
const contracts=[
  [/function equipmentSlotIcon\(/,'distinct slot icons'],
  [/main_hand:Sword,off_hand:Hand,armor:ShieldCheck/,'slot-specific icon mapping'],
  [/const Icon=slotIcons\[category\]/,'inventory icon selection'],
  [/mv-slot-equip-button/,'equip action beside every configured slot'],
  [/equipSlotPicker&&createPortal/,'equip slot picker is modal'],
  [/preview_character_unequip_dependencies/,'dependency-aware unequip retained'],
  [/mv-inventory-quick-action/,'direct inventory equip action'],
  [/void requestUnequip\(equippedRow\)/,'quick unequip uses dependency preview'],
  [/allowed.length===1/,'single eligible slot shortcut'],
  [/onEquip\(item.item_id,allowed\[0\]\)/,'authorized equip callback'],
  [/openDetails\(item.item_id,event\)/,'blocked and multiple-slot item details'],
  [/isContainer\?/,'containers kept to view contents'],
  [/Stored in \{storage\[item.item_id\].location_name\}/,'stored-in tag'],
  [/InventoryWorkbench/,'inventory workbench integration'],
  [/favoriteIds/,'saved favorites state'],
  [/inventoryIndicators/,'authorized condition and weight feed'],
  [/className="mv-capacity-dialog"/,'capacity breakdown appears in modal'],
  [/onClick=\{\(\)=>\{const row=equippedByItem.get\(selectedItem.item_id\)/,'detail Unequip uses dependency check']
];
for(const [pattern,label] of contracts) assert.match(ui,pattern,String(label));
assert.match(css,/\.mv-slot-picker-body/);
assert.match(css,/\.mv-stored-tag/);
assert.match(workbench,/Item type/);
assert.match(workbench,/Where/);
assert.match(workbench,/setLocation/);
assert.doesNotMatch(workbench,/<label>Show/,'Show filter removed as requested');
assert.match(css,/\.mv-inventory-quick-action/);
assert.doesNotMatch(ui,/window\.prompt\(/);
// Attribute presentation is uniform even when equipment changes an effective score.
assert.match(ui,/className="mv-attribute-summary-item mv-attribute-summary-button"/,'uniform clickable attribute-card classes');
assert.doesNotMatch(ui,/has-equipment-bonus/,'no conditional attribute-card highlight');
assert.doesNotMatch(css,/\.mv-attribute-summary-item\.has-equipment-bonus/,'no highlight override');
assert.match(ui,/Equipment adjustment/,'equipment bonus information preserved in attribute popup');
// Weight details are hidden until expanded, for D&D and non-D&D rulesets.
const weightPanel=ui.slice(ui.indexOf('const inventoryWeightPanel='),ui.indexOf('const walletOrder='));
const dialogStart=weightPanel.indexOf('className="mv-capacity-dialog"');
const breakdownStart=weightPanel.indexOf('<div className="mv-weight-breakdown">');
assert.ok(dialogStart>=0&&breakdownStart>dialogStart,'weight breakdown is confined to capacity modal');
assert.doesNotMatch(weightPanel,/<details className="mv-carry-capacity-help">/);
assert.equal((weightPanel.match(/className="mv-weight-breakdown"/g)||[]).length,1,'weight breakdown is only rendered once');
for(const label of ['Total','Loose &amp; equipped','Inside containers'])assert.ok(weightPanel.includes(label),'weight label retained: '+label);
assert.match(weightPanel,/Known weight against carrying capacity/,'capacity progress bar retained');
console.log('PASS 7 requested UI changes, secure equip and unequip handoff, loadout modal and storage filtering');
