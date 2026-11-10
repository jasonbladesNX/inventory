import React,{useEffect,useRef,useState} from 'react';
import {PackageOpen,CheckCircle2,Camera,CameraOff} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BrowserQRCodeReader} from '@zxing/browser';
import {inventoryErrorMessage} from './inventoryErrors';
import './qr-loot.css';
type Props={db:SupabaseClient;character:string;busy:boolean;onChanged:()=>Promise<void>};
const qrToken=(raw:string)=>{
  let value=raw.trim();
  try{const url=new URL(value);value=url.searchParams.get('loot')??''}catch{}
  return /^[0-9a-f]{64}$/i.test(value)?value.toLowerCase():null;
};
const initialToken=()=>{try{return new URLSearchParams(window.location.search).get('loot')||''}catch{return ''}};
export default function ClaimLootPanel({db,character,busy,onChanged}:Props){
 const [open,setOpen]=useState(Boolean(initialToken()));
 const [token,setToken]=useState(initialToken());
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [confirm,setConfirm]=useState(false);
 const [cameraActive,setCameraActive]=useState(false);
 const [cameraError,setCameraError]=useState('');
 const videoRef=useRef<HTMLVideoElement>(null);
 const streamRef=useRef<MediaStream|null>(null);
 const scannerControls=useRef<{stop:()=>void}|null>(null);
 const cameraRequest=useRef(0);
 const stopCamera=()=>{
  cameraRequest.current++;
  scannerControls.current?.stop();scannerControls.current=null;
  streamRef.current?.getTracks().forEach(track=>track.stop());
  streamRef.current=null;
  if(videoRef.current)videoRef.current.srcObject=null;
  setCameraActive(false);
 };
 const startCamera=async()=>{
  // getUserMedia is invoked directly from the user tap. Do not await a library
  // import first: iOS Safari requires the user-gesture camera permission flow.
  setOpen(true);setCameraError('');setNotice('');
  if(!navigator.mediaDevices?.getUserMedia){
   setCameraError('Camera access requires HTTPS and a compatible browser. Use Safari or paste a claim link.');
   return;
  }
  const request=++cameraRequest.current;
  try{
   const stream=await navigator.mediaDevices.getUserMedia({
     video:{facingMode:{ideal:'environment'}},audio:false
   });
   if(request!==cameraRequest.current){stream.getTracks().forEach(track=>track.stop());return}
   streamRef.current=stream;
   setCameraActive(true);
  }catch(e){
   if(request===cameraRequest.current)setCameraError('Unable to open the camera. Allow access in iPhone Settings → Safari → Camera, or paste a loot QR link. '+inventoryErrorMessage(e));
  }
 };
 useEffect(()=>{stopCamera();setCameraError('')},[character]);
 useEffect(()=>()=>{
  cameraRequest.current++;
  scannerControls.current?.stop();
  streamRef.current?.getTracks().forEach(track=>track.stop());
 },[]);
 useEffect(()=>{
  if(!cameraActive||!videoRef.current||!streamRef.current)return;
  let active=true;
  const request=cameraRequest.current;
  const reader=new BrowserQRCodeReader();
  const video=videoRef.current;
  void reader.decodeFromStream(streamRef.current,video,(result,_err,controls)=>{
   if(!active||!result)return;
   const found=qrToken(result.getText());
   if(found){
    setToken(found);setConfirm(false);setCameraError('');
    setNotice('QR code scanned. Review the claim before confirming.');
    controls.stop();stopCamera();
   }else setCameraError('That QR is not a Nexus loot claim. Point the camera at the GM loot QR code.');
  }).then(controls=>{
   if(active&&request===cameraRequest.current)scannerControls.current=controls;
   else controls.stop();
  }).catch(e=>{
   if(active)setCameraError('Camera scanning failed. Try the phone Camera app or paste the claim link. '+inventoryErrorMessage(e));
  });
  return()=>{active=false;scannerControls.current?.stop();scannerControls.current=null};
 },[cameraActive]);
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
  <button type="button" className="mv-loot-claim-trigger" disabled={busy}
   onClick={()=>{if(cameraActive){stopCamera()}else{setOpen(true);void startCamera()}}}>
   <PackageOpen size={24}/><strong>Claim Loot</strong><small>Enter or scan a GM loot QR</small>
  </button>
  {open&&<div className="mv-loot-claim-form">
   <p>Scan the GM's loot QR using your iPhone camera or paste its claim link. Loot is only awarded after you review and confirm.</p>
   <button type="button" className="mv-loot-camera-button" disabled={working||busy||cameraActive}
     onClick={()=>void startCamera()}><Camera size={17} aria-hidden="true"/> {cameraActive?'Camera scanning…':'Open Camera'}</button>
   {cameraActive&&<div className="mv-loot-camera">
     <video ref={videoRef} autoPlay playsInline muted aria-label="Live QR scanning camera preview"/>
     <button type="button" onClick={stopCamera}><CameraOff size={16} aria-hidden="true"/> Close Camera</button>
   </div>}
   {cameraError&&<p className="mv-loot-camera-help" role="status">{cameraError}</p>}
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
