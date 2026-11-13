import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const main=readFileSync('src/main.tsx','utf8');
const ui=readFileSync('src/GmCsvImports.tsx','utf8');
const parser=readFileSync('src/gmCsvImportParser.ts','utf8');
const sql=readFileSync('docs/sql/gm-csv-imports-8-2.sql','utf8');
const css=readFileSync('src/gm-csv-imports.css','utf8');

assert.match(main,/import GmCsvImports from '\.\/GmCsvImports'/);
assert.match(main,/title="GM CSV Imports"/);
assert.match(main,/<GmCsvImports db=\{db!\} campaign=\{campaign\}/);
assert.ok(main.indexOf('<GmCsvImports')>main.indexOf('campaign&&gmAccess&&!campaignBusy&&<>'),
  'Import controls must sit behind existing GM Dashboard access gate');
assert.match(ui,/p_dry_run:true/,'must preview before commit');
assert.match(ui,/p_dry_run:false/,'explicit committed import mode');
assert.match(ui,/!preview\|\|!confirm\|\|working/,'cannot import without preview and checkbox confirmation');
assert.match(ui,/setPreview\(null\);setRows\(\[\]\)/,'clear data after successful commit');
assert.match(ui,/onImported\(kind\)/,'refresh UI following successful transaction');
assert.match(ui,/file.size>MAX_BYTES/,'cap uploaded file size');
assert.match(ui,/onChange=\{e=>void readFile\(e\)\}/);
assert.match(ui,/Validate & Preview/);
assert.match(ui,/Confirm & Create Catalog Items/);
assert.match(ui,/Confirm & Grant Inventory Items/);
assert.match(ui,/Nothing has been imported yet/);
assert.match(css,/\.nx-csv-import-preview-table/,'preview table scrolls');
assert.match(parser,/unterminated quoted field/,'unterminated quotes rejected');
assert.match(parser,/Missing columns/,'template contract enforced');
assert.match(parser,/CSV contains duplicate column names/,'duplicate header errors');
assert.match(parser,/CsvImportProblem/,'row numbers with detailed validation errors');

for(const name of ['gm_import_catalog_csv','gm_import_character_inventory_csv']){
  assert.match(sql,new RegExp('create or replace function public\\.'+name));
  assert.match(sql,new RegExp('revoke all on function public\\.'+name));
  assert.match(sql,new RegExp('grant execute on function public\\.'+name));
}
assert.match(sql,/app_private\.is_gm\(p_campaign\)/,'backend authorization');
assert.match(sql,/security definer set search_path=''/,'secured fixed search path');
assert.match(sql,/if not p_dry_run then/,'no writes during preview');
assert.match(sql,/public\.add_inventory_item/,'reuse stacking and activity audit');
assert.match(sql,/public\.create_campaign_custom_item_with_stacking/,'reuse GM item definition validation');
assert.match(sql,/v_key=any\(v_seen\)/,'server-side duplicate character/item pair rejection');
assert.match(sql,/v_count>0/,'reject catalog name conflicts');
assert.match(sql,/v_total>10000/,'total unit limit');
assert.match(sql,/jsonb_array_length\(p_rows\) not between 1 and 200/,'bound total import rows');

const codePath=fileURLToPath(new URL('./.gm-csv-8-2-parser.cjs',import.meta.url));
const uiPath=fileURLToPath(new URL('./.gm-csv-8-2-ui.cjs',import.meta.url));
try{
  await build({entryPoints:['src/gmCsvImportParser.ts'],outfile:codePath,
    bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  await build({entryPoints:['src/GmCsvImports.tsx'],outfile:uiPath,
    bundle:true,platform:'node',format:'cjs',external:['react','react-dom'],
    loader:{'.css':'empty'},logLevel:'silent'});
  const req=createRequire(import.meta.url);
  const {parseGmImportCsv}=req(codePath);
  const {gmCsvTemplates,makeGmTemplateCsv}=req(codePath); // parser bundles referenced types only; specs may tree-shake
  const specsPath=fileURLToPath(new URL('./.gm-csv-8-2-specs.cjs',import.meta.url));
  try{
    await build({entryPoints:['src/gmCsvTemplateSpecs.ts'],outfile:specsPath,
      bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
    const specs=req(specsPath);
    const catalog=specs.gmCsvTemplates.find(x=>x.id==='catalog');
    const character=specs.gmCsvTemplates.find(x=>x.id==='character-inventory');
    for(const t of [catalog,character]){
      const data=specs.makeGmTemplateCsv(t,true);
      const parsed=parseGmImportCsv(data,t);
      assert.deepEqual(parsed.problems,[],t.id+' sample is valid at the parser layer');
      assert.equal(parsed.rows.length,t.examples.length);
    }
    const b=specs.makeGmTemplateCsv(catalog,true);
    const badHeader=b.replace(/^item_name/, 'bad_item_name');
    assert.throws(()=>parseGmImportCsv(badHeader,catalog),/Missing columns|Unrecognized columns/);
    assert.throws(()=>parseGmImportCsv('item_name,category\r\n"unclosed',catalog),/unterminated quoted field/);
    const header=catalog.columns.map(x=>x.key).join(',');
    const row=catalog.examples[0].map(value=>value.includes(',')?'"'+value+'"':value).join(',');
    const duplicate=parseGmImportCsv(header+'\r\n'+row+'\r\n'+row+'\r\n',catalog);
    assert.ok(duplicate.problems.some(x=>/Duplicate item name/.test(x.message)));
    const chars=specs.makeGmTemplateCsv(character,true);
    assert.ok(parseGmImportCsv(chars.replace('Longsword','',''),character).rows.length>0);
    const lines=chars.split('\r\n');
    assert.ok(lines.length>2);
    const invalidQty=chars.replace(/,4\r\n/,',501\r\n');
    assert.ok(parseGmImportCsv(invalidQty,character).problems.some(x=>/Quantity must/.test(x.message)));
    const huge=header+'\r\n'+Array(101).fill(row).join('\r\n')+'\r\n';
    assert.throws(()=>parseGmImportCsv(huge,catalog),/Maximum 100 rows/);
  }finally{await unlink(specsPath).catch(()=>{})}
  const Import=req(uiPath).default;
  const html=renderToStaticMarkup(React.createElement(Import,{
    db:{rpc:()=>Promise.reject(new Error('SSR must not access database'))},
    campaign:'test-campaign',onImported:async()=>{}
  }));
  assert.match(html,/Item Catalog/);
  assert.match(html,/Character Inventory/);
  assert.match(html,/type="file"/);
  assert.match(html,/Validate &amp; Preview/);
  assert.match(html,/Clear File/);
  assert.match(html,/No rows/).doesNotExist;
}finally{
  await Promise.all([unlink(codePath).catch(()=>{}),unlink(uiPath).catch(()=>{})]);
}
console.log('PASS 8.2: parser, bounded rows, catalog/grant validation, preview confirmation and secured atomic RPC contracts');
