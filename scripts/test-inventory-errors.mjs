import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync('src/inventoryErrors.ts','utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {inventoryErrorMessage}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const capacity='Container capacity exceeded: 0 lb + 20 lb exceeds 6 lb';
for(const input of [
  {message:capacity,code:'P0001'},
  {message:'[object Object]',details:capacity},
  {error:{message:capacity}},
  JSON.stringify({error:{message:capacity}}),
]){
  const text=inventoryErrorMessage(input);
  assert.match(text,/20 lb/);
  assert.match(text,/6 lb/);
  assert.doesNotMatch(text,/\[object Object\]/);
}
assert.match(inventoryErrorMessage({message:'Container contains items with unknown weights'}),/no recorded weight/);
assert.match(inventoryErrorMessage({message:'Item weight is missing or invalid; set its weight before storing'}),/no valid weight/);
assert.match(inventoryErrorMessage({message:'[object Object]'}),/Unable to complete/);
assert.match(inventoryErrorMessage({details:'Not authorized'}),/Not authorized/);
console.log('Storage error formatting regression checks passed');
