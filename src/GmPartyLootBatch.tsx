import React,{useEffect,useMemo,useState} from 'react';
import type{SupabaseClient}from '@supabase/supabase-js';
import{Plus,Trash2,ClipboardCheck}from'lucide-react';
import{inventoryErrorMessage}from'./inventoryErrors';
import './gm-party-loot-batch.css';

type BankItem={id:string;name:string;quantity:number};
type Recipient={character_id:string;name:string};
type Row={key:number;item_id:string;character_id:string;quantity:string};
type Allocation={item_id:string;character_id:string;quantity:number;expected_quantity:number};
type Preview={allocation_count:number;allocations:{item_id:string;item_name:string;recipient:string;quantity:number;expected_stock:number}[]};
let nextRowKey=0;
export default function GmPartyLootBatch({db,party,bankItems,members,onApplied}:{
 db:SupabaseClient;party:string;bankItems:BankItem[];members:Recipient[];onApplied:()=>Promise<void>;
}){
 const[rows,setRows]=useState<Row[]>([{key:++nextRowKey,item_id:'',character_id:'',quantity:'1'}]);
 const[preview,setPreview]=useState<Preview|null>(null);
 const[previewKey,setPreviewKey]=useState('');
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const[notice,setNotice]=useState('');
 useEffect(()=>{setRows([{key:++nextRowKey,item_id:'',character_id:'',quantity:'1'}]);setPreview(null);setPreviewKey('');setError('');setNotice('')},[party]);
 const allocation=useMemo(()=>{
  if(!bankItems.length||!members.length||rows.some(r=>
   !r.item_id||!r.character_id||!Number.isFinite(Number(r.quantity))||
   Number(r.quantity)<=0||!bankItems.some(i=>i.id===r.item_id)||
   !members.some(m=>m.character_id===r.character_id)))return null;
  return rows.map(r=>({
   item_id:r.item_id,character_id:r.character_id,quantity:Number(r.quantity),
   expected_quantity:Number(bankItems.find(i=>i.id===r.item_id)?.quantity??0)
  })) as Allocation[];
 },[rows,bankItems,members]);
 const overAllocated=allocation!==null&&bankItems.some(item=>
  allocation.filter(a=>a.item_id===item.id).reduce((sum,a)=>sum+a.quantity,0)>item.quantity);
 const key=allocation?JSON.stringify({party,allocation}):'';
 const valid=allocation!==null&&!overAllocated&&allocation.length>0&&allocation.length<=25;
 function edit(rowKey:number,part:Partial<Row>){
  setRows(previous=>previous.map(row=>row.key===rowKey?{...row,...part}:row));
  setPreview(null);setPreviewKey('');setNotice('');
 }
 async function invoke(apply:boolean){
  if(busy||!valid||!allocation)return;
  if(apply&&(!preview||previewKey!==key))return;
  if(apply&&!window.confirm('Confirm all '+allocation.length+' loot allocations? They will be transferred together, and any failure will roll back the entire batch.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const{data,error:e}=await db.rpc('batch_distribute_party_bank_loot',{
    p_party:party,p_allocations:allocation,p_apply:apply
   });
   if(e)throw e;
   if(apply){
    setPreview(null);setPreviewKey('');
    setRows([{key:++nextRowKey,item_id:'',character_id:'',quantity:'1'}]);
    await onApplied();
    setNotice('All '+allocation.length+' allocations were distributed.');
   }else{
    setPreview(data as Preview);setPreviewKey(key);
    setNotice('Preview validated. Confirm distribution to transfer these items.');
   }
  }catch(e){setPreview(null);setPreviewKey('');setError(inventoryErrorMessage(e))}
  finally{setBusy(false)}
 }
 return <section className="nx-loot-batch" aria-label="GM batch party loot distribution">
  <h3>Batch Party Loot Distribution</h3>
  <p>Allocate multiple shared-bank item quantities to party members. Preview first; the entire confirmed batch succeeds or fails together. Between sessions only.</p>
  {rows.map((row,i)=><div className="nx-loot-batch-row" key={row.key}>
   <strong>Allocation {i+1}</strong>
   <label>Bank item<select value={row.item_id} disabled={busy} onChange={e=>edit(row.key,{item_id:e.target.value})}>
    <option value="">Select item…</option>
    {bankItems.map(item=><option key={item.id} value={item.id}>{item.name} (stock {item.quantity})</option>)}
   </select></label>
   <label>Recipient<select value={row.character_id} disabled={busy} onChange={e=>edit(row.key,{character_id:e.target.value})}>
    <option value="">Select member…</option>
    {members.map(m=><option key={m.character_id} value={m.character_id}>{m.name}</option>)}
   </select></label>
   <label>Quantity<input type="number" min="0.000001" step="any" value={row.quantity} disabled={busy}
    onChange={e=>edit(row.key,{quantity:e.target.value})}/></label>
   <button type="button" disabled={busy||rows.length===1}
    onClick={()=>{setRows(v=>v.filter(r=>r.key!==row.key));setPreview(null);setPreviewKey('')}} aria-label={'Remove allocation '+(i+1)}>
    <Trash2 size={15}/> Remove
   </button>
  </div>)}
  {overAllocated&&<p className="nx-loot-batch-error" role="alert">Total allocated quantity exceeds the current stock of at least one item.</p>}
  <div className="nx-loot-batch-actions">
   <button type="button" disabled={busy||rows.length>=25}
    onClick={()=>{setRows(v=>[...v,{key:++nextRowKey,item_id:'',character_id:'',quantity:'1'}]);setPreview(null);setPreviewKey('')}}>
    <Plus size={15}/> Add Allocation
   </button>
   <button type="button" disabled={busy||!valid} onClick={()=>void invoke(false)}>
    <ClipboardCheck size={15}/> Preview All
   </button>
  </div>
  {preview&&previewKey===key&&<div className="nx-loot-batch-preview">
   <strong>Validated Preview — {preview.allocation_count} Allocations</strong>
   {preview.allocations.map((a,i)=><p key={i}>{a.quantity} × {a.item_name} to {members.find(m=>m.character_id===a.recipient)?.name??'Unknown recipient'}</p>)}
   <button type="button" disabled={busy} onClick={()=>void invoke(true)}>Confirm & Distribute All</button>
  </div>}
  {notice&&<p role="status" className="nx-loot-batch-success">{notice}</p>}
  {error&&<p role="alert" className="nx-loot-batch-error">{error}</p>}
 </section>;
}
