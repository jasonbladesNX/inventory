import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './zone-initiative.css';

type Entry={character_id:string;name:string;modifier:number;roll:number|null;score:number|null;position:number|null};
type Event={action:string;created_at:string;details:Record<string,unknown>};
type Encounter={phase:'none'|'rolling'|'active'|'complete';round:number;active_position:number;entries:Entry[];history:Event[]};
const empty:Encounter={phase:'none',round:0,active_position:0,entries:[],history:[]};
export default function GmInitiativeManager({db,campaign}:{db:SupabaseClient;campaign:string}){
 const [zones,setZones]=useState<{id:string;name:string;active:boolean}[]>([]);
 const [zone,setZone]=useState('');
 const [encounter,setEncounter]=useState<Encounter>(empty);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [scores,setScores]=useState<Record<string,string>>({});
 const [positions,setPositions]=useState<Record<string,string>>({});
 const [rolls,setRolls]=useState<Record<string,string>>({});
 const [showHistory,setShowHistory]=useState(false);
 const refreshZones=useCallback(async()=>{
  const {data,error:e}=await db.rpc('list_campaign_zone_state',{p_campaign:campaign});
  if(e)throw e;
  const next=(data?.zones??[]) as {id:string;name:string;active:boolean}[];
  setZones(next);
  setZone(current=>next.some(z=>z.id===current&&z.active)?current:(next.find(z=>z.active)?.id??''));
 },[db,campaign]);
 const refresh=useCallback(async()=>{
  if(!zone)return;
  const {data,error:e}=await db.rpc('get_zone_initiative',{p_campaign:campaign,p_zone:zone});
  if(e)throw e;
  setEncounter((data??empty) as Encounter);
 },[db,campaign,zone]);
 useEffect(()=>{void refreshZones().catch(e=>setError(inventoryErrorMessage(e)))},[refreshZones]);
 useEffect(()=>{setEncounter(empty);setError('');void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 useEffect(()=>{const timer=window.setInterval(()=>{if(!busy)void refresh().catch(()=>{})},15000);return()=>window.clearInterval(timer)},[refresh,busy]);
 async function action(a:string,fields:Record<string,unknown>={}){
  if(!zone||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const request=crypto.randomUUID();
   const {error:e}=await db.rpc('manage_zone_initiative',{p_campaign:campaign,p_zone:zone,p_action:a,p_request:request,...fields});
   if(e)throw e;
   await refresh();setNotice(a==='request'?'Initiative rolls requested. Players can enter their d20 results.':a==='next'?'Advanced to the next participant.':'Initiative updated.');
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setBusy(false)}
 }
 const ready=encounter.entries.filter(e=>e.roll!=null).length;
 const current=encounter.entries.find(e=>e.position===encounter.active_position);
 return <section className="nx-initiative" aria-label="Campaign initiative manager">
  <p>Each zone has its own encounter, initiative order and combat rounds. Combat rounds expire only round-based effects in that zone. The Phase 9 zone turn counter remains a separate GM control.</p>
  <label>Zone <select value={zone} disabled={busy} onChange={e=>setZone(e.target.value)}>
   {zones.filter(z=>z.active).map(z=><option key={z.id} value={z.id}>{z.name}</option>)}
  </select></label>
  {zone&&<>
   <div className="nx-init-summary"><strong>{encounter.phase==='active'?'Combat active':encounter.phase==='rolling'?'Awaiting rolls':encounter.phase==='complete'?'Encounter ended':'No encounter'}</strong>
   <span>Round {encounter.round||'—'} · {ready}/{encounter.entries.length} rolls</span></div>
   {encounter.phase==='active'&&<p className="nx-init-active">Acting: <strong>{current?.name??'Unknown'}</strong> · Position {encounter.active_position}</p>}
   <div className="nx-init-actions">
    <button type="button" disabled={busy} onClick={()=>{if(encounter.phase==='active'&&!window.confirm('Reset this encounter and request fresh initiative rolls?'))return;void action('request')}}>Request Fresh Initiative</button>
    {encounter.phase==='rolling'&&<button type="button" disabled={busy||ready!==encounter.entries.length||!ready} onClick={()=>void action('start')}>Start Initiative Order</button>}
    {encounter.phase==='active'&&<button type="button" disabled={busy} onClick={()=>void action('next')}>Next Participant</button>}
    {(encounter.phase==='active'||encounter.phase==='rolling')&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm('End this encounter?'))void action('close')}}>End Encounter</button>}
   </div>
   <div className="nx-init-list">
    {encounter.entries.map(e=><div className={'nx-init-entry'+(encounter.phase==='active'&&e.position===encounter.active_position?' nx-init-current':'')} key={e.character_id}>
     <div className="nx-init-entry-header"><strong>{e.position??'—'}. {e.name}</strong><span>Modifier {e.modifier>=0?'+':''}{e.modifier} · Roll {e.roll??'—'} · Score {e.score??'—'}</span></div>
     {encounter.phase==='rolling'&&<div className="nx-init-edit"><label>Record d20 roll
       <input type="number" min={1} max={20} step={1} value={rolls[e.character_id]??String(e.roll??'')}
        onChange={ev=>setRolls(s=>({...s,[e.character_id]:ev.target.value}))}/></label>
       <button type="button" disabled={busy||!/^\d+$/.test(rolls[e.character_id]??'')||Number(rolls[e.character_id])<1||Number(rolls[e.character_id])>20}
        onClick={()=>void action('roll',{p_character:e.character_id,p_roll:Number(rolls[e.character_id])})}>Save Roll</button></div>}
     {encounter.phase==='active'&&<div className="nx-init-edit">
      <label>Adjust score<input type="number" min={-1000} max={1000} step={1} value={scores[e.character_id]??String(e.score??0)}
       onChange={ev=>setScores(s=>({...s,[e.character_id]:ev.target.value}))}/></label>
      <button type="button" disabled={busy||!/^[-]?\d+$/.test(scores[e.character_id]??'')||Number(scores[e.character_id])<-1000||Number(scores[e.character_id])>1000}
       onClick={()=>void action('adjust',{p_character:e.character_id,p_score:Number(scores[e.character_id])})}>Save Score</button>
      <label>Move to position<input type="number" min={1} max={encounter.entries.length} step={1} value={positions[e.character_id]??String(e.position??1)}
       onChange={ev=>setPositions(s=>({...s,[e.character_id]:ev.target.value}))}/></label>
      <button type="button" disabled={busy||!/^\d+$/.test(positions[e.character_id]??'')||Number(positions[e.character_id])<1||Number(positions[e.character_id])>encounter.entries.length}
       onClick={()=>void action('reorder',{p_character:e.character_id,p_position:Number(positions[e.character_id])})}>Move</button>
     </div>}
    </div>)}
   </div>
   <button type="button" onClick={()=>setShowHistory(v=>!v)}>{showHistory?'Hide':'Show'} Initiative History</button>
   {showHistory&&<div className="nx-init-history">{encounter.history.map((event,i)=><div key={i}>
    {event.action} · {new Date(event.created_at).toLocaleString()} · {JSON.stringify(event.details)}
   </div>)}</div>}
   <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh Initiative</button>
  </>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p className="mv-storage-error" role="alert">{error}</p>}
 </section>;
}
