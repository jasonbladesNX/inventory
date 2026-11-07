import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const sql=readFileSync('docs/sql/milestones-6-36-to-6-40.sql','utf8');
const ui=readFileSync('src/StackManagement.tsx','utf8');
const parent=readFileSync('src/CharacterScreen.tsx','utf8');
const main=readFileSync('src/main.tsx','utf8');
for(const [rule,name] of [
 [/manage_character_item_stack/,'transactional stack RPC'],[/v_action='split'/,'split'],
 [/v_action='merge'/,'merge'],[/v_action='move_quantity'/,'partial storage move'],
 [/v_action='discard'/,'discard'],[/move_character_item_storage/,'reuse secure capacity check'],
 [/v_item.properties is distinct from v_target.properties/,'exact stack equivalence'],
 [/v_item.private_properties is distinct from v_target.private_properties/,'private properties equivalence'],
 [/equipment_assignments/,'equipped item lock'],[/v_is_container/,'container guard'],
 [/inventory_transactions/,'transaction audit'],[/list_character_inventory_activity/,'activity reader'],
 [/trg_character_equipment_activity/,'equipment change trigger'],
 [/revoke all on function public.manage_character_item_stack/,'deny anonymous writes']
])assert.match(sql,rule,name);
for(const [rule,name] of [
 [/Split stack/,'split choice'],[/Consolidate stacks/,'consolidation choice'],
 [/Move quantity to \/ from container/,'quantity movement choice'],
 [/Permanently discard/,'explicit discard confirmation'],
 [/manage_character_item_stack/,'authorized RPC'],[/list_character_inventory_activity/,'scoped history'],
 [/onChanged\(\)/,'post-transaction refresh']
])assert.match(ui,rule,name);
assert.match(parent,/<StackManagement/);
assert.match(main,/onInventoryChanged=/);
assert.doesNotMatch(ui,/\.from\('item_instances'\)/);
const target=fileURLToPath(new URL('./.m640-smoke.cjs',import.meta.url));
try{
 await build({entryPoints:['src/StackManagement.tsx'],outfile:target,bundle:true,platform:'node',format:'cjs',
  external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
 const Component=createRequire(import.meta.url)(target).default;
 const markup=renderToStaticMarkup(React.createElement(Component,{db:{rpc:async()=>({data:[],error:null})},
  character:'char',inventoryVersion:0,items:[{item_id:'a',display_name:'Arrow',quantity:20,eligible:true}],
  storage:{},equippedIds:new Set(),busy:false,onChanged:async()=>{}}));
 assert.match(markup,/Item stack management/);
 assert.match(markup,/Inventory activity/);
 assert.doesNotMatch(markup,/Permanently discard/);
}finally{await unlink(target).catch(()=>{})}
console.log('PASS inventory quantity milestones 6.36–6.40 and read-only activity contracts');
