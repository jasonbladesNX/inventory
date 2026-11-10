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
  [/className="mv-modal-action-button" disabled=\{busy\|\|loading\|\|!detailEquipSlot/,'Equip button inside item popup'],
  [/onEquip\(selectedItem.item_id,slot\)/,'modal equip uses existing secured callback'],
  [/void requestUnequip\(row\)/,'equipped slot unequip uses dependency preview'],
  [/aria-label=\{`View details for/,'item icon opens details'],
  [/isContainer&&<button/,'containers still offer View contents'],
  [/Stored in \{storage\[item.item_id\].location_name\}/,'stored-in tag'],
  [/InventoryWorkbench/,'inventory workbench integration'],
  [/favoriteIds/,'saved favorites state'],
  [/inventoryIndicators/,'authorized condition and weight feed'],
  [/className="mv-item-modal mv-capacity-dialog"/,'capacity breakdown appears in modal'],
  [/onClick=\{\(\)=>\{const row=equippedByItem.get\(selectedItem.item_id\)/,'detail Unequip uses dependency check']
];
for(const [pattern,label] of contracts) assert.match(ui,pattern,String(label));
assert.match(css,/\.mv-slot-picker-body/);
assert.match(css,/\.mv-stored-tag/);
assert.match(workbench,/Item type/);
assert.doesNotMatch(workbench,/<label>Where/,'Where dropdown removed');
assert.match(workbench,/setLocation/);
assert.doesNotMatch(workbench,/<label>Show/,'Show filter removed as requested');
assert.match(css,/\.mv-item-title-line/,'equipped state beside item name');
assert.doesNotMatch(ui,/window\.prompt\(/);
// Attribute presentation is uniform even when equipment changes an effective score.
assert.match(ui,/className="mv-attribute-summary-item mv-attribute-summary-button"/,'uniform clickable attribute-card classes');
assert.doesNotMatch(ui,/has-equipment-bonus/,'no conditional attribute-card highlight');
assert.doesNotMatch(css,/\.mv-attribute-summary-item\.has-equipment-bonus/,'no highlight override');
assert.match(ui,/Equipment adjustment/,'equipment bonus information preserved in attribute popup');
// Weight details are hidden until expanded, for D&D and non-D&D rulesets.
const weightPanel=ui.slice(ui.indexOf('const inventoryWeightPanel='),ui.indexOf('const walletOrder='));
const dialogStart=weightPanel.indexOf('className="mv-item-modal mv-capacity-dialog"');
const breakdownStart=weightPanel.indexOf('<div className="mv-weight-breakdown">');
assert.ok(dialogStart>=0&&breakdownStart>dialogStart,'weight breakdown is confined to capacity modal');
assert.doesNotMatch(weightPanel,/<details className="mv-carry-capacity-help">/);
assert.equal((weightPanel.match(/className="mv-weight-breakdown"/g)||[]).length,1,'weight breakdown is only rendered once');
for(const label of ['Total','Loose &amp; equipped','Inside containers'])assert.ok(weightPanel.includes(label),'weight label retained: '+label);
assert.match(weightPanel,/Known weight against carrying capacity/,'capacity progress bar retained');
console.log('PASS inventory cards, modal actions, equip dependency safeguards and capacity popup');
