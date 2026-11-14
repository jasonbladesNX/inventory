import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './campaign-zones.css';

type Zone={id:string;name:string;active:boolean;turn:number;version:number};
type Character={id:string;name:string;zone_id:string};
type Event={id:string;zone_id:string;action:string;turn_before:number|null;turn_after:number|null;reason:string|null;created_at:string};
type ZoneState={zones:Zone[];characters:Character[];history:Event[]};
type Props={db:SupabaseClient;campaign:string};
const empty:ZoneState={zones:[],characters:[],history:[]};
export default function GmZoneManager({db,campaign}:Props){
 const [state,setState]=useState<ZoneState>(empty);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [feedback,setFeedback]=useState('');
 const [newName,setNewName]=useState('');
 const [rename,setRename]=useState<Record<string,string>>({});
 const [correction,setCorrection]=useState<Record<string,string>>({});
 const [reason,setReason]=useState<Record<string,string>>({});
 const [showHistory,setShowHistory]=useState(false);
 const refresh=useCallback(async()=>{
  const {data,error:e}=await db.rpc('list_campaign_zone_state',{p_campaign:campaign});
  if(e)throw e;setState((data??empty) as ZoneState);
 },[db,campaign]);
 useEffect(()=>{let cancelled=false;setLoading(true);setState(empty);
  void refresh().catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))}).finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[refresh]);
 useEffect(()=>{const timer=window.setInterval(()=>{if(!busy)void refresh().catch(()=>{})},15000);return()=>window.clearInterval(timer)},[refresh,busy]);
 async function act(action:string,zone?:string,fields:Record<string,unknown>={}){
  if(busy)return;setBusy(true);setError('');setFeedback('');
  try{
   const {error:e}=await db.rpc('manage_campaign_zone',{p_campaign:campaign,p_action:action,p_zone:zone??null,...fields});
   if(e)throw e;
   await refresh();setFeedback(action==='advance'?'Zone turn advanced.':action==='undo'?'Latest zone advancement safely undone.':'Zone update saved.');
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setBusy(false)}
 }
 return <section className="nx-zone-panel" aria-label="Campaign zone management">
  <p>Zones organize characters into independent groups. Advancing a zone affects only its own turn counter and the turn-based durations of characters currently assigned to it; rounds, minutes, hours and rests are separate.</p>
  <form className="nx-zone-add" onSubmit={e=>{e.preventDefault();if(newName.trim())void act('create',undefined,{p_name:newName.trim()}).then(()=>setNewName(''))}}>
   <label>New zone<input maxLength={100} required placeholder="Floor 1" value={newName} disabled={busy} onChange={e=>setNewName(e.target.value)}/></label>
   <button type="submit" disabled={busy||!newName.trim()}>Create Zone</button>
  </form>
  {loading?<p role="status">Loading zones…</p>:state.zones.map(z=>{
   const members=state.characters.filter(c=>c.zone_id===z.id);
   const why=reason[z.id]??'';
   const lastEvent=state.history.find(e=>e.zone_id===z.id&&['advance','correct','undo'].includes(e.action));
   return <section key={z.id} className="nx-zone-entry">
    <div className="nx-zone-heading"><strong>{z.name}</strong><span>{z.active?'Active':'Disabled'} · Turn {z.turn} · {members.length} character{members.length===1?'':'s'}</span></div>
    <div className="nx-zone-inline">
     <label>Rename<input value={rename[z.id]??z.name} maxLength={100} disabled={busy} onChange={e=>setRename(s=>({...s,[z.id]:e.target.value}))}/></label>
     <button type="button" disabled={busy||!(rename[z.id]??z.name).trim()||(rename[z.id]??z.name)===z.name} onClick={()=>void act('rename',z.id,{p_name:rename[z.id]})}>Save Name</button>
     <button type="button" disabled={busy||(z.active&&members.length>0)} onClick={()=>void act(z.active?'disable':'enable',z.id)}>{z.active?'Disable':'Enable'}</button>
    </div>
    <div className="nx-zone-roster">
     {members.length===0?<p className="nx-small-note">No characters assigned.</p>:members.map(c=><label key={c.id}>{c.name}
      <select aria-label={'Move '+c.name+' to zone'} value={z.id} disabled={busy} onChange={e=>{if(e.target.value!==z.id)void act('move',z.id,{p_character:c.id,p_target:e.target.value})}}>
       {state.zones.filter(target=>target.active).map(target=><option key={target.id} value={target.id}>{target.name}</option>)}
      </select></label>)}
    </div>
    <div className="nx-zone-clock">
     <button type="button" disabled={busy||!z.active} onClick={()=>void act('advance',z.id,{p_request:crypto.randomUUID()})}>Advance Zone Turn (+1)</button>
     <label>Correct to turn<input type="number" min={0} max={1000000000} step={1} disabled={busy} value={correction[z.id]??String(z.turn)} onChange={e=>setCorrection(s=>({...s,[z.id]:e.target.value}))}/></label>
    </div>
    <label>Reason for correction or undo<input maxLength={500} placeholder="Required when correcting or undoing" disabled={busy} value={why} onChange={e=>setReason(s=>({...s,[z.id]:e.target.value}))}/></label>
    <div className="nx-zone-inline">
     <button type="button" disabled={busy||!/^\\d+$/.test(correction[z.id]??String(z.turn))||Number(correction[z.id]??z.turn)>1000000000||Number(correction[z.id]??z.turn)===z.turn||why.trim().length<3} onClick={()=>void act('correct',z.id,{p_turn:Number(correction[z.id]),p_reason:why})}>Save Turn Correction</button>
     <button type="button" disabled={busy||lastEvent?.action!=='advance'||why.trim().length<3} onClick={()=>{if(window.confirm('Undo the most recent advance for this zone? This will only succeed if no affected character data or zone assignments changed.'))void act('undo',z.id,{p_reason:why})}}>Undo Latest Advance</button>
    </div>
   </section>;
  })}
  <button type="button" className="nx-zone-history-toggle" onClick={()=>setShowHistory(v=>!v)}>{showHistory?'Hide':'Show'} Zone History</button>
  {showHistory&&<div className="nx-zone-history">{state.history.length===0?<p>No recorded zone actions.</p>:state.history.map(e=><div key={e.id}>
   <strong>{state.zones.find(z=>z.id===e.zone_id)?.name??'Zone'} · {e.action.replaceAll('_',' ')}</strong>
   <span>{e.turn_before!=null&&e.turn_after!=null?e.turn_before+' → '+e.turn_after+' · ':''}{new Date(e.created_at).toLocaleString()}{e.reason?' · '+e.reason:''}</span>
  </div>)}</div>}
  <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh Zones</button>
  {feedback&&<p role="status">{feedback}</p>}
  {error&&<p role="alert" className="mv-storage-error">{error}</p>}
 </section>;
}
