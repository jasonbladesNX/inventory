import React,{useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AlertTriangle,CheckCircle2,FileSpreadsheet,Info,UploadCloud} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import {gmCsvTemplates,type GmCsvTemplate} from './gmCsvTemplateSpecs';
import {parseGmImportCsv,type CsvImportKind,type CsvImportProblem,type CsvImportRow} from './gmCsvImportParser';
import './gm-csv-imports.css';

type PreviewRow={
  row:number;action:string;
  item_name:string;category?:string;character_name?:string;quantity?:number;
};
type ImportResponse={
  mode:'preview'|'imported';
  row_count:number;total_units?:number;rows:PreviewRow[];
  created?:unknown[];granted?:unknown[];
};
type Props={
  db:SupabaseClient;campaign:string;
  onImported:(kind:CsvImportKind)=>Promise<void>;
};
const MAX_BYTES=1024*1024;
const messages:Record<CsvImportKind,string>={
  catalog:'Create new campaign-specific item definitions. Existing names are rejected; no existing catalog entries are overwritten.',
  'character-inventory':'Grant items to existing campaign characters. Existing inventory is preserved and additional units are added.'
};
const rpcNames:Record<CsvImportKind,string>={
  catalog:'gm_import_catalog_csv',
  'character-inventory':'gm_import_character_inventory_csv'
};

export default function GmCsvImports({db,campaign,onImported}:Props){
  const [kind,setKind]=useState<CsvImportKind>('catalog');
  const [fileName,setFileName]=useState('');
  const [rows,setRows]=useState<CsvImportRow[]>([]);
  const [problems,setProblems]=useState<CsvImportProblem[]>([]);
  const [preview,setPreview]=useState<ImportResponse|null>(null);
  const [confirm,setConfirm]=useState(false);
  const [working,setWorking]=useState<'reading'|'preview'|'import'|null>(null);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const request=useRef(0);
  const fileInput=useRef<HTMLInputElement>(null);
  const template=gmCsvTemplates.find(t=>t.id===kind) as GmCsvTemplate;
  const reset=()=>{
    request.current++;
    setFileName('');setRows([]);setProblems([]);setPreview(null);
    setConfirm(false);setWorking(null);setError('');setSuccess('');
    if(fileInput.current)fileInput.current.value='';
  };
  const selectMode=(next:CsvImportKind)=>{if(next!==kind){reset();setKind(next)}};

  const readFile=async(event:React.ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];
    reset();
    if(!file)return;
    const serial=++request.current;
    setFileName(file.name);setWorking('reading');
    try{
      if(!file.name.toLowerCase().endsWith('.csv'))throw Error('Select a .csv file, not a spreadsheet workbook or ZIP file.');
      if(file.size>MAX_BYTES)throw Error('CSV file exceeds 1 MB. Divide it into smaller imports.');
      const text=await file.text();
      if(serial!==request.current)return;
      const parsed=parseGmImportCsv(text,template);
      setRows(parsed.rows);setProblems(parsed.problems);
      if(parsed.problems.length)setError(`Correct ${parsed.problems.length} issue(s) below, then choose the file again.`);
    }catch(e){if(serial===request.current)setError(inventoryErrorMessage(e))}
    finally{if(serial===request.current)setWorking(null)}
  };
  const previewFile=async()=>{
    if(working||!rows.length||problems.length)return;
    const serial=request.current;
    setWorking('preview');setError('');setSuccess('');setPreview(null);setConfirm(false);
    try{
      const {data,error:rpcError}=await db.rpc(rpcNames[kind],{
        p_campaign:campaign,p_rows:rows,p_dry_run:true
      });
      if(rpcError)throw rpcError;
      if(serial!==request.current)return;
      const response=data as ImportResponse;
      if(response?.mode!=='preview'||response.row_count!==rows.length||response.rows?.length!==rows.length)
        throw Error('The server returned an incomplete preview. No changes were made.');
      setPreview(response);
    }catch(e){if(serial===request.current)setError('Preview failed. No records were changed. '+inventoryErrorMessage(e))}
    finally{if(serial===request.current)setWorking(null)}
  };
  const applyFile=async()=>{
    if(!preview||!confirm||working||!rows.length||problems.length)return;
    const serial=request.current;
    setWorking('import');setError('');setSuccess('');
    let committed=false;
    try{
      const {data,error:rpcError}=await db.rpc(rpcNames[kind],{
        p_campaign:campaign,p_rows:rows,p_dry_run:false
      });
      if(rpcError)throw rpcError;
      const result=data as ImportResponse;
      if(result?.mode!=='imported'||result.row_count!==rows.length)
        throw Error('The import returned an unexpected result; refresh the dashboard to verify before attempting another import.');
      committed=true;
      if(serial!==request.current)return;
      const qty=kind==='catalog'?`${result.row_count} catalog item(s) created`:
        `${result.total_units} unit(s) granted across ${result.row_count} row(s)`;
      setSuccess(`Import successful: ${qty}. The batch was committed as one transaction.`);
      setPreview(null);setRows([]);setFileName('');setConfirm(false);
      if(fileInput.current)fileInput.current.value='';
      try{await onImported(kind)}
      catch{setSuccess(`Import successful: ${qty}. The dashboard could not refresh automatically; reopen the character or campaign to view the changes.`)}
    }catch(e){
      if(serial===request.current){
        const detail=inventoryErrorMessage(e);
        const uncertain=/network|failed to fetch|connection|timeout|abort/i.test(detail);
        setError((committed||uncertain
          ?'Import outcome could not be confirmed. Check the catalog or character inventory before retrying. '
          :'Import rejected; the server rolled back all rows. ')+detail);
      }
    }finally{if(serial===request.current)setWorking(null)}
  };

  return <section className="nx-page-card nx-gm-tools nx-gm-csv-imports" aria-label="GM CSV Imports">
    <h2><UploadCloud size={20} aria-hidden="true"/> GM CSV Imports</h2>
    <p>Upload a CSV, validate every row, review the resolved changes and explicitly confirm the import. A rejected row prevents the entire batch from being applied.</p>
    <div className="nx-csv-import-kind" role="group" aria-label="CSV import type">
      <button type="button" className={kind==='catalog'?'is-selected':''}
        aria-pressed={kind==='catalog'} disabled={Boolean(working)} onClick={()=>selectMode('catalog')}>Item Catalog</button>
      <button type="button" className={kind==='character-inventory'?'is-selected':''}
        aria-pressed={kind==='character-inventory'} disabled={Boolean(working)}
        onClick={()=>selectMode('character-inventory')}>Character Inventory</button>
    </div>
    <p className="nx-csv-import-tip"><Info size={16} aria-hidden="true"/>{messages[kind]}</p>
    <label className="nx-csv-import-file" htmlFor="nx-import-file">
      Select {template.title} CSV
      <input ref={fileInput} key={kind} id="nx-import-file" type="file"
        accept=".csv,text/csv" disabled={Boolean(working)}
        onChange={e=>void readFile(e)}/>
    </label>
    <p className="nx-small-note">
      Use the matching file from <strong>GM CSV Templates</strong>. Maximum {kind==='catalog'?'100 catalog items':'200 character/item rows, 500 units per row and 10,000 units total'} per import, 1 MB per CSV.
      Files are read locally first; only validated rows are sent for the server preview.
    </p>
    {fileName&&<p className="nx-csv-import-meta"><FileSpreadsheet size={16} aria-hidden="true"/>
      <strong>{fileName}</strong><span>{rows.length} data row(s)</span>
    </p>}
    {problems.length>0&&<section className="nx-csv-import-problems" aria-label="CSV row errors" role="alert">
      <strong><AlertTriangle size={16} aria-hidden="true"/> {problems.length} validation issue(s)</strong>
      <ul>{problems.slice(0,40).map((p,i)=><li key={i}>{p.line?`Line ${p.line}`:'File'}: {p.message}</li>)}</ul>
      {problems.length>40&&<p>And {problems.length-40} additional issues. Fix the file before importing.</p>}
    </section>}
    {error&&<p className="nx-csv-import-error" role="alert">{error}</p>}
    {success&&<p className="nx-csv-import-success" role="status"><CheckCircle2 size={17} aria-hidden="true"/>{success}</p>}
    <div className="nx-csv-import-actions">
      <button type="button" disabled={Boolean(working)||rows.length===0||problems.length>0}
        onClick={()=>void previewFile()}>{working==='preview'?'Checking…':'Validate & Preview'}</button>
      <button type="button" className="nx-csv-import-clear" disabled={Boolean(working)} onClick={reset}>Clear File</button>
    </div>
    {preview&&<section className="nx-csv-import-preview" aria-label="Import preview">
      <h3><CheckCircle2 size={17} aria-hidden="true"/> Server Validation Passed</h3>
      <p><strong>{preview.row_count} row(s) ready</strong>
        {kind==='character-inventory'?` · ${preview.total_units} total units`:''}. Nothing has been imported yet.</p>
      <div className="nx-csv-import-preview-table">
        <table>
          <thead><tr><th scope="col">Row</th><th scope="col">Action</th><th scope="col">Destination</th><th scope="col">Item</th><th scope="col">Qty / Category</th></tr></thead>
          <tbody>{preview.rows.map((item,index)=><tr key={index}>
            <td>{item.row}</td><td>{kind==='catalog'?'Create':'Grant'}</td>
            <td>{kind==='catalog'?'Campaign catalog':item.character_name}</td>
            <td>{item.item_name}</td><td>{kind==='catalog'?item.category:item.quantity}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <label className="nx-csv-import-approval">
        <input type="checkbox" checked={confirm} disabled={Boolean(working)}
          onChange={event=>setConfirm(event.target.checked)}/>
        I reviewed the preview and authorize these changes to the selected campaign.
      </label>
      <button type="button" className="nx-csv-import-confirm"
        disabled={!confirm||Boolean(working)} onClick={()=>void applyFile()}>
        {working==='import'?'Importing…':kind==='catalog'? 'Confirm & Create Catalog Items':'Confirm & Grant Inventory Items'}
      </button>
      <p className="nx-small-note">The server validates the file again at confirmation. If any row fails, the entire import is rolled back. Character grants add to existing inventory; catalog imports never overwrite existing items.</p>
    </section>}
  </section>;
}
