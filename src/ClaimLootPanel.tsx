import React,{useEffect,useRef,useState} from 'react';
import {PackageOpen,CheckCircle2,Camera,CameraOff} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './qr-loot.css';
type Props={db:SupabaseClient;character:string;busy:boolean;onChanged:()=>Promise<void>};
type QRDetectorCtor=new (options:{formats:string[]})=>{detect:(source:HTMLVideoElement)=>Promise<{rawValue:string}[]>};
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
 const scanFrameRef=useRef<number|null>(null);
 const cameraRequestRef=useRef(0);
 const stopCamera=()=>{
  cameraRequestRef.current++;
  if(scanFrameRef.current!==null){window.cancelAnimationFrame(scanFrameRef.current);scanFrameRef.current=null}
  streamRef.current?.getTracks().forEach(track=>track.stop());
  streamRef.current=null;
  if(videoRef.current)videoRef.current.srcObject=null;
  setCameraActive(false);
 };
 const startCamera=async()=>{
  setOpen(true);setCameraError('');
  const Detector=(window as Window & {BarcodeDetector?:QRDetectorCtor}).BarcodeDetector;
  if(!Detector){setCameraError('Live QR scanning is not supported in this browser. Use your phone camera app to scan the QR link, or paste the claim token below.');return;}
  if(!navigator.mediaDevices?.getUserMedia){setCameraError('Device camera access requires a supported secure browser. Paste a QR claim link below instead.');return;}
  const request=++cameraRequestRef.current;
  try{
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(request!==cameraRequestRef.current){stream.getTracks().forEach(track=>track.stop());return}
   streamRef.current=stream;
   setCameraActive(true);
  }catch(e){if(request===cameraRequestRef.current)setCameraError('Unable to open camera. Allow camera permission in your browser or paste the QR claim link below. '+inventoryErrorMessage(e))}
 };
 useEffect(()=>{stopCamera();setCameraError('')},[character]);
 useEffect(()=>()=>{
  cameraRequestRef.current++;
  if(scanFrameRef.current!==null)window.cancelAnimationFrame(scanFrameRef.current);
  streamRef.current?.getTracks().forEach(track=>track.stop());
 },[]);
 useEffect(()=>{
  if(!cameraActive||!videoRef.current||!streamRef.current)return;
  const video=videoRef.current;
  video.srcObject=streamRef.current;
  void video.play().catch(()=>setCameraError('Camera preview could not start. Use the normal phone camera app or paste the claim link.'));
  const Detector=(window as Window & {BarcodeDetector?:QRDetectorCtor}).BarcodeDetector;
  if(!Detector)return;
  const detector=new Detector({formats:['qr_code']});
  let active=true;
  const detect=async()=>{
   if(!active)return;
   if(video.readyState>=2){
    try{
     const results=await detector.detect(video);
     const found=results.map(value=>qrToken(value.rawValue)).find(Boolean);
     if(found){setToken(found);setConfirm(false);setNotice('QR code scanned. Review the claim before confirming.');stopCamera();return;}
    }catch{/* A frame may be unusable while the camera is adjusting focus. */}
   }
   if(active)scanFrameRef.current=window.requestAnimationFrame(()=>{void detect()});
  };
  scanFrameRef.current=window.requestAnimationFrame(()=>{void detect()});
  return()=>{active=false;if(scanFrameRef.current!==null)window.cancelAnimationFrame(scanFrameRef.current)};
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
   onClick={()=>{if(open){stopCamera();setOpen(false)}else{setOpen(true);void startCamera()}}}>
   <PackageOpen size={24}/><strong>Claim Loot</strong><small>Enter or scan a GM loot QR</small>
  </button>
  {open&&<div className="mv-loot-claim-form">
   <p>Use the camera to scan the GM's loot QR, or paste its claim link. The loot is not awarded until you review and confirm. Campaign membership is still required.</p>
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
