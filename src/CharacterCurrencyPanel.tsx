import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Coins,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './currency-panel.css';
type Money={currency_id:string;code:string;name:string;available:number|string;precision_digits:number};
type Recipient={id:string;name:string};
type Tx={event_id:string;operation:string;currency_code:string;amount:number|string;other_character:string|null;occurred_at:string};
type Props={db:SupabaseClient;campaign:string;character:string;inventoryVersion:number;wallet:Money[];busy:boolean;onChanged:()=>Promise<void>};
export default function CharacterCurrencyPanel({db,campaign,character,inventoryVersion,wallet,busy,onChanged}:Props){
 const [open,setOpen]=useState(false),[tab,setTab]=useState<'transfer'|'exchange'|'history'>('transfer');
 const [recipients,setRecipients]=useState<Recipient[]>([]),[history,setHistory]=useState<Tx[]>([]);
 const [receiver,setReceiver]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[amount,setAmount]=useState('');
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [confirm,setConfirm]=useState(false);
 useEffect(()=>{
   let cancelled=false;
   void Promise.all([
     db.rpc('list_trade_recipients',{p_campaign:campaign}),
     db.rpc('list_character_currency_history',{p_character:character,p_limit:40})
   ]).then(([a,b])=>{
     if(a.error)throw a.error;if(b.error)throw b.error;
     if(!cancelled){setRecipients((a.data||[]).filter((r:Recipient)=>r.id!==character));setHistory(b.data||[])}
   }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
   return()=>{cancelled=true};
 },[db,campaign,character,inventoryVersion]);
 useEffect(()=>{setOpen(false);setConfirm(false);setStatus('');setError('');setReceiver('')},[character]);
 useEffect(()=>{if(!wallet.length)return;if(!wallet.some(c=>c.currency_id===from))setFrom(wallet[0].currency_id);if(!wallet.some(c=>c.currency_id===to))setTo(wallet[wallet.length>1?1:0].currency_id)},[wallet,from,to]);
 const chosen=wallet.find(c=>c.currency_id===from);
 const target=wallet.find(c=>c.currency_id===to);
 const precision=chosen?.precision_digits??0;
 const valid=/^\d+(?:\.\d+)?$/.test(amount)&&Number(amount)>0&&Number(amount)<=1e9&&Number(amount)<=Number(chosen?.available??0)&&
 Math.round(Number(amount)*10**precision)/10**precision===Number(amount);
 const close=()=>{if(working)return;setOpen(false);setConfirm(false)};
 const execute=async()=>{
   if(working||busy||!valid||!chosen||!confirm)return;
   setWorking(true);setError('');setStatus('');
   try{
     const args=tab==='transfer'?
       {p_from:character,p_to:receiver,p_currency:from,p_amount:Number(amount)}:
       {p_character:character,p_from_currency:from,p_to_currency:to,p_amount:Number(amount)};
     const fn=tab==='transfer'?'transfer_character_currency':'exchange_character_currency';
     const {error:rpcError}=await db.rpc(fn,args);
     if(rpcError)throw rpcError;
     await onChanged();
     const {data,error:historyError}=await db.rpc('list_character_currency_history',{p_character:character,p_limit:40});
     if(historyError)throw historyError;
     setHistory(data||[]);setStatus(tab==='transfer'?'Currency sent successfully.':'Denominations exchanged successfully.');
     setAmount('');setConfirm(false);
   }catch(e){setError(inventoryErrorMessage(e))}
   finally{setWorking(false)}
 };
 const historyRows=history.map(row=><div key={row.event_id} className="mv-currency-history-row">
   <strong>{row.operation} {row.amount} {row.currency_code}</strong>
   <span>{row.other_character?('With '+row.other_character):''} · {new Date(row.occurred_at).toLocaleString()}</span>
 </div>);
 return <>
  <div className="mv-currency-heading">
    <h3 id="mv-currency-title"><Coins size={20}/> Currency</h3>
    <button type="button" disabled={busy} onClick={()=>{setOpen(true);setError('');setStatus('')}}>Manage</button>
  </div>
  {!wallet.length?<p className="mv-empty">No denominations configured yet. Your GM can set up campaign currency.</p>:
    <div className="mv-rows">{wallet.map(c=><div className="mv-currency-row" key={c.currency_id}>
      <span className="mv-coin" aria-hidden="true">●</span><span>{c.name||c.code} ({c.code})</span><strong>{Number(c.available).toLocaleString(undefined,{maximumFractionDigits:c.precision_digits})}</strong>
    </div>)}</div>}
  {open&&createPortal(<div className="mv-modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}>
    <section role="dialog" aria-modal="true" aria-labelledby="mv-currency-dialog-title" className="mv-item-modal mv-currency-dialog">
      <div className="mv-modal-header">
        <div className="mv-modal-heading"><Coins size={22}/><h3 id="mv-currency-dialog-title">Character Currency</h3></div>
        <button type="button" className="mv-modal-close" aria-label="Close currency manager" disabled={working} onClick={close}><X size={22}/></button>
      </div>
      <div className="mv-modal-body mv-currency-dialog-body">
        <div className="mv-currency-tabs">{(['transfer','exchange','history'] as const).map(x=><button key={x} type="button"
         aria-pressed={tab===x} onClick={()=>{setTab(x);setConfirm(false);setError('')}}>{x==='transfer'?'Send':x==='exchange'?'Convert':'History'}</button>)}</div>
        {tab==='history'?<div className="mv-currency-history">{historyRows.length?historyRows:<p>No currency activity yet.</p>}</div>:<>
          <label>Denomination<select value={from} disabled={working} onChange={e=>{setFrom(e.target.value);setConfirm(false)}}>
            {wallet.map(c=><option value={c.currency_id} key={c.currency_id}>{c.name} ({c.code}) — {c.available}</option>)}</select></label>
          {tab==='transfer'?<label>Recipient character<select value={receiver} disabled={working} onChange={e=>{setReceiver(e.target.value);setConfirm(false)}}>
            <option value="">Choose a recipient</option>{recipients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>:
            <label>Convert into<select value={to} disabled={working} onChange={e=>{setTo(e.target.value);setConfirm(false)}}>
            {wallet.map(c=><option key={c.currency_id} value={c.currency_id}>{c.name} ({c.code})</option>)}</select></label>}
          <label>Amount<input type="number" step="any" min="0" value={amount} disabled={working} onChange={e=>{setAmount(e.target.value);setConfirm(false)}}/></label>
          {tab==='exchange'&&<p>Conversions use the GM's denomination ratios. Fractional coins that exceed a denomination's precision are not permitted.</p>}
          {confirm&&<p className="mv-currency-confirm">Confirm {tab==='transfer'?'sending':'converting'} {amount} {chosen?.code}{tab==='transfer'?' to '+(recipients.find(c=>c.id===receiver)?.name??'recipient'):' into '+target?.code}?</p>}
          {!confirm?<button type="button" disabled={working||busy||!valid||(tab==='transfer'?!receiver:!to||to===from)} onClick={()=>setConfirm(true)}>Review {tab==='transfer'?'Transfer':'Conversion'}</button>:
            <button type="button" disabled={working||busy} onClick={()=>void execute()}>Confirm {tab==='transfer'?'Transfer':'Conversion'}</button>}
        </>}
        {status&&<p role="status" className="mv-currency-feedback">{status}</p>}
        {error&&<p role="alert" className="mv-storage-error">{error}</p>}
      </div>
    </section>
   </div>,document.body)}
 </>;
}
