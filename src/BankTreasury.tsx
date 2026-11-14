import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Coins} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
type Balance={currency_id:string;code:string;name:string;amount:number;precision:number};
type BankBalance={bank_id:string;currency:Balance[]};
type Bank={id:string;name:string;type?:'personal'|'party';withdrawal_policy?:'direct'|'approval'};
type Ledger={carried:Balance[];banks:BankBalance[]};
export default function BankTreasury({db,character,banks,running,revision=0,onChanged}:{
 db:SupabaseClient;character:string;banks:Bank[];running:boolean;revision?:number;onChanged:()=>Promise<void>
}){
 const [ledger,setLedger]=useState<Ledger>({carried:[],banks:[]});
 const [bankId,setBankId]=useState('');
 const [currency,setCurrency]=useState('');
 const [amount,setAmount]=useState('1');
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{const {data,error:e}=await db.rpc('list_bank_treasury',{p_character:character});if(e)throw e;setLedger(data as Ledger)},[db,character]);
 const bankIds=banks.map(bank=>bank.id).join('|');
 useEffect(()=>{void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh,bankIds,revision]);
 useEffect(()=>{setBankId(previous=>banks.some(b=>b.id===previous)?previous:banks[0]?.id??'')},[banks]);
 async function move(action:'deposit'|'withdraw',b:string,c:string,qty:number){
  if(busy)return;setBusy(true);setNotice('');setError('');
  try{const {error:e}=await db.rpc('manage_bank_currency',{p_character:character,p_bank:b,p_currency:c,p_action:action,p_amount:qty});
   if(e)throw e;await Promise.all([refresh(),onChanged()]);setNotice('Currency '+(action==='deposit'?'deposited.':'withdrawn.'));
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 const selected=ledger.carried.find(c=>c.currency_id===currency);
 return <section className="nx-bank-treasury" style={{display:'grid',gap:10,marginTop:10}} aria-label="Bank currency treasury">
  <h4 style={{display:'flex',alignItems:'center',gap:8,color:'#c4f0ff',margin:0}}><Coins size={18}/> Bank Treasury</h4>
  <p style={{fontSize:12,margin:0}}>Store currency in your personal bank or shared party bank between sessions.</p>
  {banks.map(bank=>{const balances=ledger.banks.find(b=>b.bank_id===bank.id)?.currency??[];
   return <div key={bank.id} style={{border:'1px solid #35697e',borderRadius:9,padding:10}}>
    <strong>{bank.name}</strong>
    {bank.type==='party'&&bank.withdrawal_policy==='approval'&&<p style={{fontSize:12}}>Direct currency withdrawals require approval. Use My Party → Party Currency Requests to ask the party leader or GM.</p>}
    {balances.length===0?<p style={{fontSize:12}}>No currency stored.</p>:
     balances.filter(c=>Number(c.amount)>0).map(c=><div key={c.currency_id} style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',padding:'8px 0'}}>
      <span>{c.amount} {c.code}</span>
      {!running&&!(bank.type==='party'&&bank.withdrawal_policy==='approval')&&<span style={{display:'flex',gap:6,alignItems:'center'}}>
       <input aria-label={'Withdraw '+c.code+' from '+bank.name} type="number" min={1/10**c.precision} step={1/10**c.precision} max={c.amount}
        value={quantities[bank.id+':'+c.currency_id]??String(c.amount)} style={{maxWidth:92}}
        onChange={e=>setQuantities(v=>({...v,[bank.id+':'+c.currency_id]:e.target.value}))}/>
       <button type="button" disabled={busy} onClick={()=>void move('withdraw',bank.id,c.currency_id,Number(quantities[bank.id+':'+c.currency_id]??c.amount))}>Withdraw</button>
      </span>}
     </div>)}
   </div>
  })}
  {!running&&banks.length>0&&<form onSubmit={e=>{e.preventDefault();void move('deposit',bankId,currency,Number(amount))}} style={{display:'grid',gap:8}}>
   <label>Deposit into<select required value={bankId} onChange={e=>setBankId(e.target.value)}>{banks.map(bank=><option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
   <label>Carried currency<select required value={currency} onChange={e=>setCurrency(e.target.value)}>
    <option value="">Select currency…</option>{ledger.carried.filter(c=>Number(c.amount)>0).map(c=><option key={c.currency_id} value={c.currency_id}>{c.name} ({c.code}: {c.amount})</option>)}</select></label>
   <label>Amount<input type="number" min={selected?1/10**selected.precision:0.000001} step={selected?1/10**selected.precision:'any'} max={selected?.amount}
    value={amount} onChange={e=>setAmount(e.target.value)}/></label>
   <button type="submit" disabled={busy||!bankId||!currency}>Deposit Currency</button>
  </form>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" style={{color:'#ffcfcb'}}>{error}</p>}
 </section>;
}
