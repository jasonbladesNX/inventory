import React,{useEffect,useState} from 'react';
import {PackageOpen,Copy,RefreshCw} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import TradeQR from './TradeQR';
import {inventoryErrorMessage} from './inventoryErrors';
import './qr-loot.css';

type Container={id:string;name:string;is_active:boolean;holder_id:string;item_count:number;total_units:number;claims:number};
type LootItem={item_id:string;definition_id:string;name:string;quantity:number};
type Definition={id:string;name:string;category:string};
type Currency={id:string;code:string;name:string;precision_digits:number};
type LootMoney={currency_id:string;code:string;name:string;amount:number|string;precision_digits:number};
export default function GmLootManager({db,campaign,refreshVersion=0}:{db:SupabaseClient;campaign:string;refreshVersion?:number}){
 const [containers,setContainers]=useState<Container[]>([]);
 const [catalog,setCatalog]=useState<Definition[]>([]);
 const [currencies,setCurrencies]=useState<Currency[]>([]),[lootMoney,setLootMoney]=useState<LootMoney[]>([]);
 const [currency,setCurrency]=useState(''),[currencyAmount,setCurrencyAmount]=useState('');
 const [source,setSource]=useState(''),[items,setItems]=useState<LootItem[]>([]);
 const [name,setName]=useState(''),[definition,setDefinition]=useState(''),[quantity,setQuantity]=useState('1');
 const [rawToken,setRawToken]=useState(''),[tokenSource,setTokenSource]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  const [a,b,c]=await Promise.all([
   db.rpc('list_gm_qr_loot_containers',{p_campaign:campaign}),
   db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),
   db.rpc('list_campaign_currency_definitions',{p_campaign:campaign})
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;
  setContainers(a.data||[]);setCatalog(b.data||[]);setCurrencies(c.data||[]);
 };
 const loadMoney=async(id:string)=>{
  if(!id){setLootMoney([]);return}
  const {data,error:rpcError}=await db.rpc('list_gm_qr_loot_currency',{p_source:id});
  if(rpcError)throw rpcError;setLootMoney(data||[]);
 };
 const loadItems=async(id:string)=>{
  if(!id){setItems([]);return}
  const {data,error:rpcError}=await db.rpc('list_gm_qr_loot_items',{p_source:id});
  if(rpcError)throw rpcError;setItems(data||[]);
 };
 useEffect(()=>{
  let cancelled=false;setContainers([]);setCatalog([]);setCurrencies([]);setLootMoney([]);setSource('');setItems([]);setRawToken('');setError('');
  void Promise.all([
   db.rpc('list_gm_qr_loot_containers',{p_campaign:campaign}),
   db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),
   db.rpc('list_campaign_currency_definitions',{p_campaign:campaign})
  ]).then(([a,b,c])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(!cancelled){setContainers(a.data||[]);setCatalog(b.data||[]);setCurrencies(c.data||[])}})
   .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,campaign]);
 useEffect(()=>{let cancelled=false;setItems([]);setLootMoney([]);if(!source)return;
  void Promise.all([db.rpc('list_gm_qr_loot_items',{p_source:source}),db.rpc('list_gm_qr_loot_currency',{p_source:source})])
  .then(([a,b])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(!cancelled){setItems(a.data||[]);setLootMoney(b.data||[])}})
  .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,source]);
 useEffect(()=>{
  if(refreshVersion===0)return;
  let cancelled=false;
  void Promise.all([
    db.rpc('list_gm_qr_loot_containers',{p_campaign:campaign}),
    db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),
    db.rpc('list_campaign_currency_definitions',{p_campaign:campaign}),
    ...(source?[
      db.rpc('list_gm_qr_loot_items',{p_source:source}),
      db.rpc('list_gm_qr_loot_currency',{p_source:source})
    ]:[])
  ]).then(([a,b,c,itemsResponse,currencyResponse])=>{
    if(a.error)throw a.error;
    if(b.error)throw b.error;
    if(c.error)throw c.error;
    if(itemsResponse?.error)throw itemsResponse.error;
    if(currencyResponse?.error)throw currencyResponse.error;
    if(!cancelled){
      setContainers(a.data||[]);
      setCatalog(b.data||[]);
      setCurrencies(c.data||[]);
      if(source){setItems(itemsResponse?.data||[]);setLootMoney(currencyResponse?.data||[])}
    }
  }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,campaign,refreshVersion]);
 const act=async(fn:()=>Promise<void>)=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await fn()}catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 };
 const create=async(e:React.FormEvent)=>{
  e.preventDefault();await act(async()=>{
   const {data,error:rpcError}=await db.rpc('create_qr_loot_container',{p_campaign:campaign,p_name:name.trim()});
   if(rpcError)throw rpcError;
   await load();setSource(String(data));setName('');setRawToken('');setNotice('Container created. Add items before generating its QR code.');
  });
 };
 const add=async(e:React.FormEvent)=>{
  e.preventDefault();await act(async()=>{
   const {error:rpcError}=await db.rpc('add_qr_loot_item',{p_source:source,p_definition:definition,p_quantity:Number(quantity)});
   if(rpcError)throw rpcError;await Promise.all([load(),loadItems(source)]);setNotice('Items added to container.');
  });
 };
 const saveCurrency=(e:React.FormEvent)=>{e.preventDefault();void act(async()=>{
  const amount=Number(currencyAmount),def=currencies.find(c=>c.id===currency);
  if(!def||!currencyAmount.trim()||!Number.isFinite(amount)||amount<=0||amount>1000000000||
    Math.round(amount*10**def.precision_digits)/10**def.precision_digits!==amount)
    throw Error('Choose a campaign denomination and enter a positive amount with valid precision.');
  const {error:rpcError}=await db.rpc('set_qr_loot_currency',{p_source:source,p_currency:currency,p_amount:amount});
  if(rpcError)throw rpcError;await loadMoney(source);setCurrencyAmount('');setNotice('Currency added to loot container.');
 })};
 const removeCurrency=(id:string)=>void act(async()=>{
  const {error:rpcError}=await db.rpc('set_qr_loot_currency',{p_source:source,p_currency:id,p_amount:0});
  if(rpcError)throw rpcError;await loadMoney(source);setNotice('Currency removed.');
 });
 const remove=(id:string)=>void act(async()=>{
  const {error:rpcError}=await db.rpc('remove_qr_loot_item',{p_source:source,p_item:id});
  if(rpcError)throw rpcError;await Promise.all([load(),loadItems(source)]);setNotice('Item removed.');
 });
 const generate=()=>void act(async()=>{
  if(items.length===0&&lootMoney.length===0)throw Error('Add items or currency before generating a QR code.');
  const {data,error:rpcError}=await db.rpc('issue_loot_qr_token',{p_source:source,p_expiration:null,p_max_uses:1});
  if(rpcError)throw rpcError;
  setRawToken(String(data));setTokenSource(source);setNotice('A one-use QR code is ready. Scanning does not bypass account login or character authorization.');
 });
 const setActive=(active:boolean)=>void act(async()=>{
  const {error:rpcError}=await db.rpc('set_qr_loot_container_active',{p_source:source,p_active:active});
  if(rpcError)throw rpcError;await load();setRawToken('');setNotice(active?'Container reopened.':'Container disabled.');
 });
 const selected=containers.find(c=>c.id===source);
 const url=rawToken?window.location.origin+'/?loot='+encodeURIComponent(rawToken):'';
 return <section className="nx-page-card nx-gm-tools nx-qr-loot" aria-label="QR Loot Containers">
  <h2><PackageOpen size={20}/> QR Loot Containers</h2>
  <p>Create a one-time treasure container with items, currency, or both. The first authorized character to claim its QR code receives the contents. Claims are final.</p>
  <form className="nx-tool-form" onSubmit={e=>void create(e)}>
   <label>New container name<input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Ancient treasure chest"/></label>
   <button type="submit" disabled={busy||name.trim().length<2}>Create Loot Container</button>
  </form>
  <label>Manage container<select value={source} disabled={busy} onChange={e=>{setSource(e.target.value);setRawToken('');setNotice('')}}>
   <option value="">Choose a loot container…</option>{containers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.total_units} units · {c.is_active?'Active':'Inactive'}</option>)}
  </select></label>
  {selected&&<div className="nx-qr-loot-detail">
   <p><strong>{selected.name}</strong> · {selected.total_units} item units · {lootMoney.length} currency denominations · {selected.claims} completed claims · {selected.is_active?'Active':'Inactive'}</p>
   {items.length>0?<div className="nx-qr-loot-items">{items.map(item=><div key={item.item_id}>
    <span>{item.name} × {item.quantity}</span>
    {selected.is_active&&<button type="button" disabled={busy} onClick={()=>remove(item.item_id)}>Remove</button>}
   </div>)}</div>:<p>{lootMoney.length?'No physical items in this container.':'This container has no physical items. Add items or currency below.'}</p>}
   <div className="nx-qr-loot-currency-list">
    <strong>Currency contents</strong>
    {lootMoney.length?lootMoney.map(m=><div key={m.currency_id}><span>{Number(m.amount).toLocaleString(undefined,{maximumFractionDigits:m.precision_digits})} {m.code} · {m.name}</span>
      {selected.is_active&&<button type="button" disabled={busy} onClick={()=>removeCurrency(m.currency_id)}>Remove</button>}</div>):<p>No currency added yet.</p>}
   </div>
   {selected.is_active&&<>
    <form className="nx-tool-form" onSubmit={saveCurrency}>
     <h4>Add or Update Currency</h4>
     <label>Denomination<select required value={currency} onChange={e=>{setCurrency(e.target.value);const current=lootMoney.find(m=>m.currency_id===e.target.value);setCurrencyAmount(current?String(current.amount):'')}}>
      <option value="">Choose campaign currency…</option>{currencies.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
     </select></label>
     <label>Amount<input required type="number" min="0.000001" max="1000000000" step="any" value={currencyAmount} onChange={e=>setCurrencyAmount(e.target.value)}/></label>
     <button type="submit" disabled={busy||!currency||!currencyAmount.trim()||Number(currencyAmount)<=0}>Save Currency to Container</button>
     {!currencies.length&&<p>Configure denominations under Campaign Currency first.</p>}
    </form>
    <form className="nx-tool-form" onSubmit={e=>void add(e)}>
     <label>Item definition<select required value={definition} onChange={e=>setDefinition(e.target.value)}>
      <option value="">Choose an item…</option>{catalog.map(d=><option key={d.id} value={d.id}>{d.name} ({d.category})</option>)}
     </select></label>
     <label>Quantity<input type="number" required min="1" max="500" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
     <button type="submit" disabled={busy||!definition||!Number.isInteger(Number(quantity))||Number(quantity)<1||Number(quantity)>500}>Add to Container</button>
    </form>
    <button type="button" disabled={busy||(items.length===0&&lootMoney.length===0)} onClick={generate}>Generate Single-Use QR Code</button>
    <button type="button" disabled={busy} onClick={()=>setActive(false)}>Disable Container</button>
   </>}
   {!selected.is_active&&selected.claims===0&&<button type="button" disabled={busy} onClick={()=>setActive(true)}>Reopen Unclaimed Container</button>}
   {rawToken&&tokenSource===source&&selected.is_active&&<div className="nx-qr-loot-code">
    <TradeQR url={url}/>
    <button type="button" onClick={()=>void navigator.clipboard.writeText(url)}>Copy Claim Link</button>
    <p>This is a bearer-style one-use claim link. Share only with the intended players. Create a fresh code if this one is lost.</p>
   </div>}
  </div>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="nx-character-list-error">{error}</p>}
 </section>;
}
