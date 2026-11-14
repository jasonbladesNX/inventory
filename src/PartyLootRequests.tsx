import React,{useCallback,useEffect,useState}from'react';
import type{SupabaseClient}from'@supabase/supabase-js';
import{PackageCheck,RefreshCw}from'lucide-react';
import{inventoryErrorMessage}from'./inventoryErrors';
import './party-loot-requests.css';

type Item={id:string;name:string;quantity:number};
type Request={id:string;item_id:string;item_name:string;character_id:string;character_name:string;quantity:number;status:string;can_cancel:boolean;can_review:boolean;created_at:string};
type Snapshot={can_review:boolean;is_running:boolean;withdrawal_policy?:'direct'|'approval';items:Item[];requests:Request[]};
export default function PartyLootRequests({db,party,character=null,onTransfer}:{
 db:SupabaseClient;party:string;character?:string|null;onTransfer?:()=>Promise<void>;
}){
 const[data,setData]=useState<Snapshot|null>(null);
 const[item,setItem]=useState('');
 const[quantity,setQuantity]=useState('1');
 const[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const{data:result,error:e}=await db.rpc('list_party_loot_requests',{p_party:party,p_character:character});
  if(e)throw e;setData(result as Snapshot);
 },[db,party,character]);
 useEffect(()=>{let live=true;setData(null);setLoading(true);setError('');setItem('');setQuantity('1');
  void refresh().catch(e=>{if(live)setError(inventoryErrorMessage(e))}).finally(()=>{if(live)setLoading(false)});
  const timer=window.setInterval(()=>{if(live)void refresh().catch(()=>{})},20000);
  return()=>{live=false;window.clearInterval(timer)}
 },[refresh]);
 const selected=data?.items.find(i=>i.id===item);
 async function act(action:'request'|'approve'|'decline'|'cancel',id?:string){
  if(busy||data?.is_running)return;
  if(action==='approve'&&!window.confirm('Approve this loot request and transfer the requested item quantity into the player inventory?'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const{error:e}=await db.rpc('manage_party_loot_request',{
    p_party:party,p_action:action,p_character:action==='request'?character:null,
    p_item:action==='request'?item:null,p_quantity:action==='request'?Number(quantity):null,
    p_request:id??null,p_expected_quantity:action==='request'?selected?.quantity??null:null
   });
   if(e)throw e;
   await refresh();
   if(action==='request'){setItem('');setQuantity('1')}
   if(action==='approve')await onTransfer?.();
   setNotice(action==='request'?'Loot request submitted.':
    action==='approve'?'Request approved; item transferred.':
    action==='decline'?'Request declined.':'Request cancelled.');
  }catch(e){setError(inventoryErrorMessage(e));void refresh().catch(()=>{})}finally{setBusy(false)}
 }
 const pending=(data?.requests??[]).filter(r=>r.status==='pending');
 const canRequest=character!==null;
 const validQuantity=Number.isFinite(Number(quantity))&&Number(quantity)>0&&
  !!selected&&Number(quantity)<=selected.quantity;
 return <section className="nx-party-loot-requests" aria-label="Party loot requests">
  <div className="nx-party-loot-head">
   <h4><PackageCheck size={18}/> Party Loot Requests</h4>
   <button type="button" aria-label="Refresh loot requests" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}><RefreshCw size={16}/></button>
  </div>
  <p>{data?.withdrawal_policy==='approval'
   ?'GM policy: direct party-bank withdrawals are disabled. Request items here for leader or GM approval.'
   :'Request items for leader/GM approval, or withdraw directly from the party bank between sessions.'}</p>
  {data?.is_running&&<p className="nx-party-loot-locked">Game in progress — requesting and approving loot is locked.</p>}
  {loading?<p>Loading requests…</p>:<>
   {canRequest&&<form onSubmit={e=>{e.preventDefault();void act('request')}} className="nx-party-loot-create">
    <label>Item from Party Bank<select value={item} disabled={busy||data?.is_running}
     onChange={e=>setItem(e.target.value)}>
     <option value="">Select an item…</option>
     {(data?.items??[]).map(i=><option key={i.id} value={i.id}>{i.name} ({i.quantity} available)</option>)}
    </select></label>
    <label>Quantity<input type="number" step="any" min="0.000001" max={selected?.quantity} disabled={busy||data?.is_running}
     value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <button type="submit" disabled={busy||data?.is_running||!validQuantity}>Request Loot</button>
   </form>}
   <div className="nx-party-loot-queue">
    <strong>Pending Requests ({pending.length})</strong>
    {pending.length===0?<p>No pending requests.</p>:pending.map(r=><article key={r.id} className="nx-party-loot-request">
     <div><strong>{r.character_name}</strong><span>{r.quantity} × {r.item_name}</span></div>
     <div className="nx-party-loot-actions">
      {r.can_review&&<button type="button" disabled={busy||data?.is_running}
       onClick={()=>void act('approve',r.id)}>Approve & Transfer</button>}
      {r.can_review&&<button type="button" disabled={busy||data?.is_running}
       onClick={()=>void act('decline',r.id)}>Decline</button>}
      {r.can_cancel&&<button type="button" disabled={busy||data?.is_running}
       onClick={()=>void act('cancel',r.id)}>Cancel</button>}
     </div>
    </article>)}
   </div>
  </>}
  {notice&&<p className="nx-party-loot-success" role="status">{notice}</p>}
  {error&&<p className="nx-party-loot-error" role="alert">{error}</p>}
 </section>
}
