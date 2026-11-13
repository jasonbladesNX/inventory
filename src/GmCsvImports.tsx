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
  merchant_name?:string;merchant_active?:boolean;currency_code?:string;
  unit_price?:number;buyback_price?:number;buys_from_players?:boolean;
  old_unit_price?:number|null;old_buyback_price?:number|null;
  old_quantity?:number|null;old_buys_from_players?:boolean|null;
  container_id?:string|null;container_name?:string;new_container?:boolean;
  entry_type?:'item'|'currency';
  new_quantity?:number;currency_amount?:number;old_currency_amount?:number|null;
};
type ImportResponse={
  mode:'preview'|'imported';
  row_count:number;total_units?:number;rows:PreviewRow[];
  created?:unknown[]|number;granted?:unknown[];updated?:number;stock_mode?:string;
  new_containers?:number;item_rows?:number;currency_rows?:number;
  item_mode?:string;currency_mode?:string;new_container_ids?:string[];
};
type Props={
  db:SupabaseClient;campaign:string;
  onImported:(kind:CsvImportKind)=>Promise<void>;
};
const MAX_BYTES=1024*1024;
const messages:Record<CsvImportKind,string>={
  catalog:'Create new campaign-specific item definitions. Existing names are rejected; no existing catalog entries are overwritten.',
  'character-inventory':'Grant items to existing campaign characters. Existing inventory is preserved and additional units are added.',
  'shop-stock':'Create or update listings for existing campaign merchants. Matching merchant + item + currency listings will have stock, prices and buyback settings REPLACED, not added to; unlisted merchandise stays unchanged.',
  'loot-contents':'Add item rewards and set currency amounts in existing active, unclaimed loot containers, or create new containers. Existing physical items are kept. Existing currency denominations are REPLACED, not incremented. Generate QR codes separately after reviewing the contents.'
};
const rpcNames:Record<CsvImportKind,string>={
  catalog:'gm_import_catalog_csv',
  'character-inventory':'gm_import_character_inventory_csv',
  'shop-stock':'gm_import_shop_stock_csv',
  'loot-contents':'gm_import_qr_loot_csv'
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
      if(response?.mode!=='preview'||response.row_count!==rows.length||response.rows?.length!==rows.length||
        (kind==='shop-stock'&&response.stock_mode!=='replace')||
        (kind==='loot-contents'&&(response.item_mode!=='add'||response.currency_mode!=='set')))
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
        p_campaign:campaign,p_rows:rows,p_dry_run:false,
        ...(kind==='shop-stock'||kind==='loot-contents'?{p_expected:preview.rows}:{})
      });
      if(rpcError)throw rpcError;
      const result=data as ImportResponse;
      if(result?.mode!=='imported'||result.row_count!==rows.length)
        throw Error('The import returned an unexpected result; refresh the dashboard to verify before attempting another import.');
      committed=true;
      if(serial!==request.current)return;
      const qty=kind==='catalog'?`${result.row_count} catalog item(s) created`:
        kind==='shop-stock'?`${result.created} new shop listing(s) and ${result.updated} updated listing(s)`:
        kind==='loot-contents'?`${result.new_containers} new loot container(s), ${result.item_rows} item reward row(s), and ${result.currency_rows} currency reward row(s)`:
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
          ?'Import outcome could not be confirmed. Check the affected catalog, character inventory, shop or loot containers before retrying. '
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
      <button type="button" className={kind==='shop-stock'?'is-selected':''}
        aria-pressed={kind==='shop-stock'} disabled={Boolean(working)}
        onClick={()=>selectMode('shop-stock')}>Shop Inventory</button>
      <button type="button" className={kind==='loot-contents'?'is-selected':''}
        aria-pressed={kind==='loot-contents'} disabled={Boolean(working)}
        onClick={()=>selectMode('loot-contents')}>Treasure & Loot</button>
    </div>
    <p className="nx-csv-import-tip"><Info size={16} aria-hidden="true"/>{messages[kind]}</p>
    <label className="nx-csv-import-file" htmlFor="nx-import-file">
      Select {template.title} CSV
      <input ref={fileInput} key={kind} id="nx-import-file" type="file"
        accept=".csv,text/csv" disabled={Boolean(working)}
        onChange={e=>void readFile(e)}/>
    </label>
    <p className="nx-small-note">
      Use the matching file from <strong>GM CSV Templates</strong>. Maximum {kind==='catalog'?'100 catalog items':
        kind==='shop-stock'?'200 merchant/item/currency listings; stock 0–1,000,000 per row':
        kind==='loot-contents'?'200 loot reward rows, 50 new containers, 500 units per item row and 10,000 total units':
        '200 character/item rows, 500 units per row and 10,000 units total'} per import, 1 MB per CSV.
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
      {kind==='shop-stock'&&<p className="nx-csv-shop-warning">Stock quantities and prices are <strong>replaced</strong> for matching listings.
        Merchandise not included in the file is untouched. Inactive merchants can be stocked, but remain closed to players.</p>}
      {kind==='loot-contents'&&<p className="nx-csv-shop-warning">Item quantities are <strong>added</strong> to a container; a currency amount <strong>replaces</strong> the existing amount in that denomination.
        New containers are created without QR codes. Claimed, inactive, or already-issued active QR containers cannot be imported into.</p>}
      <div className={'nx-csv-import-preview-table'+(kind==='shop-stock'?' nx-csv-shop-preview':'')}>
        {kind==='loot-contents'?<table>
          <thead><tr><th scope="col">Row</th><th scope="col">Container</th><th scope="col">Reward</th>
            <th scope="col">Current</th><th scope="col">After Import</th></tr></thead>
          <tbody>{preview.rows.map((item,index)=><tr key={index}>
            <td>{item.row}</td>
            <td><strong>{item.container_name}</strong>
              <span className="nx-csv-price-line">{item.new_container?'Create new container':'Existing active container'}</span></td>
            <td>{item.entry_type==='item'?item.item_name:`${item.currency_code} currency`}
              <span className="nx-csv-price-line">{item.entry_type==='item'?'Add items':'Set currency amount'}</span></td>
            <td>{item.entry_type==='item'?`${item.old_quantity??0} units`:
              item.old_currency_amount===null?'No currency yet':`${item.old_currency_amount} ${item.currency_code}`}</td>
            <td><strong>{item.entry_type==='item'?`${item.new_quantity} units (+${item.quantity})`:
              `${item.currency_amount} ${item.currency_code}`}</strong></td>
          </tr>)}</tbody>
        </table>:kind==='shop-stock'?<table>
          <thead><tr><th scope="col">Row / Action</th><th scope="col">Merchant</th><th scope="col">Item / Currency</th>
            <th scope="col">Currently</th><th scope="col">After Import</th></tr></thead>
          <tbody>{preview.rows.map((item,index)=><tr key={index}>
            <td>{item.row} · {item.action==='create'?'Create':'Replace'}</td>
            <td>{item.merchant_name}{item.merchant_active===false&&<span className="nx-csv-inactive-merchant"> (inactive)</span>}</td>
            <td>{item.item_name}<span className="nx-csv-price-line">{item.currency_code}</span></td>
            <td>{item.action==='create'?'No existing listing':<>
              <span>Stock: {item.old_quantity}</span>
              <span className="nx-csv-price-line">Price: {item.old_unit_price} {item.currency_code}</span>
              <span className="nx-csv-price-line">Buyback: {item.old_buyback_price} {item.currency_code}</span>
              <span className="nx-csv-price-line">Buys items: {item.old_buys_from_players?'Yes':'No'}</span>
            </>}</td>
            <td><strong>Stock: {item.quantity}</strong>
              <span className="nx-csv-price-line">Price: {item.unit_price} {item.currency_code}</span>
              <span className="nx-csv-price-line">Buyback: {item.buyback_price} {item.currency_code}</span>
              <span className="nx-csv-price-line">Buys items: {item.buys_from_players?'Yes':'No'}</span>
            </td>
          </tr>)}</tbody>
        </table>:<table>
          <thead><tr><th scope="col">Row</th><th scope="col">Action</th><th scope="col">Destination</th><th scope="col">Item</th><th scope="col">Qty / Category</th></tr></thead>
          <tbody>{preview.rows.map((item,index)=><tr key={index}>
            <td>{item.row}</td><td>{kind==='catalog'?'Create':'Grant'}</td>
            <td>{kind==='catalog'?'Campaign catalog':item.character_name}</td>
            <td>{item.item_name}</td><td>{kind==='catalog'?item.category:item.quantity}</td>
          </tr>)}</tbody>
        </table>}
      </div>
      <label className="nx-csv-import-approval">
        <input type="checkbox" checked={confirm} disabled={Boolean(working)}
          onChange={event=>setConfirm(event.target.checked)}/>
        I reviewed the preview and authorize these changes to the selected campaign.
      </label>
      <button type="button" className="nx-csv-import-confirm"
        disabled={!confirm||Boolean(working)} onClick={()=>void applyFile()}>
        {working==='import'?'Importing…':kind==='catalog'?'Confirm & Create Catalog Items':
          kind==='shop-stock'?'Confirm & Replace Shop Listings':
          kind==='loot-contents'?'Confirm & Import Loot':'Confirm & Grant Inventory Items'}
      </button>
      <p className="nx-small-note">The server validates the file again at confirmation. If any row fails, the entire import rolls back.
        Shop and loot imports compare live values against the preview and reject stale contents; character grants add to inventory and catalog imports never overwrite items. QR tokens are generated later in QR Loot Containers.</p>
    </section>}
  </section>;
}
