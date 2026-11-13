import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const source=readFileSync('src/GmCsvImports.tsx','utf8');
const parserSource=readFileSync('src/gmCsvImportParser.ts','utf8');
const specSource=readFileSync('src/gmCsvTemplateSpecs.ts','utf8');
const main=readFileSync('src/main.tsx','utf8');
const gmLoot=readFileSync('src/GmLootManager.tsx','utf8');
const sql=readFileSync('docs/sql/gm-qr-loot-csv-imports-8-4.sql','utf8');
const css=readFileSync('src/gm-csv-imports.css','utf8');

for(const [text,regex,reason] of [
  [source,/onClick=\{\(\)=>selectMode\('loot-contents'\)\}/,'Loot import option'],
  [source,/Confirm & Import Loot/,'Explicit GM approval button'],
  [source,/kind==='loot-contents'\?\{p_expected:preview.rows\}/,'Preview snapshot supplied'],
  [source,/response.item_mode!=='add'\|\|response.currency_mode!=='set'/,'Preview mode checked'],
  [source,/item.old_quantity/,'Preview old item units'],
  [source,/item.new_quantity/,'Preview added units'],
  [source,/item.old_currency_amount/,'Preview old currency amount'],
  [source,/item.currency_amount/,'Preview new currency denomination'],
  [source,/item.new_container/,'Preview new vs existing containers'],
  [source,/New containers are created without QR codes/,'Token generation separate'],
  [source,/kind==='loot-contents'\?'200 loot reward rows, 50 new containers/,'Import row limits disclosed'],
  [source,/kind==='loot-contents'\?\x60\$\{result.new_containers\}/,'Success shows container counts'],
  [main,/kind==='loot-contents'\)setLootImportVersion\(v=>v\+1\)/,'Refresh after loot import'],
  [main,/refreshVersion=\{lootImportVersion\}/,'Manager receives update'],
  [gmLoot,/\[db,campaign,refreshVersion\]/,'Manager refreshes after import'],
  [sql,/create or replace function public.gm_import_qr_loot_csv/,'Server RPC created'],
  [sql,/app_private.is_gm\(p_campaign\)/,'Server GM authorization'],
  [sql,/jsonb_array_length\(p_rows\) not between 1 and 200/,'Server row count validation'],
  [sql,/v_total_units>10000/,'Server total item units cap'],
  [sql,/v_new_count>50/,'Server new container count cap'],
  [sql,/v_qty_text !~ '\^\[0-9\]\{1,3\}\$'/,'Server item quantity validation'],
  [sql,/v_amount_text !~/,'Server currency numeric validation'],
  [sql,/round\(v_amount,v_currency_precision\)<>v_amount/,'Server currency precision'],
  [sql,/p_expected<>v_plan/,'Server requires exact preview snapshot'],
  [sql,/from public.loot_sources l where l.id=v_source and l.campaign_id=p_campaign for update/,'Server locks existing sources'],
  [sql,/t.action_type='loot' and t.revoked_at is null/,'Existing active QR token protection'],
  [sql,/public.create_qr_loot_container/,'Create new sources via existing rules'],
  [sql,/public.add_qr_loot_item/,'Physical items use existing safe add RPC'],
  [sql,/public.set_qr_loot_currency/,'Currency uses existing set denomination RPC'],
  [sql,/revoke all on function public.gm_import_qr_loot_csv.*from public,anon/,'Anonymous denied execute'],
  [sql,/grant execute on function public.gm_import_qr_loot_csv.*to authenticated/,'Authenticated RPC permission'],
  [specSource,/Only active, unclaimed containers without an active QR claim token/,'Download guidance updated'],
  [css,/\.nx-csv-loot-preview table/,'Responsive loot preview']
])assert.match(text,regex,reason);
assert.doesNotMatch(sql,/public.issue_loot_qr_token\(/,'Import never issues a QR claim token');
assert.match(parserSource,/mode==='loot-contents'/,'Loot parser enabled');

const parserPath=fileURLToPath(new URL('./.gm-csv-8-4-parser.cjs',import.meta.url));
const specsPath=fileURLToPath(new URL('./.gm-csv-8-4-specs.cjs',import.meta.url));
const uiPath=fileURLToPath(new URL('./.gm-csv-8-4-ui.cjs',import.meta.url));
try{
 await build({entryPoints:['src/gmCsvImportParser.ts'],outfile:parserPath,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 await build({entryPoints:['src/gmCsvTemplateSpecs.ts'],outfile:specsPath,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 await build({entryPoints:['src/GmCsvImports.tsx'],outfile:uiPath,bundle:true,platform:'node',format:'cjs',external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
 const require=createRequire(import.meta.url);
 const parse=require(parserPath).parseGmImportCsv;
 const {gmCsvTemplates,makeGmTemplateCsv}=require(specsPath);
 const loot=gmCsvTemplates.find(t=>t.id==='loot-contents');
 assert.ok(loot,'Loot template exists');
 assert.deepEqual(loot.columns.map(c=>c.key),[
  'container_name','container_id','entry_type','item_name','item_definition_id','quantity','currency_code','currency_amount'
 ]);
 const example=parse(makeGmTemplateCsv(loot,true),loot);
 assert.deepEqual(example.problems,[],'Approved loot example must be valid');
 assert.equal(example.rows.length,loot.examples.length);
 assert.ok(example.rows.some(r=>r.entry_type==='item'),'Item sample');
 assert.ok(example.rows.some(r=>r.entry_type==='currency'),'Currency sample');
 const header=loot.columns.map(c=>c.key).join(',');
 const item='Sample Chest,,item,Longsword,,3,,';
 const money='Sample Chest,,currency,,,,CP,45';
 const problemsFor=(row)=>parse(header+'\r\n'+row+'\r\n',loot).problems;
 assert.deepEqual(problemsFor(item),[],'Item row valid');
 assert.deepEqual(problemsFor(money),[],'Currency row valid');
 const badCases=[
  ['Sample Chest,,item,Longsword,,501,,',/Item quantity/],
  ['Sample Chest,,item,Longsword,,-3,,',/Item quantity/],
  ['Sample Chest,,item,Longsword,,2,CP,10',/leave currency/],
  ['Sample Chest,,currency,Longsword,,,CP,10',/leave item fields/],
  ['Sample Chest,,currency,,,,CP,0',/Currency amount/],
  ['Sample Chest,,currency,,,,CP,1.1234567',/Currency amount/],
  ['Sample Chest,,currency,,,,,10',/Currency code/],
  ['Sample Chest,,wrong,Longsword,,1,,',/entry_type/],
  [',,item,Longsword,,1,,',/Container name/],
  ['Sample Chest,not-a-uuid,item,Longsword,,1,,',/container_id/],
  ['Sample Chest,,item,,,2,,',/Item name or item definition ID/]
 ];
 for(const [row,expected] of badCases)assert.ok(problemsFor(row).some(p=>expected.test(p.message)),row+' must fail: '+expected);
 const duplicated=parse(header+'\r\n'+item+'\r\n'+item+'\r\n',loot);
 assert.ok(duplicated.problems.some(p=>/Duplicate container\/item reward/.test(p.message)));
 const duplicateCurrency=parse(header+'\r\n'+money+'\r\n'+money+'\r\n',loot);
 assert.ok(duplicateCurrency.problems.some(p=>/Duplicate container\/currency reward/.test(p.message)));
 assert.throws(()=>parse(header+'\r\n'+Array(201).fill(item).join('\r\n')+'\r\n',loot),/Maximum 200 rows/);
 const Input=require(uiPath).default;
 const html=renderToStaticMarkup(React.createElement(Input,{
  db:{rpc:()=>Promise.reject(new Error('SSR should not query'))},
  campaign:'test-campaign',onImported:async()=>{}
 }));
 assert.match(html,/>Treasure &amp; Loot<\/button>/,'Fourth CSV import mode visible');
 assert.doesNotMatch(html,/Confirm &amp; Import Loot/,'No import confirmation before preview');
}finally{
 await Promise.all([unlink(parserPath).catch(()=>{}),unlink(specsPath).catch(()=>{}),unlink(uiPath).catch(()=>{})]);
}
console.log('PASS 8.4: loot item/currency CSV validation, GM preview, token security and atomic import contract');
