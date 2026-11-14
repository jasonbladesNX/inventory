import React,{useCallback,useEffect,useState}from'react';
import type{SupabaseClient}from'@supabase/supabase-js';
import{Coins,RefreshCw}from'lucide-react';
import{inventoryErrorMessage}from'./inventoryErrors';
import './party-currency-requests.css';

type Currency={id:string;name:string;code:string;precision:number;amount:number};
type Request={id:string;character_name:string;amount:number;currency_code:string;status:string;can_review:boolean;can_cancel:boolean};
type Snapshot={can_review:boolean;is_running:boolean;policy:'direct'|'approval';currencies:Currency[];requests:Request[]};

export default function PartyCurrencyRequests({db,party,character=null,onTransfer}:{
 db:SupabaseClient;party:string;character?:string|null;onTransfer?:()=>Promise<void>;
}){
 const[data,setData]=useState<Snapshot|null>(null);
 const[currency,setCurrency]=useState('');
 const[amount,setAmount]=useState('1');
 const[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const{data:next,error:e}=await db.rpc('list_party_currency_requests',{p_party:party,p_character:character});
  if(e)throw e;
  setData(next as Snapshot);
 },[db,party,character]);
 useEffect(()=>{
  let live=true;setData(null);setCurrency('');setAmount('1');setError('');setLoading(true);
  void refresh().catch(e=>{if(live)setError(inventoryErrorMessage(e))})
   .finally(()=>{if(live)setLoading(false)});
  const poll=window.setInterval(()=>{if(live)void refresh().catch(()=>{})},20000);
  return()=>{live=false;window.clearInterval(poll)};
 },[refresh]);
 const selected=data?.currencies.find(c=>c.id===currency);
 const num=Number(amount);
 const precision=selected?.precision??0;
 const valid=!!selected&&Number.isFinite(num)&&num>0&&num<=selected.amount&&
  Number(num.toFixed(precision))===num;
 const pending=(data?.requests??[]).filter(r=>r.status==='pending');
 async function act(action:'request'|'approve'|'decline'|'cancel',request?:string){
  if(busy||data?.is_running)return;
  if(action==='approve'&&!window.confirm('Approve and transfer this currency from the party bank to the requesting character?'))return;
  setBusy(true);setNotice('');setError('');
  try{
   const{error:e}=await db.rpc('manage_party_currency_request',{
    p_party:party,p_action:action,p_character:action==='request'?character:null,
    p_currency:action==='request'?currency:null,p_amount:action==='request'?num:null,
    p_request:request??null
   });
   if(e)throw e;
   if(action==='request'){setCurrency('');setAmount('1')}
   await refresh();
   if(action==='approve')await onTransfer?.();
   setNotice(action==='request'?'Currency withdrawal requested.':
    action==='approve'?'Currency approved and transferred.':
    action==='decline'?'Request declined.':'Request cancelled.');
  }catch(e){setError(inventoryErrorMessage(e));void refresh().catch(()=>{})}
  finally{setBusy(false)}
 }
 return <section className="nx-party-currency-requests" aria-label="Party currency requests">
  <div className="nx-party-currency-title">
   <h4><Coins size={18}/> Party Currency Requests</h4>
   <button type="button" aria-label="Refresh party currency requests" disabled={busy}
    onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}><RefreshCw size={16}/></button>
  </div>
  <p>{data?.policy==='approval'
   ?'Approval required: the party leader or GM must approve withdrawals from the shared treasury.'
   :'Optional approval: members may request currency here or withdraw directly between sessions.'}</p>
  {data?.is_running&&<p className="nx-party-currency-lock">Game running — currency requests and transfers are locked.</p>}
  {loading?<p>Loading party currency…</p>:<>
   {character!==null&&<form className="nx-party-currency-form" onSubmit={e=>{e.preventDefault();void act('request')}}>
    <label>Currency
     <select value={currency} disabled={busy||data?.is_running} onChange={e=>setCurrency(e.target.value)}>
      <option value="">Choose currency…</option>
      {(data?.currencies??[]).map(c=><option key={c.id} value={c.id}>{c.name} ({c.code}) — {c.amount} available</option>)}
     </select>
    </label>
    <label>Amount
     <input type="number" min={selected?1/10**precision:0.01} max={selected?.amount}
      step={selected?1/10**precision:'any'} value={amount} disabled={busy||data?.is_running}
      onChange={e=>setAmount(e.target.value)}/>
    </label>
    <button type="submit" disabled={busy||data?.is_running||!valid}>Request Currency</button>
   </form>}
   <div className="nx-party-currency-list">
    <strong>Pending Currency Requests ({pending.length})</strong>
    {pending.length===0?<p>No pending currency requests.</p>:pending.map(r=>
     <article key={r.id} className="nx-party-currency-row">
      <div><strong>{r.character_name}</strong><span>{r.amount} {r.currency_code}</span></div>
      <div className="nx-party-currency-actions">
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
  {notice&&<p role="status" className="nx-party-currency-success">{notice}</p>}
  {error&&<p role="alert" className="nx-party-currency-error">{error}</p>}
 </section>;
}
