import React, {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeftRight,Check,ChevronRight,Coins,Package,Plus,QrCode,RefreshCw,Share2,X} from 'lucide-react';
import './trading.css';
import TradeQR from './TradeQR';
import type {SupabaseClient} from '@supabase/supabase-js';
type Trade={trade_id:string;proposer_character_id:string;recipient_character_id:string;offer:any;trade_status:string;offer_version:number;expires_at:string;my_accepted:boolean;other_accepted:boolean};
type Item={item_id:string;name:string;quantity:number;eligible:boolean};
type Character={id:string;name:string};
type Currency={currency_id:string;code:string;name:string;available:number;precision_digits:number};
type ItemLine={item_id:string;quantity:number};
type MoneyLine={currency_id:string;amount:number};
type TradeLabel={item_id:string;item_label:string};
export default function Trading({db,campaign,character,characters,onInventoryChanged}:{db:SupabaseClient;campaign:string;character:string;characters:Character[];onInventoryChanged?:()=>Promise<void>}){
 const[itemLines,setItemLines]=useState<ItemLine[]>([]),[moneyLines,setMoneyLines]=useState<MoneyLine[]>([]),[trades,setTrades]=useState<Trade[]>([]),[items,setItems]=useState<Item[]>([]),[currencies,setCurrencies]=useState<Currency[]>([]),[currency,setCurrency]=useState(''),[amount,setAmount]=useState(''),[recipient,setRecipient]=useState(''),[item,setItem]=useState(''),[quantity,setQuantity]=useState('1'),[message,setMessage]=useState(''),[working,setWorking]=useState(false),[qrTrade,setQrTrade]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[counterTrade,setCounterTrade]=useState<string|null>(null),[tradeLabels,setTradeLabels]=useState<Record<string,string>>({});
 async function rpc<T=any>(name:string,args:any):Promise<T>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data as T}
 async function refresh(){if(!campaign||!character)return;setLoaded(false);const [t,i,c]=await Promise.all([rpc<Trade[]>('list_my_trades',{p_campaign:campaign}),rpc<Item[]>('list_character_inventory_for_trade',{p_character:character}),rpc<Currency[]>('list_my_trade_currency',{p_character:character})]);setTrades(t||[]);setItems(i||[]);setCurrencies(c||[]);const all=await Promise.all((t||[]).map(async offer=>{const labels=await rpc<TradeLabel[]>('list_trade_item_labels',{p_trade:offer.trade_id});return labels||[]}));setTradeLabels(Object.fromEntries(all.flat().map(x=>[x.item_id,x.item_label])));setLoaded(true)}
 useEffect(()=>{setLoaded(false);setInvitationShown(false);setDetailTrade(null);setComposerOpen(false);setQrTrade(null);setItemLines([]);setMoneyLines([]);setRecipient('');setCounterTrade(null);setCurrency('');setItem('');setAmount('');setQuantity('1');refresh().catch(e=>{setLoaded(true);setMessage(e.message)})},[campaign,character]);
 async function act(fn:()=>Promise<void>){setWorking(true);setMessage('');try{await fn();await refresh()}catch(e:any){setMessage(e.message||String(e))}finally{setWorking(false)}}
 const invitation=new URLSearchParams(window.location.search).get('trade');
 const [invitationShown,setInvitationShown]=useState(false);
 const [composerOpen,setComposerOpen]=useState(false);
 const [detailTrade,setDetailTrade]=useState<string|null>(null);
 useEffect(()=>{if(!invitation||invitationShown||!loaded)return;const match=trades.find(t=>t.trade_id===invitation);if(match){setDetailTrade(match.trade_id);setMessage('Trade invitation opened. Review the terms before approving.');}else setMessage('Trade invitation not found in this campaign or your account is not authorized to see it.');setInvitationShown(true)},[invitation,trades,invitationShown,loaded]);
 useEffect(()=>{
  if(!composerOpen&&!detailTrade&&!qrTrade)return;
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setComposerOpen(false);setDetailTrade(null);setQrTrade(null)}};
  document.addEventListener('keydown',close);
  return()=>document.removeEventListener('keydown',close);
 },[composerOpen,detailTrade,qrTrade]);
 if(!character)return <section className="panel"><h2>Player Trading</h2><p className="muted">Select your character to view trades.</p></section>;
 function addItemLine(){const n=Number(quantity),selected=items.find(x=>x.item_id===item);if(!selected||!selected.eligible||!Number.isFinite(n)||n<=0||n>Number(selected.quantity)||itemLines.some(x=>x.item_id===item)){setMessage('Select an eligible unused item and a valid quantity.');return}setItemLines(v=>[...v,{item_id:item,quantity:n}]);setItem('');setQuantity('1');setMessage('')}
 function addMoneyLine(){const n=Number(amount),selected=currencies.find(x=>x.currency_id===currency);if(!selected||!Number.isFinite(n)||n<=0||n>Number(selected.available)||!Number.isInteger(n*10**Number(selected.precision_digits||0))||moneyLines.some(x=>x.currency_id===currency)){setMessage('Select an unused currency and an amount within your balance.');return}setMoneyLines(v=>[...v,{currency_id:currency,amount:n}]);setCurrency('');setAmount('');setMessage('')}
 function offerSummary(t:Trade){
 const sections:[string,any[],string,string][]=[
 ['Proposer items',t.offer?.proposer_items||[],'item_id','quantity'],
 ['Proposer currency',t.offer?.proposer_currency||[],'currency_id','amount'],
 ['Recipient items',t.offer?.recipient_items||[],'item_id','quantity'],
 ['Recipient currency',t.offer?.recipient_currency||[],'currency_id','amount']];
 return sections.map(([label,lines,idKey,valueKey])=><div key={label} className="trade-terms"><strong>{label}</strong>{lines.length===0?<span className="muted"> None</span>:<ul>{lines.map((line:any,index:number)=><li key={index}>{String(line[valueKey])} × {idKey==='item_id'?(tradeLabels[String(line[idKey])]||'Item '+String(line[idKey]).slice(0,8)):(currencies.find(c=>c.currency_id===line[idKey])?.code||'Currency '+String(line[idKey]).slice(0,8))}</li>)}</ul>}</div>);
 }
 const selected=items.find(i=>i.item_id===item);
 const selectedCurrency=currencies.find(c=>c.currency_id===currency);
 const inviteUrl=(t:Trade)=>{const url=new URL(window.location.href);url.searchParams.set('campaign',campaign);url.searchParams.set('trade',t.trade_id);return url.toString()};
 const availableRecipients=characters.filter(c=>c.id!==character);
 const canUseTrade=(t:Trade)=>t.proposer_character_id===character||t.recipient_character_id===character;
 const hasExpiry=(t:Trade)=>!!t.expires_at&&!Number.isNaN(Date.parse(t.expires_at));
 const isExpired=(t:Trade)=>hasExpiry(t)&&Date.parse(t.expires_at)<=Date.now();

 const activeTrade=trades.find(t=>t.trade_id===detailTrade);
 const qrSelected=trades.find(t=>t.trade_id===qrTrade);
 const pending=trades.filter(t=>['proposed','countered','accepted'].includes(t.trade_status)&&!isExpired(t));
 const completed=trades.filter(t=>!pending.includes(t));
 const closeComposer=()=>{setComposerOpen(false);setCounterTrade(null);setItemLines([]);setMoneyLines([]);setRecipient('');setItem('');setCurrency('');setAmount('');setQuantity('1')};
 const openCounter=(t:Trade)=>{setCounterTrade(t.trade_id);setItemLines([]);setMoneyLines([]);setItem('');setCurrency('');setAmount('');setQuantity('1');setDetailTrade(null);setComposerOpen(true)};
 async function submitOffer(event:React.FormEvent){
  event.preventDefault();
  await act(async()=>{
   if(!itemLines.length&&!moneyLines.length)throw Error('Add an item or currency to your offer.');
   if(counterTrade){
    await rpc('counter_trade_offer',{p_trade:counterTrade,p_items:itemLines,p_currency:moneyLines});
    closeComposer();
    setMessage('Counteroffer submitted. Earlier approvals were cleared.');
   }else{
    if(!recipient)throw Error('Choose a recipient.');
    await rpc('create_trade_offer',{p_proposer:character,p_recipient:recipient,
     p_offer:{proposer_items:itemLines,recipient_items:[],proposer_currency:moneyLines,recipient_currency:[]}});
    closeComposer();
    setMessage('Trade proposal created.');
   }
  });
 }
 function statusLabel(t:Trade){if(isExpired(t)&&['proposed','countered','accepted'].includes(t.trade_status))return 'Expired';
  const labels:Record<string,string>={proposed:'Awaiting approval',countered:'Counteroffer',accepted:'Ready to settle',completed:'Completed',cancelled:'Cancelled'};
  return labels[t.trade_status]??t.trade_status;
 }
 function actionable(t:Trade){return canUseTrade(t)&&!isExpired(t)&&['proposed','countered','accepted'].includes(t.trade_status)}
 function offerCount(t:Trade){
  return ['proposer_items','recipient_items','proposer_currency','recipient_currency'].reduce((sum,k)=>sum+(Array.isArray(t.offer?.[k])?t.offer[k].length:0),0);
 }
 const currencyName=(id:string)=>currencies.find(c=>c.currency_id===id)?.code||id.slice(0,8);
 const detailModal=activeTrade&&createPortal(
  <div className="mv-modal-backdrop nx-trade-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDetailTrade(null)}}>
   <section className="mv-item-modal nx-trade-modal" role="dialog" aria-modal="true" aria-label="Trade details">
    <header className="mv-modal-header">
     <div className="mv-modal-heading"><ArrowLeftRight size={25}/><div><small className="mv-modal-eyebrow">Trade · version {activeTrade.offer_version}</small><h3>{activeTrade.proposer_character_id===character?'Outgoing trade':'Incoming trade'}</h3></div></div>
     <button type="button" className="mv-modal-close" aria-label="Close trade details" onClick={()=>setDetailTrade(null)}><X size={19}/></button>
    </header>
    <div className="mv-modal-body nx-trade-detail">
     <div className="nx-trade-detail-top"><span className={'nx-trade-status nx-trade-status-'+activeTrade.trade_status}>{statusLabel(activeTrade)}</span>
      <span className="nx-trade-version">Version {activeTrade.offer_version}</span></div>
     <div className="nx-trade-approval-grid">
      <div><Check size={15}/><span>Your approval</span><strong>{activeTrade.my_accepted?'Approved':'Pending'}</strong></div>
      <div><Check size={15}/><span>Other player</span><strong>{activeTrade.other_accepted?'Approved':'Pending'}</strong></div>
     </div>
     {hasExpiry(activeTrade)&&<p className="nx-trade-expiry">Expires: {new Date(activeTrade.expires_at).toLocaleString()}</p>}
     <h4 className="nx-trade-section-title">Exchange terms</h4>
     <div className="nx-trade-terms-grid">{offerSummary(activeTrade)}</div>
     <p className="nx-trade-note">Review every item and currency amount. Each player must approve the current offer version before anything can be transferred.</p>
    </div>
    <footer className="nx-trade-modal-footer">
     {actionable(activeTrade)&&!activeTrade.my_accepted&&<button type="button" className="nx-trade-primary" disabled={working} onClick={()=>{if(!window.confirm('Approve trade version '+activeTrade.offer_version+' after reviewing the terms?'))return;
      void act(async()=>{await rpc('accept_trade_offer_version',{p_trade:activeTrade.trade_id,p_expected_version:activeTrade.offer_version});setDetailTrade(null);setMessage('Your approval was recorded. Settlement is available once both players approve the same version.')})}}>Approve Offer</button>}
     {actionable(activeTrade)&&activeTrade.trade_status==='accepted'&&activeTrade.my_accepted&&activeTrade.other_accepted&&<button type="button" className="nx-trade-primary" disabled={working}
      onClick={()=>{if(!window.confirm('Both players approved offer version '+activeTrade.offer_version+'. Settle this trade and transfer items and currency?'))return;
       void act(async()=>{await rpc('finalize_approved_trade',{p_trade:activeTrade.trade_id});await onInventoryChanged?.();setDetailTrade(null);setMessage('Trade completed. Items and currency were transferred.')})}}>Settle Trade</button>}
     {activeTrade.recipient_character_id===character&&actionable(activeTrade)&&<button type="button" className="nx-trade-button" disabled={working} onClick={()=>openCounter(activeTrade)}>Counteroffer</button>}
     <button type="button" className="nx-trade-button" onClick={()=>{setDetailTrade(null);setQrTrade(activeTrade.trade_id)}}><QrCode size={16}/> Show QR</button>
     <button type="button" className="nx-trade-button" onClick={()=>void navigator.clipboard.writeText(inviteUrl(activeTrade)).then(()=>setMessage('Trade invitation link copied.')).catch(()=>setMessage('Unable to copy link.'))}><Share2 size={15}/> Copy Link</button>
     {actionable(activeTrade)&&<button type="button" className="nx-trade-danger" disabled={working} onClick={()=>{if(!window.confirm('Cancel this trade for both participants?'))return;
      void act(async()=>{await rpc('cancel_trade_offer',{p_trade:activeTrade.trade_id});setDetailTrade(null);setMessage('Trade cancelled.')})}}>Cancel Trade</button>}
    </footer>
   </section>
  </div>,document.body);
 const composeModal=composerOpen&&createPortal(
  <div className="mv-modal-backdrop nx-trade-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeComposer()}}>
   <section className="mv-item-modal nx-trade-modal" role="dialog" aria-modal="true" aria-label={counterTrade?'Counteroffer':'Create trade offer'}>
    <header className="mv-modal-header"><div className="mv-modal-heading"><ArrowLeftRight size={25}/><div><small className="mv-modal-eyebrow">Character trading</small><h3>{counterTrade?'Prepare Counteroffer':'New Trade Offer'}</h3></div></div>
     <button type="button" className="mv-modal-close" aria-label="Close trade composer" onClick={closeComposer}><X size={19}/></button>
    </header>
    <form className="nx-trade-form" onSubmit={e=>void submitOffer(e)}>
     <div className="mv-modal-body nx-trade-compose-body">
      {!counterTrade&&<label className="nx-trade-field">Trade with<select required value={recipient} onChange={e=>setRecipient(e.target.value)}>
       <option value="">Select a character…</option>{availableRecipients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {counterTrade&&<p className="nx-trade-note">Choose the items or currency you offer in return. Submitting replaces your side of the exchange and clears prior approvals.</p>}
      <div className="nx-trade-compose-block">
       <h4><Package size={16}/> Add an item</h4>
       <div className="nx-trade-add-grid">
        <label className="nx-trade-field">Item<select value={item} onChange={e=>setItem(e.target.value)}><option value="">Select eligible item…</option>
         {items.filter(i=>i.eligible&&!itemLines.some(l=>l.item_id===i.item_id)).map(i=><option key={i.item_id} value={i.item_id}>{i.name} ({i.quantity})</option>)}</select></label>
        <label className="nx-trade-field nx-trade-qty">Qty<input type="number" min="0.000001" step="any" max={selected?.quantity} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <button type="button" className="nx-trade-button" onClick={addItemLine} disabled={!item}><Plus size={16}/> Add</button>
       </div>
      </div>
      <div className="nx-trade-compose-block">
       <h4><Coins size={16}/> Add currency</h4>
       <div className="nx-trade-add-grid">
        <label className="nx-trade-field">Currency<select value={currency} onChange={e=>{setCurrency(e.target.value);setAmount('')}}><option value="">Select currency…</option>
         {currencies.filter(c=>Number(c.available)>0&&!moneyLines.some(l=>l.currency_id===c.currency_id)).map(c=><option key={c.currency_id} value={c.currency_id}>{c.name} ({c.code}: {c.available})</option>)}</select></label>
        <label className="nx-trade-field nx-trade-qty">Amount<input type="number" min="0" step={selectedCurrency?.precision_digits?Math.pow(10,-selectedCurrency.precision_digits):1} max={selectedCurrency?.available}
         value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <button type="button" className="nx-trade-button" disabled={!currency||!amount} onClick={addMoneyLine}><Plus size={16}/> Add</button>
       </div>
      </div>
      <div className="nx-trade-compose-block">
       <h4>Offer summary <span>{itemLines.length+moneyLines.length} entries</span></h4>
       {itemLines.length+moneyLines.length===0?<p className="nx-trade-note">Add at least one item or currency amount.</p>:
        <div className="nx-trade-selected">
         {itemLines.map(l=><div key={l.item_id}><span>{items.find(i=>i.item_id===l.item_id)?.name??l.item_id} × {l.quantity}</span><button type="button" onClick={()=>setItemLines(v=>v.filter(x=>x.item_id!==l.item_id))}>Remove</button></div>)}
         {moneyLines.map(l=><div key={l.currency_id}><span>{l.amount} {currencyName(l.currency_id)}</span><button type="button" onClick={()=>setMoneyLines(v=>v.filter(x=>x.currency_id!==l.currency_id))}>Remove</button></div>)}
        </div>}
      </div>
     </div>
     <footer className="nx-trade-modal-footer"><button type="button" className="nx-trade-button" onClick={closeComposer}>Cancel</button>
      <button type="submit" className="nx-trade-primary" disabled={working||(!counterTrade&&!recipient)||(!itemLines.length&&!moneyLines.length)}>{counterTrade?'Submit Counteroffer':'Propose Trade'}</button></footer>
    </form>
   </section>
  </div>,document.body);
 const qrModal=qrSelected&&createPortal(
  <div className="mv-modal-backdrop nx-trade-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setQrTrade(null)}}>
   <section className="mv-item-modal nx-trade-modal nx-trade-qr-modal" role="dialog" aria-modal="true" aria-label="Trade QR invitation">
    <header className="mv-modal-header"><div className="mv-modal-heading"><QrCode size={25}/><div><small className="mv-modal-eyebrow">Invite another player</small><h3>Trade QR Code</h3></div></div>
     <button type="button" className="mv-modal-close" aria-label="Close QR invitation" onClick={()=>setQrTrade(null)}><X size={19}/></button></header>
    <div className="mv-modal-body nx-trade-qr-body"><div className="nx-trade-qr-frame"><TradeQR url={inviteUrl(qrSelected)}/></div>
     <p>The recipient must sign in and be a participant in this trade. The QR code is not a transfer authorization.</p></div>
    <footer className="nx-trade-modal-footer"><button type="button" className="nx-trade-button" onClick={()=>void navigator.clipboard.writeText(inviteUrl(qrSelected)).then(()=>setMessage('Trade invitation link copied.')).catch(()=>setMessage('Unable to copy link.'))}><Share2 size={16}/> Copy Link</button>
     <button type="button" className="nx-trade-primary" onClick={()=>setQrTrade(null)}>Done</button></footer>
   </section>
  </div>,document.body);
 return <section className="mv-panel nx-trading" aria-label="Player trading">
  <div className="nx-trade-header"><div><h3><ArrowLeftRight size={20}/> Player Trading</h3><p>Exchange items and currency with other characters.</p></div>
   <div className="nx-trade-header-actions">
    <button type="button" className="nx-trade-icon-button" aria-label="Refresh trades" title="Refresh trades" disabled={working} onClick={()=>void act(async()=>{})}><RefreshCw size={17}/></button>
    <button type="button" className="nx-trade-primary" onClick={()=>{setCounterTrade(null);setItemLines([]);setMoneyLines([]);setComposerOpen(true)}}><Plus size={17}/> New Trade</button>
   </div></div>
  <div className="nx-trade-overview"><span><strong>{pending.length}</strong> Active</span><span><strong>{completed.length}</strong> History</span></div>
  {message&&<p className="nx-trade-notice" role="status">{message}</p>}
  {!loaded?<p className="nx-trade-empty">Loading trades…</p>:trades.length===0?<div className="nx-trade-empty"><ArrowLeftRight size={25}/><strong>No trades yet</strong><span>Start an exchange with another character using New Trade.</span></div>:
   <div className="nx-trade-list">
    {trades.map(t=><button type="button" id={'trade-'+t.trade_id} key={t.trade_id} className="nx-trade-row" onClick={()=>setDetailTrade(t.trade_id)}>
      <span className="nx-trade-row-icon"><ArrowLeftRight size={19}/></span>
      <span className="nx-trade-row-main"><strong>{t.proposer_character_id===character?'Outgoing Trade':'Incoming Trade'}</strong>
       <small>{offerCount(t)} entries · Version {t.offer_version} · {t.my_accepted?'You approved':'Your approval pending'}</small></span>
      <span className={'nx-trade-status nx-trade-status-'+t.trade_status}>{statusLabel(t)}</span><ChevronRight size={17} className="nx-trade-chevron"/>
     </button>)}
   </div>}
  <p className="nx-trade-footer-note">Transfers require both players to approve the same version. A QR code opens a trade invitation but never authorizes a transfer.</p>
  {detailModal}{composeModal}{qrModal}
 </section>;
}
