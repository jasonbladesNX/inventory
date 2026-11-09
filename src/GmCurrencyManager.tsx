import React,{useEffect,useState} from 'react';
import {Coins} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
type Currency={id:string;code:string;name:string;base_factor:number|string;precision_digits:number;is_base:boolean};
type Character={id:string;name:string};
type Props={db:SupabaseClient;campaign:string;characters:Character[];onChanged:()=>Promise<void>};
export default function GmCurrencyManager({db,campaign,characters,onChanged}:Props){
 const [currencies,setCurrencies]=useState<Currency[]>([]);
 const [code,setCode]=useState('GP'),[name,setName]=useState('Gold Piece'),[factor,setFactor]=useState('1'),[precision,setPrecision]=useState('0');
 const [character,setCharacter]=useState(''),[currency,setCurrency]=useState(''),[delta,setDelta]=useState(''),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{const {data,error:rpcError}=await db.rpc('list_campaign_currency_definitions',{p_campaign:campaign});if(rpcError)throw rpcError;setCurrencies(data||[])};
 useEffect(()=>{let cancelled=false;setCurrencies([]);setCharacter('');setCurrency('');setError('');void Promise.resolve(db.rpc('list_campaign_currency_definitions',{p_campaign:campaign})).then(({data,error:rpcError})=>{if(rpcError)throw rpcError;if(!cancelled)setCurrencies(data||[])}).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});return()=>{cancelled=true}},[db,campaign]);
 const run=async(action:'denomination'|'adjust')=>{
   if(busy)return;setBusy(true);setError('');setNotice('');
   try{
     if(action==='denomination'){
       const {error:rpcError}=await db.rpc('upsert_campaign_currency',{p_campaign:campaign,p_code:code.trim(),p_name:name.trim(),p_factor:Number(factor),p_precision:Number(precision)});
       if(rpcError)throw rpcError;
       await load();setNotice('Campaign denomination saved.');
     }else{
       const {error:rpcError}=await db.rpc('adjust_campaign_character_currency',{p_campaign:campaign,p_character:character,p_currency:currency,p_delta:Number(delta),p_reason:reason.trim()});
       if(rpcError)throw rpcError;
       await onChanged();setDelta('');setReason('');setNotice('Character wallet adjusted and logged.');
     }
   }catch(e){setError(inventoryErrorMessage(e))}
   finally{setBusy(false)}
 };
 return <section className="nx-page-card nx-gm-tools" aria-label="Campaign Currency Management">
   <h2><Coins size={20}/> Campaign Currency</h2>
   <p>Configure campaign denominations and conversion ratios, then grant or deduct character funds. Changing an existing ratio affects future conversions, not historical transactions.</p>
   {currencies.length>0&&<div className="nx-currency-list">{currencies.map(c=><div key={c.id}><strong>{c.code}</strong> · {c.name} · Factor {c.base_factor} · {c.precision_digits} decimal places</div>)}</div>}
   <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run('denomination')}}>
     <h3>Add or Update Denomination</h3>
     <label>Currency code<input required maxLength={8} value={code} onChange={e=>{const v=e.target.value.toUpperCase();setCode(v);const c=currencies.find(row=>row.code===v);if(c){setName(c.name);setFactor(String(c.base_factor));setPrecision(String(c.precision_digits))}}}/></label>
     <label>Name<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
     <label>Value in base units<input required type="number" min="0.000001" max="1000000000" step="any" value={factor} onChange={e=>setFactor(e.target.value)}/></label>
     <label>Decimal precision<select value={precision} onChange={e=>setPrecision(e.target.value)}>{[0,1,2,3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
     <p>For example, if GP is worth 100 base units, SP is worth 10 and CP is worth 1. Rates must be configured consistently.</p>
     <button type="submit" disabled={busy||!code.trim()||!name.trim()||Number(factor)<=0}>Save Denomination</button>
   </form>
   <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run('adjust')}}>
     <h3>Adjust Character Wallet</h3>
     <label>Character<select required value={character} onChange={e=>setCharacter(e.target.value)}>
       <option value="">Choose character…</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
     </select></label>
     <label>Currency<select required value={currency} onChange={e=>setCurrency(e.target.value)}>
       <option value="">Choose currency…</option>{currencies.map(c=><option value={c.id} key={c.id}>{c.name} ({c.code})</option>)}
     </select></label>
     <label>Adjustment amount (+ grant, − deduct)<input required type="number" step="any" value={delta} onChange={e=>setDelta(e.target.value)} placeholder="100 or -20"/></label>
     <label>Reason (optional)<input maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Quest reward"/></label>
     <button type="submit" disabled={busy||!character||!currency||!delta||Number(delta)===0}>Apply Wallet Adjustment</button>
   </form>
   {notice&&<p role="status">{notice}</p>}
   {error&&<p role="alert" className="nx-character-list-error">{error}</p>}
 </section>;
}
