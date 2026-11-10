import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const character=readFileSync('src/CharacterScreen.tsx','utf8');
const inventory=readFileSync('src/InventoryWorkbench.tsx','utf8');
const scanner=readFileSync('src/ClaimLootPanel.tsx','utf8');
const cameraCss=readFileSync('src/qr-loot.css','utf8');
const inventoryCss=readFileSync('src/inventory-workbench.css','utf8');
const assertHas=(value,regex,label)=>assert.match(value,regex,label);

const card=character.slice(character.indexOf('const renderInventoryCard='),character.indexOf('const canShowCarryCapacity='));
assertHas(card,/aria-label={`View details for \$\{item.display_name\}`}/,'container cards open details by item icon');
assert.doesNotMatch(card,/mv-browse-container|View contents/,'main inventory list no longer contains View Contents button');
assertHas(character,/storage\[selectedItem.item_id\]\?\.is_container&&<div className="mv-container-contents"/,
  'every container has contents section in its details popup');
assertHas(character,/aria-label={`Contents of \$\{selectedItem.display_name\}`}/,'container contents are labelled');
assertHas(character,/selectedUsage&&<div className="mv-container-capacity"/,'capacity stats are optional');
assertHas(character,/containedItems.length===0\?<p className="mv-container-empty"/,'empty containers show an explanation');
assertHas(character,/containedItems.map\(item=><button/,'contents list is interactive');
assertHas(character,/onClick=\{\(\)=>setExpandedItem\(item.item_id\)\}/,'contained items open item details');
assertHas(character,/onClick=\{\(\)=>setExpandedItem\(storage\[selectedItem.item_id\].container_item_id\)\}/,
  'nested item can return to container details');

const firstSearch=inventory.indexOf('<div className="nx-inventory-search">');
const firstCategory=inventory.indexOf('<label>Item type');
assert.ok(firstSearch>=0&&firstSearch<firstCategory,'search appears to the left of Item type');
const filters=inventory.slice(inventory.indexOf('<div className="nx-inventory-filters">'),inventory.indexOf('<div className="nx-inventory-toolbar">'));
assertHas(filters,/aria-label="Search inventory"/,'screen reader still gets a search label');
assert.doesNotMatch(filters,/<label[^>]*>Search inventory/,'search label is no longer shown above input');
assertHas(filters,/placeholder="Search here\.\.\."/,'new search placeholder');
assert.doesNotMatch(filters,/Item name…/,'old search placeholder removed');
assert.doesNotMatch(inventory,/<span>\{matches.length\} of \{items.length\} item entries shown<\/span>/,
  'redundant visible item entry count removed');
assertHas(inventoryCss,/\.nx-inventory-filters>\.nx-inventory-search\{/,'search aligned alongside category selector');
assertHas(inventoryCss,/\.nx-inventory-toolbar\{justify-content:flex-end\}/,'filter toolbar does not reserve count text space');

assertHas(scanner,/import \{createPortal\} from 'react-dom'/,'scanner popup uses accessible portal');
assertHas(scanner,/cameraModalOpen&&createPortal\(/,'live scanner is rendered in a dialog');
assertHas(scanner,/role="dialog" aria-modal="true" aria-labelledby="mv-loot-camera-title"/,
  'camera popup has dialog semantics');
assertHas(scanner,/className="mv-item-modal mv-loot-camera-dialog"/,'camera uses dedicated modal');
const inline=scanner.slice(scanner.indexOf('{open&&<div className="mv-loot-claim-form">'),scanner.indexOf('{!open&&notice&&'));
assert.doesNotMatch(inline,/<video/,'no inline camera preview');
const popup=scanner.slice(scanner.indexOf('{cameraModalOpen&&createPortal('));
assertHas(popup,/<video ref=\{videoRef\} autoPlay playsInline muted/,'camera video now lives in popup');
assertHas(popup,/onClick=\{closeCamera\}/,'close controls stop scanner');
assertHas(scanner,/const closeCamera=\(\)=>\{stopCamera\(\);setCameraModalOpen\(false\)\}/,
  'close stops camera tracks');
assertHas(scanner,/if\(event.key==='Escape'\)/,'Esc closes camera modal');
assertHas(scanner,/if\(event.currentTarget===event.target\)closeCamera\(\)/,'backdrop closes scanner');
assertHas(scanner,/reader.decodeFromStream\(streamRef.current,video/,'existing iPhone QR decoding retained');
assertHas(scanner,/setNotice\('QR code scanned\. Review the claim before confirming\.'/,
  'successful QR still requires confirmation');
assertHas(scanner,/Claim link or token<textarea/,'manual claim link remains available');
assertHas(cameraCss,/\.mv-loot-camera-dialog \.mv-loot-camera video\{/,
  'larger camera preview responsive styles');
assertHas(cameraCss,/height:min\(56dvh,530px\)/,'scanner taller than old inline preview');
console.log('PASS container popup, streamlined search, and full-size iPhone camera modal contracts');
