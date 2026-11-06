import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const target=fileURLToPath(new URL('./.effect-editor-smoke.cjs',import.meta.url));
try{
  await build({entryPoints:['src/EffectEditor.tsx'],outfile:target,bundle:true,platform:'node',format:'cjs',external:['react','react-dom'],loader:{'.css':'empty'},logLevel:'silent'});
  const require=createRequire(import.meta.url);
  const EffectEditor=require(target).default;
  const db={rpc:async()=>({data:[],error:null})};
  for(const metadata of [
    {definitions:[],attributes:[],operations:[]},
    {definitions:[{id:'def1',name:'Test Ring',category:'ring',source_info:null}],attributes:['STR','DEX'],operations:['add','set']},
    {definitions:[{id:'def1',name:'Test Ring',category:'ring',source_info:{}},null],attributes:null,operations:null},
  ]){
    const html=renderToStaticMarkup(React.createElement(EffectEditor,{
      db,campaign:'campaign1',definitions:metadata.definitions,attributes:metadata.attributes,
      operations:metadata.operations,allowEquippedCategory:false,onChanged:async()=>{}
    }));
    assert.match(html,/Equipment Effects \(GM\)/);
  }
  console.log('PASS GM editor server-render smoke tests (empty, populated, malformed metadata)');
}finally{
  await unlink(target).catch(()=>{});
}
