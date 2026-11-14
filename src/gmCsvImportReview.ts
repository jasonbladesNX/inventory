import type {CsvImportKind,CsvImportParseResult,CsvImportProblem,CsvImportRow} from './gmCsvImportParser';

export type CsvDuplicateStrategy='reject'|'first'|'last'|'combine';
export type CsvDuplicateGroup={key:string;lines:number[];label:string;canCombine:boolean};
export type CsvDuplicateDecision={line:number;keptLine:number;action:'dropped'|'combined'|'replaced';message:string};
export type CsvImportReview={
  effectiveRows:CsvImportRow[];
  sourceLines:number[];
  problems:CsvImportProblem[];
  groups:CsvDuplicateGroup[];
  decisions:CsvDuplicateDecision[];
  originalCount:number;
};
const low=(v:string|undefined)=>(v??'').trim().toLowerCase();
const display=(v:string|undefined)=>(v??'').trim();
const ref=(row:CsvImportRow,id:string,name:string)=>low(row[id])||low(row[name]);
const duplicateMessages=/^Duplicate (item name in CSV|merchant\/item\/currency listing in CSV|container\/item reward|container\/currency reward)/;

const keyFor=(row:CsvImportRow,kind:CsvImportKind)=>{
  if(kind==='catalog')return 'catalog:'+low(row.item_name);
  if(kind==='character-inventory')return 'character:'+ref(row,'character_id','character_name')+'|item:'+ref(row,'item_definition_id','item_name');
  if(kind==='shop-stock')return 'merchant:'+ref(row,'merchant_id','merchant_name')+'|item:'+ref(row,'item_definition_id','item_name')+'|currency:'+low(row.currency_code);
  return 'container:'+ref(row,'container_id','container_name')+'|'+low(row.entry_type)+':'+(low(row.entry_type)==='currency'?low(row.currency_code):ref(row,'item_definition_id','item_name'));
};
const labelFor=(row:CsvImportRow,kind:CsvImportKind)=>{
  if(kind==='catalog')return display(row.item_name);
  if(kind==='character-inventory')return (display(row.character_name)||display(row.character_id))+' / '+(display(row.item_name)||display(row.item_definition_id));
  if(kind==='shop-stock')return (display(row.merchant_name)||display(row.merchant_id))+' / '+(display(row.item_name)||display(row.item_definition_id))+' / '+display(row.currency_code);
  return (display(row.container_name)||display(row.container_id))+' / '+
    (low(row.entry_type)==='currency'?display(row.currency_code):(display(row.item_name)||display(row.item_definition_id)));
};
export function getGmCsvDuplicateGroups(
  rows:readonly CsvImportRow[],sourceLines:readonly number[],kind:CsvImportKind
):CsvDuplicateGroup[]{
  const keys=new Map<string,number[]>();
  rows.forEach((row,i)=>{
    const k=keyFor(row,kind),arr=keys.get(k)||[];
    arr.push(i);keys.set(k,arr);
  });
  const out:CsvDuplicateGroup[]=[];
  for(const indexes of keys.values()){
    if(indexes.length<2)continue;
    const row=rows[indexes[0]];
    out.push({key:keyFor(row,kind),lines:indexes.map(i=>sourceLines[i]??(i+2)),
      label:labelFor(row,kind),
      canCombine:kind==='character-inventory'||(kind==='loot-contents'&&low(row.entry_type)==='item')});
  }
  return out;
}

export function reviewGmCsvImport(
  parsed:CsvImportParseResult,kind:CsvImportKind,strategy:CsvDuplicateStrategy
):CsvImportReview{
  const lines=parsed.lineNumbers.length===parsed.rows.length?parsed.lineNumbers:parsed.rows.map((_,i)=>i+2);
  const groups=getGmCsvDuplicateGroups(parsed.rows,lines,kind);
  const problems=[...parsed.problems.filter(p=>!duplicateMessages.test(p.message))];
  const decisions:CsvDuplicateDecision[]=[];
  const kept=new Map<number,CsvImportRow>();
  parsed.rows.forEach((row,i)=>kept.set(i,{...row}));
  const keys=new Map<string,number[]>();
  parsed.rows.forEach((row,i)=>{const k=keyFor(row,kind);const arr=keys.get(k)||[];arr.push(i);keys.set(k,arr)});
  for(const group of groups){
    const indexes=keys.get(group.key)!;
    if(strategy==='reject'){
      for(const i of indexes.slice(1))problems.push({line:lines[i],message:
        'Duplicate '+group.label+' (also on line '+lines[indexes[0]]+'). Choose a duplicate resolution mode or fix the file.'});
      continue;
    }
    const primary=strategy==='last'?indexes[indexes.length-1]:indexes[0];
    for(const i of indexes){
      if(i===primary)continue;
      if(strategy==='combine'&&group.canCombine){
        const first=kept.get(primary)!;
        const addition=Number(parsed.rows[i].quantity);
        const sum=Number(first.quantity)+addition;
        if(!Number.isSafeInteger(sum)||sum>500||sum<1){
          problems.push({line:lines[i],message:
            'Cannot combine '+group.label+': resulting quantity '+sum+' exceeds the 1–500 per-row limit. Split into different imports.'});
          continue;
        }
        first.quantity=String(sum);
        kept.delete(i);
        decisions.push({line:lines[i],keptLine:lines[primary],action:'combined',
          message:'Combined quantity from line '+lines[i]+' into line '+lines[primary]+'. Total: '+sum+'.'});
      }else{
        const keepLast=strategy==='last'||(strategy==='combine'&&!group.canCombine);
        if(keepLast){
          // Keep last is explicit for currency rows when combining loot items.
          // Processing this group from first to last must retain the final occurrence.
          if(strategy==='combine'&&!group.canCombine){
            const last=indexes[indexes.length-1];
            if(i===last)continue;
            kept.delete(i);
            decisions.push({line:lines[i],keptLine:lines[last],action:'replaced',
              message:'Kept the last currency amount on line '+lines[last]+'; excluded line '+lines[i]+'.'});
            continue;
          }
        }
        kept.delete(i);
        decisions.push({line:lines[i],keptLine:lines[primary],action:'dropped',
          message:'Kept line '+lines[primary]+'; excluded duplicate line '+lines[i]+'.'});
      }
    }
    if(strategy==='combine'&&!group.canCombine){
      // If the group has two records, loop above already dropped earlier ones;
      // for >2, all except the last are dropped by explicit currency overwrite.
    }
  }
  // Client row ordering is stable, and server preview line references follow retained row order.
  const remaining=[...kept.entries()].sort((a,b)=>a[0]-b[0]);
  const effectiveRows=remaining.map(([_,row])=>row);
  const sourceLines=remaining.map(([i])=>lines[i]);
  // Resolved totals must still honor server limits.
  if(kind==='character-inventory'||kind==='loot-contents'){
    const total=effectiveRows.reduce((sum,row)=>
      sum+((kind==='character-inventory'||low(row.entry_type)==='item')?Number(row.quantity):0),0);
    // Original parsed-file total can legitimately exceed 10k only when the GM
    // explicitly excludes rows. The resolved batch is the authoritative limit.
    const filtered=problems.filter(p=>p.message!=='The file exceeds 10,000 total item units.');
    problems.splice(0,problems.length,...filtered);
    if(total>10000)problems.push({line:0,message:'The resolved import exceeds 10,000 total item units.'});
  }
  return {effectiveRows,sourceLines,problems:problems.sort((a,b)=>a.line-b.line),
    groups,decisions,originalCount:parsed.rows.length};
}

/** Reports intentionally exclude raw player/GM inventory content and CSV bearer tokens. */
export type CsvReportEntry={line:number;status:'error'|'resolution'|'imported';message:string;action?:string};
const safeReportCell=(value:string)=>{
  // Prevent spreadsheet formula execution in downloaded diagnostics.
  const normalized=value.replace(/\r\n?/g,'\n');
  const safe=/^[\s]*[=+\-@]/.test(normalized)?"'"+normalized:normalized;
  return /[",\n]/.test(safe)?'"'+safe.replace(/"/g,'""')+'"':safe;
};
export function makeGmCsvReport(
  filename:string,kind:CsvImportKind,entries:readonly CsvReportEntry[]
):string{
  const lines=[['file','import_type','csv_line','status','details','recommended_action'],
    ...entries.map(e=>[filename,kind,e.line>0?String(e.line):'File',e.status,e.message,
      e.action??(e.status==='error'?'Correct the file, then validate again.':'')])];
  return '\uFEFF'+lines.map(line=>line.map(safeReportCell).join(',')).join('\r\n')+'\r\n';
}
export function saveGmCsvReport(csv:string,filename:string):void{
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=filename;
  document.body.appendChild(link);
  link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export function gmCsvReportName(filename:string,suffix:'errors'|'receipt'):string{
  const clean=filename.replace(/\.csv$/i,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,70)||'nexus-gm-import';
  return clean+'-'+suffix+'.csv';
}
