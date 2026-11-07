import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Archive,History,Layers2,PackageMinus,PackagePlus,RefreshCw,ShieldAlert} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './stack-management.css';

type Item={item_id:string;display_name:string;quantity:number|string;eligible:boolean};
type Storage={item_id:string;container_item_id:string|null;is_container:boolean;location_name:string};
type Activity={event_id:string;action:string;item_name:string;quantity:number|string|null;occurred_at:string;description:string};
type Action='split'|'merge'|'move_quantity'|'discard';
type Props={db:SupabaseClient;character:string;inventoryVersion:number;items:Item[];storage:Record<string,Storage>;equippedIds:Set<string>;busy:boolean;onChanged:()=>Promise<void>};
export default function StackManagement({db,character,inventoryVersion,items,storage,equippedIds,busy,onChanged}:Props){
 const [itemId,setItemId]=useState('');
 const [action,setAction]=useState<Action>('split');
 const [quantity,setQuantity]=useState('1');
 const [target,setTarget]=useState('');
 const [container,setContainer]=useState('');
 const [confirmDiscard,setConfirmDiscard]=useState(false);
 const [working,setWorking]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const [history,setHistory]=useState<Activity[]>([]);
 const [historyLoading,setHistoryLoading]=useState(false);
 const eligibleItems=items.filter(item=>!storage[item.item_id]?.is_container&&!equippedIds.has(item.item_id));
 const selected=eligibleItems.find(item=>item.item_id===itemId);
 const similar=eligibleItems.filter(item=>item.item_id!==itemId&&item.display_name===selected?.display_name&&storage[item.item_id]?.container_item_id===storage[itemId]?.container_item_id);
 const containers=items.filter(item=>storage[item.item_id]?.is_container&&!storage[item.item_id]?.container_item_id);
 const currentContainer=storage[itemId]?.container_item_id;
 useEffect(()=>{if(!eligibleItems.some(i=>i.item_id===itemId))setItemId('')},[itemId,items,storage,equippedIds]);
 useEffect(()=>{setTarget('');setConfirmDiscard(false);setMessage('');setError('')},[action,itemId]);
 useEffect(()=>{
  let cancelled=false;
  async function load(){
   setHistoryLoading(true);
   const result=await db.rpc('list_character_inventory_activity',{p_character:character,p_limit:40});
   if(!cancelled){if(!result.error)setHistory((result.data||[]) as Activity[]);setHistoryLoading(false)}
  }
  void load();
  return()=>{cancelled=true};
 },[db,character,inventoryVersion]);
 const qty=Number(quantity);
 const isWhole=Number.isSafeInteger(qty)&&qty>=1&&qty<=100000000;
 const canSubmit=!!selected&&isWhole&&qty<=Number(selected.quantity)&&
   (action!=='split'||qty<Number(selected.quantity))&&
   (action!=='merge'||!!target)&&
   (action!=='move_quantity'||container!==(currentContainer??''))&&
   (action!=='discard'||confirmDiscard)&&!working&&!busy;
 async function perform(){
  if(!canSubmit||!selected)return;
  setWorking(true);setMessage('');setError('');
  try{
   const {error:e}=await db.rpc('manage_character_item_stack',{
    p_character:character,p_item:itemId,p_action:action,p_quantity:qty,
    p_target_item:action==='merge'?target:null,p_container_item:action==='move_quantity'?(container||null):null
   });
   if(e)throw e;
   await onChanged();
   setConfirmDiscard(false);
   setMessage(action==='discard'?'Items discarded.':action==='merge'?'Stacks consolidated.':action==='split'?'Stack split.':'Quantity moved.');
   setItemId('');
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setWorking(false)}
 }
 return <section className="nx-stack-panel" aria-labelledby="nx-stack-heading">
  <details>
   <summary id="nx-stack-heading"><Layers2 size={18}/> Item stack management</summary>
   <div className="nx-stack-controls">
    <label>Item
      <select value={itemId} onChange={e=>setItemId(e.target.value)}>
       <option value="">Choose an unequipped non-container item</option>
       {eligibleItems.map(item=><option key={item.item_id} value={item.item_id}>{item.display_name} — {item.quantity} available</option>)}
      </select>
    </label>
    <label>Action
      <select value={action} onChange={e=>setAction(e.target.value as Action)}>
       <option value="split">Split stack</option>
       <option value="merge">Consolidate stacks</option>
       <option value="move_quantity">Move quantity to / from container</option>
       <option value="discard">Drop / discard quantity</option>
      </select>
    </label>
    <label>Quantity
      <input type="number" min="1" step="1" max={selected?Number(selected.quantity):100000000}
       value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmDiscard(false)}}/>
    </label>
    {action==='merge'&&<label>Compatible target stack
      <select value={target} onChange={e=>setTarget(e.target.value)}>
       <option value="">Choose a target stack</option>
       {similar.map(item=><option key={item.item_id} value={item.item_id}>{item.display_name} — {item.quantity}</option>)}
      </select>
      <small>The server verifies identical item properties and storage location before combining.</small>
    </label>}
    {action==='move_quantity'&&<label>Destination
      <select value={container} onChange={e=>setContainer(e.target.value)}>
       <option value="">Carried (outside containers)</option>
       {containers.map(item=><option key={item.item_id} value={item.item_id}>{item.display_name}</option>)}
      </select>
      <small>Container weight limits and missing-weight restrictions still apply.</small>
    </label>}
    {action==='discard'&&selected&&<label className="nx-stack-danger-confirm">
      <input type="checkbox" checked={confirmDiscard} onChange={e=>setConfirmDiscard(e.target.checked)}/>
      Permanently discard {isWhole?qty:0} × {selected.display_name}. This cannot be undone.
    </label>}
    {error&&<p className="nx-stack-error" role="alert">{error}</p>}
    {message&&<p className="nx-stack-success" role="status">{message}</p>}
    <button type="button" disabled={!canSubmit} onClick={()=>void perform()}>
      {action==='discard'?<PackageMinus size={16}/>:action==='move_quantity'?<Archive size={16}/>:<PackagePlus size={16}/>}
      {working?'Working…':action==='discard'?'Confirm discard':action==='split'?'Split stack':action==='merge'?'Consolidate stacks':'Move quantity'}
    </button>
   </div>
  </details>
  <details className="nx-stack-history">
   <summary><History size={18}/> Inventory activity {historyLoading?'(loading…)':`(${history.length})`}</summary>
   {history.length===0?<p>No recorded stack, equipment or container changes yet.</p>:
    <div className="nx-stack-activity-list">{history.map(row=><div key={row.event_id}>
      <strong>{row.item_name}</strong><span>{row.description}{row.quantity!=null?` · Qty ${row.quantity}`:''}</span>
      <time dateTime={row.occurred_at}>{new Date(row.occurred_at).toLocaleString()}</time>
    </div>)}</div>}
   <small>Displays up to 40 recent character-related events. Earlier operations may not have complete history.</small>
  </details>
 </section>;
}
