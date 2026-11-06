import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const char=readFileSync('src/CharacterScreen.tsx','utf8');
const panel=readFileSync('src/LoadoutHealthPanel.tsx','utf8');
const sql=readFileSync('docs/sql/milestones-6-16-through-6-20-loadout-health.sql','utf8');
const css=readFileSync('src/loadout-health.css','utf8');
const checks=[
  [/list_character_loadout_audit/,sql,'loadout audit'],
  [/list_character_equipment_dependency_map/,sql,'dependency map'],
  [/forbidden_equipped_categories/,sql,'category conflict auditing'],
  [/list_character_attributes\(p_character\)/,sql,'authorization'],
  [/revoke all on function public.list_character_loadout_audit/,sql,'restricted anonymous permissions'],
  [/revoke all on function public.list_character_equipment_dependency_map/,sql,'restricted dependency permissions'],
  [/LoadoutHealthPanel/,char,'Character integration'],
  [/onReviewRemoval=/,char,'existing guarded unequip action'],
  [/list_character_loadout_audit/,panel,'live audit'],
  [/list_character_equipment_dependency_map/,panel,'live dependencies'],
  [/Items needing attention/,panel,'health summary'],
  [/Conflicts with equipped/,sql,'conflict descriptions'],
  [/Review unequip to resolve/,panel,'guided repair'],
  [/repair&&createPortal/,panel,'visible modal'],
  [/role="alertdialog" aria-modal="true"/,panel,'accessible confirmation'],
  [/cancelRepairRef/,panel,'keyboard focus in confirmation'],
  [/Continue to unequip/,panel,'explicit repair confirmation'],
  [/onReviewRemoval\(assignment\)/,panel,'existing unequip callback'],
  [/navigator\.clipboard\.writeText/,panel,'report copy'],
  [/Refresh/,panel,'manual refresh'],
  [/inventoryVersion,revision/,panel,'automatic refresh after equipment changes'],
  [/nx-loadout-health/,css,'responsive styling']
];
for(const [re,source,label] of checks){
  assert.match(source,re,String(label));
}
assert.doesNotMatch(panel,/db\.from\('equipment_assignments'\)\.delete/,'UI must never delete assignments');
assert.doesNotMatch(panel,/db\.rpc\('unequip_inventory_item'/,'UI uses existing verified unequip handler');

const target=fileURLToPath(new URL('./.loadout-health-smoke.cjs',import.meta.url));
try{
  await build({entryPoints:['src/LoadoutHealthPanel.tsx'],outfile:target,bundle:true,platform:'node',format:'cjs',external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
  const require=createRequire(import.meta.url);
  const Component=require(target).default;
  const markup=renderToStaticMarkup(React.createElement(Component,{
    db:{rpc:async()=>({data:[],error:null})},
    character:'test-id',characterName:'Test Barbarian',inventoryVersion:1,busy:false,onReviewRemoval:()=>{}
  }));
  assert.match(markup,/Loadout Health/);
  assert.match(markup,/Checking equipped item requirements/);
}finally{
  await unlink(target).catch(()=>{});
}
console.log('PASS 6.16–6.20 loadout health, dependency, conflict, repair, report and rendering contracts');
