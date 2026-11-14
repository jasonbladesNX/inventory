import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';

const parserSource=readFileSync('src/gmCsvImportParser.ts','utf8');
const helperSource=readFileSync('src/gmCsvImportReview.ts','utf8');
const uiSource=readFileSync('src/GmCsvImports.tsx','utf8');
const sql=readFileSync('docs/sql/gm-csv-diagnostics-8-5.sql','utf8');
const css=readFileSync('src/gm-csv-imports.css','utf8');
const assertCode=(source,re,msg)=>assert.match(source,re,msg);
for(const [source,re,msg] of [
 [parserSource,/lineNumbers\.push\(rec.line\)/,'original CSV physical line numbers retained'],
 [helperSource,/getGmCsvDuplicateGroups/,'shared duplicate recognition'],
 [helperSource,/reviewGmCsvImport/,'explicit review reducer'],
 [helperSource,/makeGmCsvReport/,'downloadable validation reports'],
 [helperSource,/\[=\+\\-@\]/,'formula injection guard'],
 [uiSource,/Review \{duplicateCount\} duplicate row\(s\)/,'duplicate group review'],
 [uiSource,/Keep first occurrence/,'first occurrence action'],
 [uiSource,/Keep last occurrence/,'last occurrence action'],
 [uiSource,/Combine item quantities/,'combine action'],
 [uiSource,/Download Validation Report/,'row errors export'],
 [uiSource,/Download Import Receipt/,'success receipt export'],
 [uiSource,/gm_csv_diagnose_rows/,'server diagnostic calls after preview failure'],
 [uiSource,/review\.effectiveRows,p_dry_run:true/,'only resolved rows server previewed'],
 [uiSource,/review\.effectiveRows,p_dry_run:false/,'only resolved rows imported'],
 [uiSource,/review\.sourceLines\[item\.row-1\]/,'preview retains source line'],
 [uiSource,/setPreview\(null\);setConfirm\(false\);setServerIssues\(\[\]\);setError\(''\)/,
  'duplicate strategy change discards old approval and preview'],
 [uiSource,/review\.problems\.length>0/,'local validation stops preview'],
 [uiSource,/!preview\|\|!confirm\|\|working/,'no unconfirmed import'],
 [sql,/create or replace function public\.gm_csv_diagnose_rows/,'server diagnostics RPC'],
 [sql,/app_private\.is_gm\(p_campaign\)/,'server GM verification'],
 [sql,/p_kind not in \('catalog','character-inventory','shop-stock','loot-contents'\)/,'four types'],
 [sql,/jsonb_array_length\(p_rows\) not between 1 and 200/,'bounded diagnostics'],
 [sql,/public\.gm_import_catalog_csv\(p_campaign,jsonb_build_array\(v_row\),true\)/,'catalog dry run'],
 [sql,/public\.gm_import_character_inventory_csv\(p_campaign,jsonb_build_array\(v_row\),true\)/,'inventory dry run'],
 [sql,/public\.gm_import_shop_stock_csv\(p_campaign,jsonb_build_array\(v_row\),true,null\)/,'shop dry run'],
 [sql,/public\.gm_import_qr_loot_csv\(p_campaign,jsonb_build_array\(v_row\),true,null\)/,'loot dry run'],
 [sql,/get stacked diagnostics v_message=message_text,v_state=returned_sqlstate/,'structured SQL diagnostic errors'],
 [sql,/revoke all on function public\.gm_csv_diagnose_rows.*from public,anon/,'anonymous access forbidden'],
 [sql,/grant execute on function public\.gm_csv_diagnose_rows.*to authenticated/,'authenticated restricted by GM check']
 ])assertCode(source,re,msg);
assert.doesNotMatch(sql,/p_dry_run,false/,'no writes in diagnostics function');

const files=[
 ['parser','src/gmCsvImportParser.ts'],['helper','src/gmCsvImportReview.ts'],
 ['specs','src/gmCsvTemplateSpecs.ts'],['ui','src/GmCsvImports.tsx']
];
const paths=Object.fromEntries(files.map(([k])=>[k,fileURLToPath(new URL('./.gm-csv-8-5-'+k+'.cjs',import.meta.url))]));
try{
 for(const [key,path] of files){
  await build({entryPoints:[path],outfile:paths[key],bundle:true,platform:'node',format:'cjs',
   external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
 }
 const require=createRequire(import.meta.url);
 const {parseGmImportCsv}=require(paths.parser);
 const {reviewGmCsvImport,getGmCsvDuplicateGroups,makeGmCsvReport,gmCsvReportName}=require(paths.helper);
 const {gmCsvTemplates,makeGmTemplateCsv}=require(paths.specs);
 const type=(id)=>gmCsvTemplates.find(t=>t.id===id);
 for(const t of gmCsvTemplates){
  const parsed=parseGmImportCsv(makeGmTemplateCsv(t,true),t);
  assert.equal(parsed.rows.length,t.examples.length);
  assert.deepEqual(parsed.problems,[],t.id+' approved example remains valid');
  assert.equal(parsed.lineNumbers.length,parsed.rows.length,'one source line per parsed row');
  const clean=reviewGmCsvImport(parsed,t.id,'reject');
  assert.deepEqual(clean.problems,[],'no duplicate errors on approved examples');
  assert.equal(clean.effectiveRows.length,parsed.rows.length,'no loss on valid import');
 }
 const catalog=type('catalog');
 const catalogInput=makeGmTemplateCsv(catalog,true);
 const duplicateInput=catalogInput+catalogInput.split('\r\n')[1]+'\r\n';
 const catParsed=parseGmImportCsv(duplicateInput,catalog);
 assert.ok(catParsed.problems.some(p=>/Duplicate item name in CSV/.test(p.message)));
 const reject=reviewGmCsvImport(catParsed,'catalog','reject');
 assert.ok(reject.problems.some(p=>/Duplicate Field Rations/.test(p.message)));
 const catFirst=reviewGmCsvImport(catParsed,'catalog','first');
 assert.deepEqual(catFirst.problems,[]);
 assert.equal(catFirst.effectiveRows.length,catParsed.rows.length-1);
 assert.equal(catFirst.decisions.length,1);
 const catLast=reviewGmCsvImport(catParsed,'catalog','last');
 assert.deepEqual(catLast.problems,[]);
 assert.equal(catLast.sourceLines.length,catFirst.sourceLines.length);
 assert.equal(catLast.effectiveRows.length,catFirst.effectiveRows.length);
 const c0={character_name:'Hero',character_id:'',item_name:'Longsword',item_definition_id:'',quantity:'2'};
 const c1={...c0,quantity:'3'};
 const characters={rows:[c0,c1],lineNumbers:[2,5],problems:[]};
 const group=getGmCsvDuplicateGroups(characters.rows,characters.lineNumbers,'character-inventory');
 assert.equal(group.length,1);
 assert.deepEqual(group[0].lines,[2,5]);
 assert.equal(reviewGmCsvImport(characters,'character-inventory','reject').problems.length,1,
  'character duplicates now detected client-side');
 const charMerged=reviewGmCsvImport(characters,'character-inventory','combine');
 assert.deepEqual(charMerged.problems,[]);
 assert.equal(charMerged.effectiveRows.length,1);
 assert.equal(charMerged.effectiveRows[0].quantity,'5');
 assert.deepEqual(charMerged.sourceLines,[2]);
 assert.equal(charMerged.decisions[0].keptLine,2);
 const over=reviewGmCsvImport({rows:[{...c0,quantity:'499'},c1],
  lineNumbers:[2,5],problems:[]},'character-inventory','combine');
 assert.ok(over.problems.some(p=>/Cannot combine/.test(p.message)),'never generate 502-unit grant');
 const s0={merchant_name:'Outpost',merchant_id:'',item_name:'Rope',
  item_definition_id:'',currency_code:'GP',unit_price:'20',buyback_price:'10',
  quantity:'4',buys_from_players:'false'};
 const s1={...s0,quantity:'9'};
 const shop=reviewGmCsvImport({rows:[s0,s1],lineNumbers:[2,4],problems:[]},'shop-stock','last');
 assert.deepEqual(shop.problems,[]);
 assert.deepEqual(shop.sourceLines,[4]);
 assert.equal(shop.effectiveRows[0].quantity,'9');
 assert.equal(shop.decisions[0].keptLine,4);
 const item={container_name:'Chest',container_id:'',entry_type:'item',
  item_name:'Rope',item_definition_id:'',quantity:'2',currency_code:'',currency_amount:''};
 const cash={container_name:'Chest',container_id:'',entry_type:'currency',
  item_name:'',item_definition_id:'',quantity:'',currency_code:'GP',currency_amount:'10'};
 const lootReview=reviewGmCsvImport({rows:[item,{...item,quantity:'3'},cash,{...cash,currency_amount:'25'}],
  lineNumbers:[2,3,6,8],problems:[]},'loot-contents','combine');
 assert.deepEqual(lootReview.problems,[]);
 assert.deepEqual(lootReview.sourceLines,[2,8],'combine item first, currency last');
 assert.equal(lootReview.effectiveRows[0].quantity,'5');
 assert.equal(lootReview.effectiveRows[1].currency_amount,'25');
 assert.equal(lootReview.decisions.length,2);
 const invalid=reviewGmCsvImport({rows:[s0,s1],lineNumbers:[2,3],
  problems:[{line:3,message:'Stock quantity must be a whole number from 0 to 1,000,000.'}]},
  'shop-stock','first');
 assert.equal(invalid.problems.length,1,'duplicate handling does not erase genuine validation errors');
 const report=makeGmCsvReport('=HYPERLINK("bad")','catalog',[
  {line:3,status:'error',message:'=cmd',action:'@bad'},
  {line:5,status:'resolution',message:'Removed duplicate, kept row 2'}
 ]);
 assert.ok(report.startsWith('\uFEFF'),'Excel-friendly UTF-8 BOM');
 assert.match(report,/'=cmd/,'spreadsheet formula sanitized');
 assert.match(report,/'@bad/,'action formula sanitized');
 assert.match(report,/'=HYPERLINK/,'filename formula sanitized');
 assert.match(report,/\r\n/,'CRLF output');
 assert.equal(gmCsvReportName('Weird Name.csv','errors'),'Weird_Name-errors.csv');
 const App=require(paths.ui).default;
 const html=renderToStaticMarkup(React.createElement(App,{
  db:{rpc:()=>Promise.reject(new Error('SSR should never query'))},
  campaign:'qa-campaign',onImported:async()=>{}
 }));
 assert.match(html,/Validate &amp; Preview/,'baseline GM upload preserved');
 assert.match(html,/Treasure &amp; Loot/,'all four upload modes preserved');
}finally{
 await Promise.all(Object.values(paths).map(p=>unlink(p).catch(()=>{})));
}
console.log('PASS 8.5: four import modes, source lines, explicit duplicates, safe aggregation, diagnostics and report exports');
