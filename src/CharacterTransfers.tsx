import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './character-transfers.css';
type Character={character_id:string;character_name:string;campaign_id:string;campaign_name:string};
type Target={id:string;name:string};
type Transfer={id:string;character_id:string;character_name:string;source_campaign:string;target_campaign:string;status:string;reason:string;created_at:string;can_approve_source:boolean;can_approve_target:boolean;can_cancel:boolean};
export default function CharacterTransfers({db,campaign,characters=[]}:{db:SupabaseClient;campaign?:string;characters?:Character[]}){
 const [requests,setRequests]=useState<Transfer[]>([]);
 const [chosen,setChosen]=useState('');
 const [destination,setDestination]=useState('');
 const [targets,setTargets]=useState<Target[]>([]);
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [readiness,setReadiness]=useState<Record<string,{ruleset_match:boolean;dependencies:Record<string,number>;migration_available:boolean;guidance:string}>>({});
 async function checkReadiness(id:string){
  setError('');
  const {data,error:e}=await db.rpc('get_character_transfer_readiness',{p_request:id});
  if(e){setError(inventoryErrorMessage(e));return}
  setReadiness(current=>({...current,[id]:data}));
 }
  const refresh=useCallback(async()=>{
  const {data,error:e}=await db.rpc('list_character_transfer_requests',{p_campaign:campaign??null});
  if(e)throw e;setRequests((data??[]) as Transfer[]);
 },[db,campaign]);
 useEffect(()=>{void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 useEffect(()=>{if(!chosen){setTargets([]);setDestination('');return}
  let live=true;
  void db.rpc('list_character_transfer_targets',{p_character:chosen}).then(({data,error:e})=>{
   if(!live)return;
   if(e)setError(inventoryErrorMessage(e));else{setTargets((data??[]) as Target[]);setDestination('')}
  });return()=>{live=false};
 },[db,chosen]);
 async function mutate(action:string,request?:string){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('manage_character_transfer',{
    p_action:action,p_character:action==='request'?chosen:null,
    p_target_campaign:action==='request'?destination:null,
    p_request:request??null,p_reason:action==='request'?reason:''
   });
   if(e)throw e;
   if(action==='request'){setChosen('');setDestination('');setReason('')}
   await refresh();setNotice(action==='request'?'Transfer request submitted for source GM review.':'Transfer request updated.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 return <section className="nx-transfer" aria-label="Character transfer requests">
  <p>Move a character between campaigns only after both GMs approve. Approval does not move inventories or ruleset data automatically; safe migration remains a separate step.</p>
  {characters.length>0&&<form className="nx-transfer-form" onSubmit={e=>{e.preventDefault();void mutate('request')}}>
   <label>Character<select required value={chosen} disabled={busy} onChange={e=>setChosen(e.target.value)}>
    <option value="">Choose character</option>{characters.map(c=><option key={c.character_id} value={c.character_id}>{c.character_name} — {c.campaign_name}</option>)}
   </select></label>
   <label>Destination campaign<select required disabled={!chosen||busy} value={destination} onChange={e=>setDestination(e.target.value)}>
    <option value="">Choose a campaign you have joined</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
   </select></label>
   <label>Reason (optional)<textarea rows={2} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
   <button type="submit" disabled={busy||!chosen||!destination}>Request Character Transfer</button>
   {chosen&&targets.length===0&&<p className="nx-small-note">No other eligible campaign memberships were found for this character.</p>}
  </form>}
  <h3>Transfer requests</h3>
  <div className="nx-transfer-list">{requests.length===0?<p>No transfer requests.</p>:requests.map(t=><article key={t.id}>
   <strong>{t.character_name}</strong><span>{t.source_campaign} → {t.target_campaign}</span>
   <span>Status: {t.status.replaceAll('_',' ')}</span>
   {t.reason&&<p>{t.reason}</p>}
   <small>{new Date(t.created_at).toLocaleString()}</small>
   {t.status==='approved_pending_migration'&&<div className="nx-transfer-readiness">
    <button type="button" disabled={busy} onClick={()=>void checkReadiness(t.id)}>Review Migration Dependencies</button>
    {readiness[t.id]&&<>
     <p>Rulesets: {readiness[t.id].ruleset_match?'Match':'Different'}</p>
     <p>{readiness[t.id].guidance}</p>
     <ul>{Object.entries(readiness[t.id].dependencies).map(([key,count])=><li key={key}>{key.replaceAll('_',' ')}: {count}</li>)}</ul>
    </>}
   </div>}
      <div className="nx-transfer-actions">
    {t.can_approve_source&&<button type="button" disabled={busy} onClick={()=>void mutate('approve_source',t.id)}>Approve as Source GM</button>}
    {t.can_approve_target&&<button type="button" disabled={busy} onClick={()=>void mutate('approve_target',t.id)}>Approve as Destination GM</button>}
    {(t.can_approve_source||t.can_approve_target)&&<button type="button" disabled={busy} onClick={()=>void mutate('reject',t.id)}>Reject</button>}
    {t.can_cancel&&<button type="button" disabled={busy} onClick={()=>void mutate('cancel',t.id)}>Cancel Request</button>}
   </div>
  </article>)}</div>
  <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh Transfers</button>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="mv-storage-error">{error}</p>}
 </section>;
}
