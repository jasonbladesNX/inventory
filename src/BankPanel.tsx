import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Archive,Lock,Package,RefreshCw,Users} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import BankTreasury from './BankTreasury';
import './bank-panel.css';
type Stored={id:string;name:string;quantity:number;category:string;identified:boolean};
type Bank={id:string;type:'personal'|'party';name:string;items:Stored[]};
type InventoryItem={item_id:string;name:string;quantity:number;eligible:boolean};
type BanksResult={is_running:boolean;banks:Bank[]};
export default function BankPanel({db,campaign,character,items,revision=0,onInventoryChanged}:{
 db:SupabaseClient;campaign:string;character:string;items:InventoryItem[];revision?:number;onInventoryChanged:()=>Promise<void>;
}){
 const [state,setState]=useState<BanksResult>({is_running:false,banks:[]});
 const [depositBank,setDepositBank]=useState('');
 const [depositItem,setDepositItem]=useState('');
 const [depositQuantity,setDepositQuantity]=useState('1');
 const [withdrawQuantity,setWithdrawQuantity]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const [history,setHistory]=useState<{bank_id:string;actor_character:string;action:string;kind:string;item_name:string;amount:number;occurred_at:string}[]>([]);
 async function loadHistory(){
  const {data,error:e}=await db.rpc('list_character_bank_activity',{p_character:character,p_limit:30});
  if(e){setError(inventoryErrorMessage(e));return}
  setHistory((data??[]) as typeof history);
 }

 const refresh=useCallback(async()=>{
  const {data,error:e}=await db.rpc('list_character_banks',{p_character:character});
  if(e)throw e;
  const next=data as BanksResult;
  setState(next);
  setDepositBank(previous=>next.banks.some(bank=>bank.id===previous)?previous:(next.banks[0]?.id??''));
 },[db,character]);
 useEffect(()=>{
  let alive=true;
  void refresh().catch(e=>{if(alive)setError(inventoryErrorMessage(e))});
  const timer=window.setInterval(()=>{if(alive)void refresh().catch(e=>{if(alive)setError(inventoryErrorMessage(e))})},20000);
  return()=>{alive=false;window.clearInterval(timer)};
 },[refresh,revision]);
 async function move(action:'deposit'|'withdraw',bankId:string,itemId:string,quantity:number){
  if(busy)return;
  setBusy(true);setMessage('');setError('');
  try{
   const {error:e}=await db.rpc('manage_bank_item',{
    p_character:character,p_bank:bankId,p_item:itemId,p_action:action,p_quantity:quantity
   });
   if(e)throw e;
   await Promise.all([refresh(),onInventoryChanged()]);
   setMessage(action==='deposit'?'Item stored in bank.':'Item moved to your carried inventory.');
   setDepositItem('');setDepositQuantity('1');
  }catch(e){
   setError(inventoryErrorMessage(e));
   void refresh().catch(()=>{});
  }finally{setBusy(false)}
 }
 const eligible=items.filter(i=>i.eligible&&Number(i.quantity)>0);
 const selected=eligible.find(i=>i.item_id===depositItem);
 return <section className="mv-panel nx-bank-panel" aria-label="Character banking">
  <div className="nx-bank-heading"><div><h3><Archive size={19}/> Home & Party Banks</h3><p>Long-term storage outside your carried inventory.</p></div>
   <button type="button" className="nx-bank-refresh" onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))} aria-label="Refresh bank contents" disabled={busy}><RefreshCw size={16}/></button>
  </div>
  {state.is_running&&<div className="nx-bank-locked" role="status"><Lock size={18}/><div><strong>Banks locked — game in progress</strong><span>Banked items cannot be equipped, traded, moved or used until the GM ends the session.</span></div></div>}
  <div className="nx-bank-grid">
   {state.banks.map(bank=><div className="nx-bank-card" key={bank.id}>
    <div className="nx-bank-card-heading">{bank.type==='personal'?<Archive size={18}/>:<Users size={18}/>}
     <strong>{bank.name}</strong><small>{bank.items.length} item stacks</small></div>
    {bank.items.length===0?<p className="nx-bank-empty">Nothing stored here yet.</p>:
     <div className="nx-bank-items">{bank.items.map(stored=><div key={stored.id} className="nx-bank-item">
      <div><strong>{stored.name}</strong><small>Quantity: {stored.quantity}</small></div>
      {!state.is_running&&<div className="nx-bank-item-action">
       <input type="number" aria-label={'Withdrawal quantity for '+stored.name} min="0.000001" step="any" max={stored.quantity}
        value={withdrawQuantity[stored.id]??String(stored.quantity)}
        onChange={e=>setWithdrawQuantity(v=>({...v,[stored.id]:e.target.value}))}/>
       <button type="button" disabled={busy} onClick={()=>void move('withdraw',bank.id,stored.id,Number(withdrawQuantity[stored.id]??stored.quantity))}>Withdraw</button>
      </div>}
     </div>)}</div>}
   </div>)}
  </div>
  {!state.is_running&&state.banks.length>0&&<form className="nx-bank-deposit" onSubmit={event=>{event.preventDefault();void move('deposit',depositBank,depositItem,Number(depositQuantity))}}>
   <h4><Package size={16}/> Deposit item</h4>
   <div className="nx-bank-deposit-fields">
    <label>Destination bank<select value={depositBank} onChange={e=>setDepositBank(e.target.value)} required>
     {state.banks.map(bank=><option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
    <label>Carried item<select value={depositItem} onChange={e=>setDepositItem(e.target.value)} required>
     <option value="">Choose item…</option>{eligible.map(item=><option key={item.item_id} value={item.item_id}>{item.name} ({item.quantity})</option>)}</select></label>
    <label>Qty<input type="number" min="0.000001" step="any" max={selected?.quantity} value={depositQuantity} required onChange={e=>setDepositQuantity(e.target.value)}/></label>
    <button disabled={busy||!depositItem||!depositBank} type="submit">Deposit</button>
   </div>
  </form>}
  <BankTreasury db={db} character={character} banks={state.banks} running={state.is_running} onChanged={async()=>{await onInventoryChanged();await refresh()}}/>
  <details className="nx-bank-history"><summary>Bank Activity History</summary>
   <button type="button" onClick={()=>void loadHistory()}>Load Recent Activity</button>
   {history.length===0?<p>No bank activity loaded.</p>:
    <ul>{history.map((entry,index)=><li key={index}>
      {entry.actor_character} {entry.action==='deposit'?'deposited':'withdrew'} {entry.amount} {entry.item_name}
      {' · '}{new Date(entry.occurred_at).toLocaleString()}
    </li>)}</ul>}
  </details>
  <p className="nx-bank-note">Banked items are not carried, cannot be equipped or consumed, and do not participate in normal player trades. Both bank types are available between sessions only.</p>
  {message&&<p className="nx-bank-message" role="status">{message}</p>}
  {error&&<p className="nx-bank-error" role="alert">{error}</p>}
 </section>;
}
