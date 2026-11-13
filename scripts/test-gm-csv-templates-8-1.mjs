import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';

const app=readFileSync('src/main.tsx','utf8');
const source=readFileSync('src/gmCsvTemplateSpecs.ts','utf8');
const componentSource=readFileSync('src/GmCsvTemplates.tsx','utf8');
const css=readFileSync('src/gm-csv-templates.css','utf8');
const expected=['catalog','character-inventory','shop-stock','loot-contents'];
assert.match(app,/import GmCsvTemplates from '\.\/GmCsvTemplates';/);
assert.match(app,/<GmDashboardCard key=\{'csv-templates-'\+campaign\} title="GM CSV Templates">/);
assert.match(app,/<GmCsvTemplates\/>/);
const gated=app.indexOf('{campaign&&gmAccess&&!campaignBusy&&<>');
const panel=app.indexOf('<GmCsvTemplates/>');
assert.ok(gated>=0&&panel>gated,'GM template interface must be inside GM authorization gate');
assert.doesNotMatch(componentSource,/db\.rpc\(|\.from\(|type="file"|uploadCsv|importCsv/,'8.1 must not upload or write any data');
assert.match(source,/URL\.createObjectURL\(new Blob/,'generates browser downloads');
assert.ok(source.includes(String.raw`\uFEFF`),'Excel-friendly UTF-8 BOM');
assert.match(source,/link\.download='nexus-gm-'/,'predictable CSV file naming');
assert.match(css,/\.nx-gm-csv-grid/,'responsive grid');

const path=fileURLToPath(new URL('./.gm-csv-contracts-smoke.cjs',import.meta.url));
const uiPath=fileURLToPath(new URL('./.gm-csv-ui-smoke.cjs',import.meta.url));
function parseCsv(csv){
  const out=[];
  let row=[],field='',quoted=false;
  for(let i=0;i<csv.length;i++){
    const ch=csv[i];
    if(ch==='"'){
      if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted;
    }else if(ch===','&&!quoted){row.push(field);field=''}
    else if(ch==='\n'&&!quoted){row.push(field);out.push(row);row=[];field=''}
    else if(ch==='\r'&&!quoted){continue}
    else field+=ch;
  }
  assert.equal(quoted,false,'CSV quotes must close');
  if(field||row.length){row.push(field);out.push(row)}
  return out;
}
try{
  await build({entryPoints:['src/gmCsvTemplateSpecs.ts'],outfile:path,
    bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  await build({entryPoints:['src/GmCsvTemplates.tsx'],outfile:uiPath,
    bundle:true,platform:'node',format:'cjs',external:['react','react-dom'],
    loader:{'.css':'empty'},logLevel:'silent'});
  const require=createRequire(import.meta.url);
  const {gmCsvTemplates,makeGmTemplateCsv}=require(path);
  assert.deepEqual(gmCsvTemplates.map(t=>t.id),expected,'all four import classes have templates');
  for(const template of gmCsvTemplates){
    assert.ok(template.title.length>4&&template.summary.length>15);
    assert.ok(template.notes.length>=2);
    const headers=template.columns.map(c=>c.key);
    assert.equal(headers.length,new Set(headers).size,'unique header keys '+template.id);
    for(const col of template.columns){
      assert.match(col.key,/^[a-z][a-z0-9_]*$/,'snake-case heading');
      assert.ok(col.description.length>15,'every field has usable instructions');
    }
    const blank=makeGmTemplateCsv(template,false);
    const example=makeGmTemplateCsv(template,true);
    assert.ok(blank.endsWith('\r\n')&&example.endsWith('\r\n'),'spreadsheet CSV line endings');
    assert.deepEqual(parseCsv(blank),[headers],template.id+' blank CSV only has headers');
    assert.deepEqual(parseCsv(example),[headers,...template.examples],template.id+' examples round trip correctly');
    assert.ok(template.examples.length>=2,'example files have instructional rows');
  }
  const catalog=gmCsvTemplates[0];
  for(const field of ['item_name','category','description','stackable','consumable','two_handed','bonus_attribute','bonus_amount'])
    assert.ok(catalog.columns.some(c=>c.key===field),'catalog schema contains '+field);
  const char=gmCsvTemplates[1];
  for(const field of ['character_name','character_id','item_name','item_definition_id','quantity'])
    assert.ok(char.columns.some(c=>c.key===field),'character grant schema contains '+field);
  const shop=gmCsvTemplates[2];
  for(const field of ['merchant_name','merchant_id','item_name','item_definition_id','currency_code','unit_price','buyback_price','quantity','buys_from_players'])
    assert.ok(shop.columns.some(c=>c.key===field),'shop schema contains '+field);
  const loot=gmCsvTemplates[3];
  for(const field of ['container_name','container_id','entry_type','item_name','item_definition_id','quantity','currency_code','currency_amount'])
    assert.ok(loot.columns.some(c=>c.key===field),'loot schema contains '+field);
  const typeIndex=loot.columns.findIndex(c=>c.key==='entry_type');
  assert.ok(loot.examples.some(row=>row[typeIndex]==='item')&&loot.examples.some(row=>row[typeIndex]==='currency'),
    'loot example explains both item and currency rewards');
  assert.ok(makeGmTemplateCsv(catalog,true).includes('"A small ration pack, suitable for a long trek."'),
    'sample CSV quotes commas safely');

  const GMTemplates=require(uiPath).default;
  const html=renderToStaticMarkup(React.createElement(GMTemplates));
  for(const t of gmCsvTemplates){
    const escapedTitle=t.title.replaceAll('&','&amp;');
    assert.ok(html.includes(escapedTitle),'GM interface contains '+t.title);
    assert.ok(html.includes('Download blank '+escapedTitle+' CSV template'),'blank download accessibility');
    assert.ok(html.includes('Download example '+escapedTitle+' CSV template'),'example download accessibility');
  }
  assert.equal((html.match(/Blank CSV<\/button>/g)||[]).length,4);
  assert.equal((html.match(/Example CSV<\/button>/g)||[]).length,4);
  assert.match(html,/downloads only/,'8.1 correctly describes downloads as separate from imports');
  assert.match(html,/View columns and instructions/,'field guide is discoverable');
  assert.doesNotMatch(html,/type="file"/,'no upload input in milestone 8.1');
}finally{
  await Promise.all([unlink(path).catch(()=>{}),unlink(uiPath).catch(()=>{})]);
}
console.log('PASS 8.1: four schema types, blank/sample downloads, quoting, GM-only Dashboard and no import side effects');
