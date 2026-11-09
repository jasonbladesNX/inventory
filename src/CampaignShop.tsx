import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ShoppingBag,RefreshCw} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './merchant-shop.css';
type Merchant={id:string;name:string;description:string;active:boolean};
type Listing={listing_id:string;definition_id:string;item_name:string;category:string;currency_id:string;currency_code:string;price:number|string;buyback:number|string;quantity:number;buys_from_players:boolean};
type SaleItem={item_id:string;definition_id:string;item_name:string;quantity:number|string};
type History={id:string;merchant_name:string;item_name:string;operation:string;quantity:number;currency_code:string;amount:number;occurred_at:string};
type Props={db:SupabaseClient;campaign:string;character:string;inventoryVersion:number;busy:boolean;onChanged:()=>Promise<void>};
export default function CampaignShop({db,campaign,character,inventoryVersion,busy,onChanged}:Props){
 const[merchants,setMerchants]=useState<Merchant[]>([]);
 const[merchant,setMerchant]=useState('');
 const[listings,setListings]=useState<Listing[]>([]);
 const[owned,setOwned]=useState<SaleItem[]>([]);
 const[history,setHistory]=useState<History[]>([]);
 const[quantity,setQuantity]=useState<Record<string,string>>({});
 const[saleItem,setSaleItem]=useState<Record<string,string>>({});
 const[working,setWorking]=useState(false),[loading,setLoading]=useState(true);
 const[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[confirm,setConfirm]=useState<{listing:Listing;action:'buy'|'sell';qty:number;itemId:string|null}|null>(null);
 const refresh=async(target:string)=>{
  const [m,l,i,h]=await Promise.all([
   db.rpc('list_campaign_merchants',{p_campaign:campaign}),
   target?db.rpc('list_merchant_stock',{p_merchant:target}):Promise.resolve({data:[],error:null}),
   db.rpc('list_character_merchant_sale_items',{p_character:character}),
   db.rpc('list_character_merchant_history',{p_character:character,p_limit:30})
  ]);
  for(const result of [m,l,i,h])if(result.error)throw result.error;
  setMerchants(m.data||[]);setListings(l.data||[]);setOwned(i.data||[]);setHistory(h.data||[]);
 };
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('');setConfirm(null);
  void Promise.resolve(db.rpc('list_campaign_merchants',{p_campaign:campaign})).then(({data,error:rpcError})=>{
   if(rpcError)throw rpcError;if(cancelled)return;
   const shops=(data||[]) as Merchant[];
   setMerchants(shops);
   setMerchant(prev=>shops.some(s=>s.id===prev)?prev:shops[0]?.id||'');
  }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))}).finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[db,campaign]);
 useEffect(()=>{
  if(!merchant){setListings([]);return}
  let cancelled=false;setLoading(true);setError('');
  void Promise.all([
   db.rpc('list_merchant_stock',{p_merchant:merchant}),
   db.rpc('list_character_merchant_sale_items',{p_character:character}),
   db.rpc('list_character_merchant_history',{p_character:character,p_limit:30})
  ]).then(([l,i,h])=>{
   for(const result of [l,i,h])if(result.error)throw result.error;
   if(!cancelled){setListings(l.data||[]);setOwned(i.data||[]);setHistory(h.data||[])}
  }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))}).finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[db,merchant,character,inventoryVersion]);
 const review=(listing:Listing,action:'buy'|'sell')=>{
  const qty=Number(quantity[listing.listing_id]??'1');
  const itemId=saleItem[listing.listing_id]??'';
  if(!Number.isInteger(qty)||qty<1||qty>500){setError('Enter 1 to 500 units.');return}
  if(action==='buy'&&qty>listing.quantity){setError('Not enough merchant stock.');return}
  if(action==='sell'&&!itemId){setError('Select an inventory item to sell.');return}
  const selected=owned.find(i=>i.item_id===itemId);
  if(action==='sell'&&(selected?.definition_id!==listing.definition_id||Number(selected.quantity)<qty)){
   setError('Not enough eligible items.');return;
  }
  setError('');setConfirm({listing,action,qty,itemId:action==='sell'?itemId:null});
 };
 const submit=async()=>{
  if(!confirm||working||busy)return;
  setWorking(true);setError('');setNotice('');
  try{
   const {data,error:rpcError}=await db.rpc('trade_with_campaign_merchant',{
    p_character:character,p_listing:confirm.listing.listing_id,p_action:confirm.action,
    p_quantity:confirm.qty,p_item:confirm.itemId
   });
   if(rpcError)throw rpcError;
   setConfirm(null);await onChanged();await refresh(merchant);
   setNotice(String(confirm.qty)+' × '+confirm.listing.item_name+' '+(confirm.action==='buy'?'purchased':'sold')+' for '+data.amount+' '+confirm.listing.currency_code+'.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setWorking(false)}
 };
 return <section className="mv-shop-screen">
  <div className="mv-shop-heading">
   <h3><ShoppingBag size={20}/> Campaign Shops</h3>
   <button type="button" disabled={working||loading||busy} onClick={()=>{
    setLoading(true);void refresh(merchant).catch(e=>setError(inventoryErrorMessage(e))).finally(()=>setLoading(false));
   }}><RefreshCw size={15}/> Refresh</button>
  </div>
  {loading&&<p>Loading merchants…</p>}
  <label className="mv-shop-select">Merchant
   <select value={merchant} disabled={working} onChange={e=>{setMerchant(e.target.value);setConfirm(null)}}>
    <option value="">Choose a merchant…</option>{merchants.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
   </select>
  </label>
  {!merchants.length&&!loading&&<p className="mv-empty">No open merchants yet. Your GM can create one in the GM Dashboard.</p>}
  {merchants.find(m=>m.id===merchant)?.description&&<p className="mv-shop-description">{merchants.find(m=>m.id===merchant)?.description}</p>}
  <div className="mv-shop-list">{listings.map(l=>{
   const eligible=owned.filter(i=>i.definition_id===l.definition_id&&Number(i.quantity)>0);
   return <div className="mv-shop-item" key={l.listing_id}>
    <div><strong>{l.item_name}</strong><small>{l.category} · In stock: {l.quantity}</small></div>
    <div className="mv-shop-prices"><span>Buy: {l.price} {l.currency_code}</span>{l.buys_from_players&&<span>Sell: {l.buyback} {l.currency_code}</span>}</div>
    <label>Quantity<input type="number" min="1" max="500" step="1" value={quantity[l.listing_id]??'1'} disabled={working} onChange={e=>setQuantity(v=>({...v,[l.listing_id]:e.target.value}))}/></label>
    <button type="button" disabled={working||busy||l.quantity<1} onClick={()=>review(l,'buy')}>Buy</button>
    {l.buys_from_players&&<>
     <label>Sell from inventory<select value={saleItem[l.listing_id]??''} disabled={working} onChange={e=>setSaleItem(v=>({...v,[l.listing_id]:e.target.value}))}>
      <option value="">Select an eligible copy…</option>{eligible.map(i=><option key={i.item_id} value={i.item_id}>{i.item_name} × {i.quantity}</option>)}
     </select></label>
     <button type="button" disabled={working||busy||eligible.length===0} onClick={()=>review(l,'sell')}>Sell</button>
    </>}
   </div>
  })}</div>
  {!!merchant&&!loading&&!listings.length&&<p className="mv-empty">This merchant has no listed merchandise.</p>}
  {confirm&&<div className="mv-shop-confirm" role="group" aria-label="Confirm merchant transaction">
   <strong>Confirm {confirm.action==='buy'?'purchase':'sale'}?</strong>
   <span>{confirm.qty} × {confirm.listing.item_name} for {Number(confirm.action==='buy'?confirm.listing.price:confirm.listing.buyback)*confirm.qty} {confirm.listing.currency_code}.</span>
   <div><button type="button" disabled={working} onClick={()=>setConfirm(null)}>Cancel</button>
    <button type="button" disabled={working||busy} onClick={()=>void submit()}>Confirm {confirm.action==='buy'?'Buy':'Sell'}</button></div>
  </div>}
  {notice&&<p role="status" className="mv-shop-notice">{notice}</p>}
  {error&&<p role="alert" className="mv-storage-error">{error}</p>}
  <section className="mv-shop-history"><h4>Merchant Transaction History</h4>
   {history.length?history.map(h=><div key={h.id}><strong>{h.operation==='buy'?'Bought':'Sold'} {h.quantity} × {h.item_name}</strong>
    <span>{h.merchant_name} · {h.amount} {h.currency_code} · {new Date(h.occurred_at).toLocaleString()}</span></div>):<p>No merchant purchases or sales yet.</p>}
  </section>
 </section>;
}
