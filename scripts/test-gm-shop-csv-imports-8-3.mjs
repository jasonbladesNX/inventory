import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';

const main=readFileSync('src/main.tsx','utf8');
const parserSource=readFileSync('src/gmCsvImportParser.ts','utf8');
const ui=readFileSync('src/GmCsvImports.tsx','utf8');
const manager=readFileSync('src/GmMerchantManager.tsx','utf8');
const schema=readFileSync('src/gmCsvTemplateSpecs.ts','utf8');
const sql=readFileSync('docs/sql/gm-shop-csv-imports-8-3.sql','utf8');
const css=readFileSync('src/gm-csv-imports.css','utf8');

for(const [source,pattern,why] of [
  [main,/kind==='shop-stock'\)setShopImportVersion\(v=>v\+1\)/,'Dashboard refreshes after stock import'],
  [main,/refreshVersion=\{shopImportVersion\}/,'merchant manager receives refresh signal'],
  [manager,/\[db,merchant,refreshVersion\]/,'selected merchant listings refresh'],
  [manager,/\[db,campaign,definitions.length,refreshVersion\]/,'campaign merchant list refreshes'],
  [ui,/onClick=\{\(\)=>selectMode\('shop-stock'\)\}/,'Shop Inventory import tab'],
  [ui,/p_expected:preview.rows/,'confirmation supplies the snapshot from preview'],
  [ui,/stock_mode!=='replace'/,'preview verifies replace-mode guarantee'],
  [ui,/item.old_quantity/,'before stock shown'],
  [ui,/item.old_unit_price/,'before price shown'],
  [ui,/item.old_buyback_price/,'before buyback price shown'],
  [ui,/item.old_buys_from_players/,'before buyback status shown'],
  [ui,/item.unit_price/,'new price shown'],
  [ui,/item.buyback_price/,'new buyback price shown'],
  [ui,/item.buys_from_players/,'new buyback status shown'],
  [ui,/Confirm & Replace Shop Listings/,'explicit destructive-replace confirmation'],
  [ui,/Matching merchant \+ item \+ currency listings/,'replace semantics disclosed'],
  [ui,/kind==='shop-stock'\?'200 merchant\/item\/currency listings/,'shop-specific row limits'],
  [ui,/kind==='shop-stock'\|\|kind==='loot-contents'\?\{p_expected:preview.rows\}:\{\}/,'shop and loot imports use snapshot RPC argument'],
  [schema,/Milestone 8.3 REPLACES stock/,'template documentation updated'],
  [css,/\.nx-csv-shop-preview table/,'before/after table styled'],
  [sql,/create or replace function public\.gm_import_shop_stock_csv/,'server-side import RPC'],
  [sql,/app_private\.is_gm\(p_campaign\)/,'server GM authorization'],
  [sql,/security definer set search_path=''/,'fixed SQL search path'],
  [sql,/jsonb_array_length\(p_rows\) not between 1 and 200/,'server 200 row cap'],
  [sql,/v_buys_text not in \('true','false'\)/,'server boolean validation'],
  [sql,/v_quantity not between 0 and 1000000/,'server quantity cap'],
  [sql,/round\(v_price,v_currency_precision\)<>v_price/,'server currency precision validation'],
  [sql,/v_key=any\(v_seen\)/,'server duplicate listing detection'],
  [sql,/p_expected<>v_plan/,'server validates snapshot for stale previews'],
  [sql,/for update;/,'server locks existing listing rows'],
  [sql,/public\.save_merchant_listing/,'reuses merchant upsert RPC'],
  [sql,/revoke all on function public\.gm_import_shop_stock_csv.*from public,anon/,'anonymous execution restricted'],
  [sql,/grant execute on function public\.gm_import_shop_stock_csv.*to authenticated/,'explicit signed-in execution granted'],
  [sql,/v_action:=case when v_listing_id is null then 'create' else 'replace'/,'preview labels updates and new stock']
])assert.match(source,pattern,why);

const parserPath=fileURLToPath(new URL('./.gm-csv-8-3-parser.cjs',import.meta.url));
const specsPath=fileURLToPath(new URL('./.gm-csv-8-3-specs.cjs',import.meta.url));
const uiPath=fileURLToPath(new URL('./.gm-csv-8-3-ui.cjs',import.meta.url));
try{
  await build({entryPoints:['src/gmCsvImportParser.ts'],outfile:parserPath,bundle:true,
    platform:'node',format:'cjs',logLevel:'silent'});
  await build({entryPoints:['src/gmCsvTemplateSpecs.ts'],outfile:specsPath,bundle:true,
    platform:'node',format:'cjs',logLevel:'silent'});
  await build({entryPoints:['src/GmCsvImports.tsx'],outfile:uiPath,bundle:true,platform:'node',
    format:'cjs',external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
  const req=createRequire(import.meta.url);
  const parse=req(parserPath).parseGmImportCsv;
  const {gmCsvTemplates,makeGmTemplateCsv}=req(specsPath);
  const shop=gmCsvTemplates.find(t=>t.id==='shop-stock');
  assert.ok(shop,'Shop stock template exists');
  assert.deepEqual(shop.columns.map(c=>c.key),[
    'merchant_name','merchant_id','item_name','item_definition_id','currency_code',
    'unit_price','buyback_price','quantity','buys_from_players'
  ],'approved 8.1 shop columns preserved');
  const csv=makeGmTemplateCsv(shop,true);
  const result=parse(csv,shop);
  assert.deepEqual(result.problems,[],'sample shop template is client-valid');
  assert.equal(result.rows.length,shop.examples.length);
  assert.equal(result.rows[0].merchant_name,'Example Trading Post');
  assert.equal(result.rows[0].unit_price,'50');
  const headers=shop.columns.map(c=>c.key).join(',');
  const row=shop.examples[0].join(',');
  function problemsFor(rowCsv){return parse(headers+'\r\n'+rowCsv+'\r\n',shop).problems}
  assert.ok(problemsFor(row.replace(',12,true',',1000001,true')).some(x=>/Stock quantity/.test(x.message)),'stock over cap rejected');
  assert.ok(problemsFor(row.replace(',12,true',',-2,true')).some(x=>/Stock quantity/.test(x.message)),'negative stock rejected');
  assert.ok(problemsFor(row.replace(',50,25,',',-50,25,')).some(x=>/unit_price/.test(x.message)),'negative price rejected');
  assert.ok(problemsFor(row.replace(',50,25,',',50.0000001,25,')).some(x=>/unit_price/.test(x.message)),'seven decimal places rejected');
  assert.ok(problemsFor(row.replace(',12,true',',12,yes')).some(x=>/buys_from_players/.test(x.message)),'invalid boolean rejected');
  assert.ok(problemsFor(row.replace(',GP,',',,')).some(x=>/Currency code/.test(x.message)),'missing currency rejected');
  assert.ok(problemsFor(row.replace('Example Trading Post', '').replace(',,Potion',',,Potion')).some(x=>/Merchant name or merchant ID/.test(x.message)),'missing merchant rejected');
  const duplicate=parse(headers+'\r\n'+row+'\r\n'+row+'\r\n',shop);
  assert.ok(duplicate.problems.some(x=>/Duplicate merchant\/item\/currency/.test(x.message)),'duplicate shop listing rejected');
  const oldHeader=headers.replace('currency_code','currency');
  assert.throws(()=>parse(oldHeader+'\r\n'+row+'\r\n',shop),/Missing columns|Unrecognized columns/);
  const tooMany=parse(headers+'\r\n'+Array(200).fill(row).join('\r\n')+'\r\n',shop);
  assert.ok(tooMany.problems.length>0,'duplicates in 200 rows report problems');
  assert.throws(()=>parse(headers+'\r\n'+Array(201).fill(row).join('\r\n')+'\r\n',shop),/Maximum 200 rows/);
  const Upload=req(uiPath).default;
  const html=renderToStaticMarkup(React.createElement(Upload,{
    db:{rpc:()=>Promise.reject(new Error('SSR should never query'))},
    campaign:'test-campaign',onImported:async()=>{}
  }));
  assert.match(html,/>Shop Inventory<\/button>/,'shop option shown on GM Dashboard');
  assert.doesNotMatch(html,/Confirm &amp; Replace Shop Listings/,'cannot import without preview');
}finally{
  await Promise.all([unlink(parserPath).catch(()=>{}),unlink(specsPath).catch(()=>{}),unlink(uiPath).catch(()=>{})]);
}
console.log('PASS 8.3 shop CSV: approved template schema, parser, preview/replace UI, stale protection and GM-only transactional RPC');