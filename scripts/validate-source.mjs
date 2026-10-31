import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const files=['src/main.tsx','src/Trading.tsx','src/TradeQR.tsx','src/ConnectionChecks.tsx'];
let ts;
try { ts=await import('typescript'); }
catch {
 try {
  const globalRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
  const require=createRequire(import.meta.url);
  ts=require(path.join(globalRoot,'typescript'));
 } catch { console.error('TypeScript is unavailable locally or globally; install dependencies before validation.');process.exit(2); }
}
let errors=0;for(const file of files){const code=fs.readFileSync(file,'utf8');const source=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const diagnostics=source.parseDiagnostics||[];if(diagnostics.length)for(const d of diagnostics){console.error(file,ts.flattenDiagnosticMessageText(d.messageText,' '));errors++}else console.log('PASS',file)}
process.exit(errors?1:0);
