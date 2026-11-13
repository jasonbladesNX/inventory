import type {GmCsvTemplate} from './gmCsvTemplateSpecs';

export type CsvImportKind='catalog'|'character-inventory';
export type CsvImportRow=Record<string,string>;
export type CsvImportProblem={line:number;message:string};
export type CsvImportParseResult={
  rows:CsvImportRow[];
  problems:CsvImportProblem[];
};

const MAX_ROWS:Record<CsvImportKind,number>={catalog:100,'character-inventory':200};

function csvRecords(input:string):{cells:string[];line:number}[]{
  const text=input.replace(/^\uFEFF/,'');
  const result:{cells:string[];line:number}[]=[];
  let cells:string[]=[],field='',quoted=false,closed=false,line=1,startLine=1;
  const pushCell=()=>{cells.push(field);field='';closed=false};
  const pushRecord=()=>{
    pushCell();
    if(cells.some(c=>c.trim()!==''))result.push({cells,line:startLine});
    cells=[];
  };
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){
        if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}
      }else if(ch==='\r'){
        if(text[i+1]==='\n')i++;
        field+='\n';line++;
      }else{field+=ch;if(ch==='\n')line++}
      continue;
    }
    if(ch==='"'){
      if(field!==''||closed)throw Error(`CSV line ${line}: unexpected quote inside an unquoted field.`);
      quoted=true;continue;
    }
    if(ch===','){pushCell();continue}
    if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      pushRecord();line++;startLine=line;continue;
    }
    if(closed&&ch!==' '&&ch!=='\t')throw Error(`CSV line ${line}: unexpected text after closing quote.`);
    if(!closed)field+=ch;
  }
  if(quoted)throw Error(`CSV line ${startLine}: unterminated quoted field.`);
  if(cells.length||field!==''||closed)pushRecord();
  return result;
}

const bool=(value:string)=>value==='true'||value==='false';
const name=(row:CsvImportRow,k:string)=>row[k].trim();
const ordinary=new Set(['gear','ingredient','consumable','ammunition','material','component','misc','supplies']);
const special=new Set(['weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','container','recipe']);

export function parseGmImportCsv(input:string,template:GmCsvTemplate):CsvImportParseResult{
  if(template.id!=='catalog'&&template.id!=='character-inventory'){
    throw Error('Uploads for this template are not enabled yet.');
  }
  const mode=template.id;
  const recs=csvRecords(input);
  if(!recs.length)throw Error('CSV is empty. Download a blank template to see the required columns.');
  const keys=template.columns.map(c=>c.key);
  const headers=recs[0].cells.map(h=>h.trim());
  if(new Set(headers).size!==headers.length)throw Error('CSV contains duplicate column names.');
  const missing=keys.filter(k=>!headers.includes(k));
  const unknown=headers.filter(k=>!keys.includes(k));
  if(missing.length||unknown.length){
    throw Error([
      missing.length?`Missing columns: ${missing.join(', ')}`:'',
      unknown.length?`Unrecognized columns: ${unknown.join(', ')}`:''
    ].filter(Boolean).join('. ')+'. Use the current GM CSV template.');
  }
  if(recs.length<2)throw Error('This CSV has a header but no item rows.');
  if(recs.length-1>MAX_ROWS[mode])throw Error(`Maximum ${MAX_ROWS[mode]} rows per ${mode==='catalog'?'catalog':'character inventory'} import.`);

  const problems:CsvImportProblem[]=[];
  const rows:CsvImportRow[]=[];
  const seenNames=new Set<string>();
  let totalUnits=0;
  for(const rec of recs.slice(1)){
    if(rec.cells.length!==headers.length){
      problems.push({line:rec.line,message:`Expected ${headers.length} columns; found ${rec.cells.length}.`});
      continue;
    }
    const row:Object=Object.fromEntries(headers.map((key,i)=>[key,rec.cells[i].trim()]));
    const record=row as CsvImportRow;
    const messages:string[]=[];
    if(mode==='catalog'){
      if(name(record,'item_name').length<2||name(record,'item_name').length>120)messages.push('Item name must have 2–120 characters.');
      if(!name(record,'category'))messages.push('Item category is required.');
      if(record.description.length>3000)messages.push('Description exceeds 3000 characters.');
      for(const flag of ['stackable','consumable']){
        if(!bool(name(record,flag).toLowerCase()))messages.push(`${flag} must be true or false.`);
      }
      const handed=name(record,'two_handed').toLowerCase();
      if(handed!==''&&!bool(handed))messages.push('two_handed must be true, false or blank.');
      const category=name(record,'category').toLowerCase();
      const consumable=name(record,'consumable').toLowerCase()==='true';
      const stackable=name(record,'stackable').toLowerCase()==='true';
      if(consumable&&!stackable)messages.push('Consumables must be stackable.');
      if(category==='consumable'&&!consumable)messages.push('Category consumable requires consumable=true.');
      if(special.has(category)&&stackable)messages.push('Equippable and special items cannot stack.');
      if(special.has(category)&&consumable)messages.push('This item category cannot be consumable.');
      if(handed==='true'&&category!=='weapon')messages.push('Two-handed is only valid for weapons.');
      const bonusName=name(record,'bonus_attribute'),bonusAmount=name(record,'bonus_amount');
      if(Boolean(bonusName)!==Boolean(bonusAmount))messages.push('Bonus attribute and amount must be given together.');
      if(bonusName&&!/^[a-z][a-z0-9_]{1,24}$/i.test(bonusName))messages.push('Bonus attribute has an invalid code.');
      if(bonusAmount&&(!/^[+-]?[0-9]+(\.[0-9]+)?$/.test(bonusAmount)||!Number.isFinite(Number(bonusAmount))||Math.abs(Number(bonusAmount))>1000))messages.push('Bonus amount is invalid or exceeds ±1000.');
      if(consumable&&(bonusName||bonusAmount))messages.push('Consumables cannot have equipment bonuses.');
      const key=name(record,'item_name').toLowerCase();
      if(seenNames.has(key))messages.push('Duplicate item name in CSV.');
      else seenNames.add(key);
    }else{
      if(!name(record,'character_id')&&!name(record,'character_name'))messages.push('Character name or character ID is required.');
      if(!name(record,'item_definition_id')&&!name(record,'item_name'))messages.push('Item name or item definition ID is required.');
      for(const key of ['character_id','item_definition_id']){
        const id=name(record,key);
        if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))messages.push(`${key} must be a UUID.`);
      }
      const quantity=name(record,'quantity');
      if(!/^[0-9]{1,3}$/.test(quantity)||Number(quantity)<1||Number(quantity)>500)messages.push('Quantity must be a whole number from 1 to 500.');
      else totalUnits+=Number(quantity);
    }
    for(const message of messages)problems.push({line:rec.line,message});
    rows.push(record);
  }
  if(mode==='character-inventory'&&totalUnits>10000)problems.push({line:0,message:'The file exceeds 10,000 total item units.'});
  return {rows,problems};
}
