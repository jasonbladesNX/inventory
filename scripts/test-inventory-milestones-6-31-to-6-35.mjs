import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const ui=readFileSync('src/InventoryWorkbench.tsx','utf8');
const css=readFileSync('src/inventory-workbench.css','utf8');
const contracts=[
  [/nx-inventory-quickviews/, '6.31 quick views'],
  [/quickView\('favorites'\)/, 'quick favorites'],
  [/nx-workbench-grouping/, '6.32 group by location/type/flat'],
  [/viewMode==='category'/, 'category grouping'],
  [/knownFilteredWeight/, '6.33 filtered weight'],
  [/filteredUnknownWeight/, 'unknown weight caution'],
  [/nx-inventory-print-report/, '6.34 printable report'],
  [/window\.print\(\)/, 'explicit user print'],
  [/printableSummary/, 'report generated from filtered authorized items'],
  [/setSavedView/, '6.35 session saved view'],
  [/restoreView/, 'restore saved view'],
  [/Saved for this session|View saved for this session/, 'session lifetime disclosed'],
  [/renderItem\(item,setLocation\)/, 'existing view contents navigation'],
  [/downloadCsv/, 'existing CSV export'],
];
for(const [regex,label] of contracts) assert.match(ui,regex,String(label));
assert.match(css,/@media print/);
assert.doesNotMatch(ui,/toggleCompare|compareItems|nx-compare-label/,'comparison must remain removed');
assert.doesNotMatch(ui,/\.rpc\('equip_inventory_item'/,'must reuse existing equip handler');
const out=fileURLToPath(new URL('./.workbench-m635-smoke.cjs',import.meta.url));
try{
  await build({entryPoints:['src/InventoryWorkbench.tsx'],outfile:out,bundle:true,platform:'node',format:'cjs',
    external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
  const Component=createRequire(import.meta.url)(out).default;
  const item={item_id:'item1',display_name:'Pouch',quantity:2,eligible:false};
  const markup=renderToStaticMarkup(React.createElement(Component,{
    characterName:'Test Barbarian',items:[item],categories:{item1:'container'},
    storage:{item1:{item_id:'item1',container_item_id:null,is_container:true,location_name:'Carried'}},
    usage:{item1:{container_item_id:'item1',used_weight_lb:0,capacity_weight_lb:6,item_count:0,unknown_weight_count:0}},
    indicators:{item1:{item_id:'item1',condition_code:'normal',identified:true,unit_weight_lb:1}},
    equippedIds:new Set(),favoriteIds:new Set(),busy:false,
    renderItem:entry=>React.createElement('span',null,entry.display_name)
  }));
  for(const label of ['Pouch','Group results','Unknown weight','Save view','Restore view','Report','At least 2.00 lb']){
    assert.ok(markup.includes(label),'missing visible workbench element: '+label);
  }
}finally{await unlink(out).catch(()=>{})}
console.log('PASS milestones 6.31–6.35 inventory workbench and no-comparison regression');
