import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {PackageOpen,CheckCircle2,Camera,CameraOff,X} from 'lucide-react';
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
 const [cameraModalOpen,setCameraModalOpen]=useState(false);
 const [cameraStarting,setCameraStarting]=useState(false);
 const [cameraError,setCameraError]=useState('');
 const videoRef=useRef<HTMLVideoElement>(null);
 const cameraCloseRef=useRef<HTMLButtonElement>(null);
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
  setCameraStarting(false);
 };
 const closeCamera=()=>{stopCamera();setCameraModalOpen(false)};
 const startCamera=async()=>{
  // getUserMedia is invoked directly from the user tap. Do not await a library
  // import first: iOS Safari requires the user-gesture camera permission flow.
  setOpen(true);setCameraModalOpen(true);setCameraStarting(true);setCameraError('');setNotice('');
  if(!navigator.mediaDevices?.getUserMedia){
   setCameraStarting(false);
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
   setCameraStarting(false);
   setCameraActive(true);
  }catch(e){
   if(request===cameraRequest.current){
    setCameraStarting(false);
    setCameraError('Unable to open the camera. Allow access in your browser settings, or paste a loot QR link. '+inventoryErrorMessage(e));
   }
  }
 };
 useEffect(()=>{stopCamera();setCameraModalOpen(false);setCameraError('')},[character]);
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
    controls.stop();closeCamera();
   }else setCameraError('That QR is not a Nexus loot claim. Point the camera at the GM loot QR code.');
  }).then(controls=>{
   if(active&&request===cameraRequest.current)scannerControls.current=controls;
   else controls.stop();
  }).catch(e=>{
   if(active)setCameraError('Camera scanning failed. Try the phone Camera app or paste the claim link. '+inventoryErrorMessage(e));
  });
  return()=>{active=false;scannerControls.current?.stop();scannerControls.current=null};
 },[cameraActive]);
 useEffect(()=>{
  if(!cameraModalOpen)return;
  const frame=window.requestAnimationFrame(()=>cameraCloseRef.current?.focus());
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    event.preventDefault();
    closeCamera();
   }else if(event.key==='Tab'){
    const dialog=cameraCloseRef.current?.closest('[role="dialog"]');
    const buttons=dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if(!buttons?.length)return;
    const first=buttons[0],last=buttons[buttons.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
   }
  };
  document.addEventListener('keydown',keydown);
  return()=>{window.cancelAnimationFrame(frame);document.removeEventListener('keydown',keydown)};
 },[cameraModalOpen]);
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
   onClick={()=>void startCamera()}>
   <PackageOpen size={24}/><strong>Claim Loot</strong><small>Enter or scan a GM loot QR</small>
  </button>
  {open&&<div className="mv-loot-claim-form">
   <p>Scan the GM's loot QR using your iPhone camera or paste its claim link. Loot is only awarded after you review and confirm.</p>
   <button type="button" className="mv-loot-camera-button" disabled={working||busy||cameraActive}
     onClick={()=>void startCamera()}><Camera size={17} aria-hidden="true"/> {cameraActive?'Camera scanning…':'Open Camera'}</button>
   {cameraError&&!cameraModalOpen&&<p className="mv-loot-camera-help" role="status">{cameraError}</p>}
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
  {cameraModalOpen&&createPortal(
   <div className="mv-modal-backdrop mv-loot-camera-backdrop"
     onMouseDown={event=>{if(event.currentTarget===event.target)closeCamera()}}>
    <section role="dialog" aria-modal="true" aria-labelledby="mv-loot-camera-title"
      aria-describedby="mv-loot-camera-guide" className="mv-item-modal mv-loot-camera-dialog">
     <div className="mv-modal-header">
      <div className="mv-modal-heading"><Camera size={23} aria-hidden="true"/><div>
       <span className="mv-modal-eyebrow">Claim Loot</span>
       <h3 id="mv-loot-camera-title">Scan Loot QR</h3>
      </div></div>
      <button ref={cameraCloseRef} type="button" className="mv-modal-close"
        aria-label="Close loot camera" onClick={closeCamera}><X size={22}/></button>
     </div>
     <div className="mv-modal-body mv-loot-camera-dialog-body">
      <div className="mv-loot-camera">
       <video ref={videoRef} autoPlay playsInline muted aria-label="Live loot QR camera preview"/>
       {cameraStarting&&<p className="mv-loot-camera-status" role="status">Opening camera… Allow camera access if prompted.</p>}
       {!cameraStarting&&!cameraActive&&cameraError&&
        <p className="mv-loot-camera-help" role="alert">{cameraError}</p>}
      </div>
      <p id="mv-loot-camera-guide">Center the GM's loot QR in the camera view. A valid scan will return you to the claim confirmation.</p>
      {cameraError&&cameraActive&&<p className="mv-loot-camera-help" role="status">{cameraError}</p>}
     </div>
     <div className="mv-modal-footer">
      <button type="button" className="mv-loot-camera-close" onClick={closeCamera}>
       <CameraOff size={16} aria-hidden="true"/> Close Camera
      </button>
     </div>
    </section>
   </div>,document.body)}
 </div>;
}
