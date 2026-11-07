import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const ui=readFileSync('src/InventoryWorkbench.tsx','utf8');
const parent=readFileSync('src/CharacterScreen.tsx','utf8');
const css=readFileSync('src/inventory-workbench.css','utf8');
const sql=readFileSync('docs/sql/milestones-6-21-to-6-30-inventory-workbench.sql','utf8');
const checks=[
  [/type="search"/,ui,'6.21 name search'],
  [/name_asc/,ui,'6.22 sorting'],
  [/categoryLabels/,ui,'6.23 category counts'],
  [/set_my_character_item_favorite/,parent,'6.24 saved favorites'],
  [/status==='favorites'/,ui,'6.25 favorites-only filter'],
  [/list_character_inventory_indicators/,parent,'6.26 authorized condition and weight'],
  [/nx-card-container-usage/,parent,'6.27 inline container fullness indicators'],
  [/nx-inventory-inline-meta/,parent,'compact horizontal item status and quantity'],
  [/nx-inventory-top-controls/,ui,'compact search and grouping'],
  [/downloadCsv/,ui,'6.30 filtered CSV export'],
  [/csvCell/,ui,'spreadsheet formula injection avoidance'],
  [/renderItem\(item,setLocation\)/,ui,'container browse navigation'],
  [/onEquip\(item.item_id,allowed\[0\]\)/,parent,'existing authorized equip'],
  [/void requestUnequip\(equippedRow\)/,parent,'existing dependency safe unequip'],
  [/create table if not exists app_private.character_item_favorites/,sql,'private favorites table'],
  [/revoke all on table app_private.character_item_favorites/,sql,'no direct client table access'],
  [/set search_path TO ''|SET search_path TO ''|set search_path=''/,sql,'privileged function controlled search path'],
  [/list_character_attributes\(p_character\)/,sql,'character ownership authorization'],
  [/revoke all on function public.set_my_character_item_favorite/,sql,'no anonymous write'],
  [/revoke all on function public.list_character_inventory_indicators/,sql,'no anonymous indicators']
];
for(const [pattern,source,name] of checks)assert.match(source,pattern,String(name));
assert.match(css,/nx-inventory-filters/);
assert.doesNotMatch(ui,/toggleCompare|compareItems|nx-compare-label|Item comparison/);
assert.doesNotMatch(css,/nx-inventory-compare|nx-compare-label/);
assert.match(parent,/<InventoryWorkbench/);
assert.match(ui,/Export CSV/);
assert.match(ui,/reportOpen&&<section/);
assert.doesNotMatch(ui,/nx-inventory-metrics|nx-container-utilization/);
assert.doesNotMatch(ui,/\.from\('item_instances'\)\.update/);
assert.doesNotMatch(ui,/\.rpc\('equip_inventory_item'/);
const out=fileURLToPath(new URL('./.inventory-workbench-smoke.cjs',import.meta.url));
try{
  await build({entryPoints:['src/InventoryWorkbench.tsx'],outfile:out,bundle:true,platform:'node',
    format:'cjs',external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
  const mod=createRequire(import.meta.url)(out);
  const item={item_id:'a',display_name:'Test Blade',quantity:1,eligible:true};
  const markup=renderToStaticMarkup(React.createElement(mod.default,{
    characterName:'Test Barbarian',items:[item],categories:{a:'weapon'},storage:{},usage:{},
    indicators:{a:{item_id:'a',condition_code:'normal',identified:true,unit_weight_lb:2}},
    equippedIds:new Set(),favoriteIds:new Set(),busy:false,
    renderItem:(row)=>React.createElement('span',null,row.display_name),
    onOpenDetails:()=>{}
  }));
  for(const label of ['Search inventory','Item type','Where','Show','Sort','Test Blade','Report']){
    assert.ok(markup.includes(label),'missing workbench markup: '+label);
  }
}finally{
  await unlink(out).catch(()=>{});
}
console.log('PASS inventory workbench, comparison removal, compact metadata and security contracts');
