import React,{useEffect,useState} from 'react';
import {PackageOpen,CheckCircle2} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './qr-loot.css';
type Props={db:SupabaseClient;character:string;busy:boolean;onChanged:()=>Promise<void>};
const initialToken=()=>{try{return new URLSearchParams(window.location.search).get('loot')||''}catch{return ''}};
export default function ClaimLootPanel({db,character,busy,onChanged}:Props){
 const [open,setOpen]=useState(Boolean(initialToken()));
 const [token,setToken]=useState(initialToken());
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [confirm,setConfirm]=useState(false);
 useEffect(()=>{const t=initialToken();if(t){setToken(t);setOpen(true);setConfirm(false)}},[character]);
 const claim=async()=>{
  const raw=token.trim().toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(raw)){setError('Enter a valid QR loot token or paste a claim link.');return}
  if(working||busy)return;
  setWorking(true);setError('');setNotice('');
  try{
   const {error:rpcError}=await db.rpc('claim_loot_qr',{p_token:raw,p_character:character});
   if(rpcError)throw rpcError;
   setNotice('Loot claimed successfully. Container items and/or currency were added to your character.');
   setToken('');setConfirm(false);
   const url=new URL(window.location.href);url.searchParams.delete('loot');window.history.replaceState({},'',url.toString());
   await onChanged();
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setWorking(false)}
 };
 const paste=(value:string)=>{
  const raw=value.trim();
  try{const u=new URL(raw);setToken(u.searchParams.get('loot')||raw)}catch{setToken(raw)}
  setConfirm(false);
 };
 return <div className="mv-loot-claim">
  <button type="button" className="mv-loot-claim-trigger" disabled={busy} onClick={()=>setOpen(v=>!v)}>
   <PackageOpen size={24}/><strong>Claim Loot</strong><small>Enter or scan a GM loot QR</small>
  </button>
  {open&&<div className="mv-loot-claim-form">
   <p>Scan the GM's QR code with your phone's camera to open its claim link, then sign in and select your character. QR codes do not grant access without a campaign membership.</p>
   <label>Claim link or token<textarea rows={2} value={token} disabled={working} placeholder="Paste QR claim link or 64-character token" onChange={e=>paste(e.target.value)}/></label>
   {!confirm?<button type="button" disabled={busy||working||!token.trim()} onClick={()=>{setError('');setConfirm(true)}}>Review Loot Claim</button>:
    <div className="mv-loot-confirm">
     <p>Claim all items from this container for the current character? The first successful claim closes the container.</p>
     <div><button type="button" disabled={working} onClick={()=>setConfirm(false)}>Cancel</button>
      <button type="button" disabled={working||busy} onClick={()=>void claim()}>Confirm Claim</button></div>
    </div>}
   {error&&<p role="alert" className="mv-storage-error">{error}</p>}
   {notice&&<p role="status" className="mv-loot-success"><CheckCircle2 size={16}/>{notice}</p>}
  </div>}
  {!open&&notice&&<p role="status" className="mv-loot-success">{notice}</p>}
 </div>;
}
