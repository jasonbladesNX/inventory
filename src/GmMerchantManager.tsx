import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ShoppingBag} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
type Merchant={id:string;name:string;description:string;active:boolean};
type Definition={id:string;name:string;category:string};
type Currency={id:string;code:string;name:string;precision_digits:number};
type Listing={listing_id:string;definition_id:string;item_name:string;category:string;currency_id:string;currency_code:string;price:number|string;buyback:number|string;quantity:number;buys_from_players:boolean};
export default function GmMerchantManager({db,campaign,definitions}:{db:SupabaseClient;campaign:string;definitions:Definition[]}){
 const[merchants,setMerchants]=useState<Merchant[]>([]),[currencies,setCurrencies]=useState<Currency[]>([]);
 const[itemCatalog,setItemCatalog]=useState<Definition[]>([]);
 const[merchant,setMerchant]=useState(''),[listings,setListings]=useState<Listing[]>([]);
 const[name,setName]=useState(''),[description,setDescription]=useState(''),[active,setActive]=useState(true);
 const[definition,setDefinition]=useState(''),[currency,setCurrency]=useState(''),[price,setPrice]=useState('1'),[buyback,setBuyback]=useState('0');
 const[stock,setStock]=useState('1'),[buyFromPlayers,setBuyFromPlayers]=useState(false);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  const [m,c,d]=await Promise.all([
   db.rpc('list_campaign_merchants',{p_campaign:campaign}),
   db.rpc('list_campaign_currency_definitions',{p_campaign:campaign}),
   db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign})
  ]);
  if(m.error)throw m.error;if(c.error)throw c.error;if(d.error)throw d.error;
  setMerchants(m.data||[]);setCurrencies(c.data||[]);setItemCatalog(d.data||[]);
 };
 useEffect(()=>{let cancelled=false;setMerchants([]);setListings([]);setMerchant('');setError('');
  void Promise.all([db.rpc('list_campaign_merchants',{p_campaign:campaign}),db.rpc('list_campaign_currency_definitions',{p_campaign:campaign}),db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign})])
  .then(([a,b,d])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(d.error)throw d.error;if(!cancelled){setMerchants(a.data||[]);setCurrencies(b.data||[]);setItemCatalog(d.data||[])}})
  .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,campaign,definitions.length]);
 useEffect(()=>{if(!merchant){setListings([]);return}let cancelled=false;
  void db.rpc('list_merchant_stock',{p_merchant:merchant}).then(({data,error:rpcError})=>{
   if(rpcError)throw rpcError;if(!cancelled)setListings(data||[]);
  }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,merchant]);
 const choose=(id:string)=>{
  setMerchant(id);const m=merchants.find(row=>row.id===id);
  setName(m?.name??'');setDescription(m?.description??'');setActive(m?.active??true);
 };
 const saveMerchant=async(e:React.FormEvent)=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   const {data,error:rpcError}=await db.rpc('save_campaign_merchant',{p_campaign:campaign,p_name:name.trim(),p_merchant:merchant||null,p_description:description.trim(),p_active:active});
   if(rpcError)throw rpcError;await load();setMerchant(String(data));setNotice('Merchant saved.');
  }catch(ex){setError(inventoryErrorMessage(ex))}finally{setBusy(false)}
 };
 const chooseListing=(id:string)=>{
  const l=listings.find(row=>row.listing_id===id);
  if(!l)return;
  setDefinition(l.definition_id);setCurrency(l.currency_id);setPrice(String(l.price));setBuyback(String(l.buyback));
  setStock(String(l.quantity));setBuyFromPlayers(l.buys_from_players);
 };
 const saveListing=async(e:React.FormEvent)=>{
  e.preventDefault();if(busy||!merchant)return;setBusy(true);setError('');setNotice('');
  try{
   const {error:rpcError}=await db.rpc('save_merchant_listing',{
    p_merchant:merchant,p_definition:definition,p_currency:currency,p_price:Number(price),
    p_buyback:Number(buyback),p_quantity:Number(stock),p_buys:buyFromPlayers
   });
   if(rpcError)throw rpcError;
   const {data,error:loadError}=await db.rpc('list_merchant_stock',{p_merchant:merchant});
   if(loadError)throw loadError;setListings(data||[]);setNotice('Merchandise and stock saved.');
  }catch(ex){setError(inventoryErrorMessage(ex))}finally{setBusy(false)}
 };
 return <section className="nx-page-card nx-gm-tools" aria-label="Campaign Merchants">
  <h2><ShoppingBag size={20}/> Campaign Merchants</h2>
  <p>Create campaign shops, define fixed prices and available stock, and optionally allow buyback of ordinary inventory items.</p>
  <label>Existing merchant<select value={merchant} disabled={busy} onChange={e=>choose(e.target.value)}>
   <option value="">Create new merchant…</option>{merchants.map(m=><option key={m.id} value={m.id}>{m.name}{m.active?'':' (inactive)'}</option>)}
  </select></label>
  <form className="nx-tool-form" onSubmit={e=>void saveMerchant(e)}>
   <h3>{merchant?'Edit Merchant':'Add Merchant'}</h3>
   <label>Name<input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
   <label>Description<input maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   <label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Open for players</label>
   <button type="submit" disabled={busy||name.trim().length<2}>Save Merchant</button>
  </form>
  {merchant&&<form className="nx-tool-form" onSubmit={e=>void saveListing(e)}>
   <h3>Merchant Stock & Prices</h3>
   <label>Edit listed merchandise<select value="" onChange={e=>chooseListing(e.target.value)}>
    <option value="">Choose a listing to edit…</option>
    {listings.map(l=><option key={l.listing_id} value={l.listing_id}>{l.item_name} · {l.price} {l.currency_code} · Stock {l.quantity}</option>)}
   </select></label>
   <label>Item definition<select required value={definition} onChange={e=>setDefinition(e.target.value)}>
    <option value="">Choose item…</option>{itemCatalog.map(d=><option value={d.id} key={d.id}>{d.name} ({d.category})</option>)}
   </select></label>
   <label>Currency<select required value={currency} onChange={e=>setCurrency(e.target.value)}>
    <option value="">Choose denomination…</option>{currencies.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
   </select></label>
   <label>Price per unit<input type="number" required min={0} max={1000000000} step="any" value={price} onChange={e=>setPrice(e.target.value)}/></label>
   <label>Buyback price per unit<input type="number" required min={0} max={1000000000} step="any" value={buyback} onChange={e=>setBuyback(e.target.value)}/></label>
   <label>Available stock<input type="number" required min={0} max={1000000} step="1" value={stock} onChange={e=>setStock(e.target.value)}/></label>
   <label><input type="checkbox" checked={buyFromPlayers} onChange={e=>setBuyFromPlayers(e.target.checked)}/> Merchant buys this item from players</label>
   <button type="submit" disabled={busy||!definition||!currency}>Save Merchandise</button>
   {!currencies.length&&<p>Create a currency denomination in Campaign Currency before adding merchandise.</p>}
   {!itemCatalog.length&&<p>No campaign or ruleset items are available. Create an item in the GM Item Catalog first.</p>}
  </form>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="nx-character-list-error">{error}</p>}
 </section>;
}
