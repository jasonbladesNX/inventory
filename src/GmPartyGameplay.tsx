import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import PartyChat from './PartyChat';
import PartyCombatBoard from './PartyCombatBoard';
type Party={id:string;name:string;members:{character_id:string;name:string}[]};
type Zone={id:string;name:string;active:boolean};
type Summary={party_id:string;name:string;bank_items:{id:string;name:string;quantity:number}[];members:{character_id:string;name:string;zone_name:string|null;hp:{current:number;max:number}|null;initiative_roll:number|null;initiative_score:number|null}[]};
export default function GmPartyGameplay({db,campaign}:{db:SupabaseClient;campaign:string}){
 const [parties,setParties]=useState<Party[]>([]),[zones,setZones]=useState<Zone[]>([]);
 const [party,setParty]=useState(''),[zone,setZone]=useState(''),[restKind,setRestKind]=useState('long'),[hours,setHours]=useState('8');
 const [body,setBody]=useState(''),[summary,setSummary]=useState<Summary|null>(null);
 const [lootItem,setLootItem]=useState(''),[lootTarget,setLootTarget]=useState(''),[lootQty,setLootQty]=useState('1');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const [pr,zr]=await Promise.all([db.rpc('list_campaign_parties',{p_campaign:campaign}),db.rpc('list_campaign_zone_state',{p_campaign:campaign})]);
  if(pr.error)throw pr.error;if(zr.error)throw zr.error;
  setParties((pr.data??[]) as Party[]);
  setZones((zr.data?.zones??[]) as Zone[]);
 },[db,campaign]);
 useEffect(()=>{void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 useEffect(()=>{if(!party){setSummary(null);return}
  let mounted=true;void db.rpc('get_party_gameplay_summary',{p_party:party}).then(({data,error:e})=>{
   if(!mounted)return;if(e)setError(inventoryErrorMessage(e));else setSummary(data as Summary);
  });return()=>{mounted=false};
 },[db,party]);
 async function act(action:'move'|'rest'|'message'){
  if(busy||!party)return;
  const label=action==='move'?'Move all eligible party characters to the selected zone?':
   action==='rest'?'Apply this rest to every active party character? If one character cannot rest, the group action is rolled back.':
   'Send this message privately to every party player?';
  if(!window.confirm(label))return;
  setBusy(true);setError('');setNotice('');
  try{const {error:e}=await db.rpc('manage_party_gameplay',{
   p_party:party,p_action:action,p_zone:action==='move'?zone:null,
   p_kind:action==='rest'?restKind:null,p_hours:action==='rest'?Number(hours):0,
   p_message:action==='message'?body:null
  });
   if(e)throw e;
   setNotice('Party '+action+' completed.');
   if(action==='message')setBody('');
   const response=await db.rpc('get_party_gameplay_summary',{p_party:party});
   if(response.error)throw response.error;
   setSummary(response.data as Summary);
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 async function distribute(){
  if(busy||!party||!lootItem||!lootTarget)return;
  if(!window.confirm('Distribute the selected party-bank loot to this character? Bank transfers are allowed between sessions only.'))return;
  setBusy(true);setError('');setNotice('');
  try{const {error:e}=await db.rpc('distribute_party_bank_loot',{
    p_party:party,p_item:lootItem,p_target_character:lootTarget,p_quantity:Number(lootQty)
   });
   if(e)throw e;
   const {data,error:refreshError}=await db.rpc('get_party_gameplay_summary',{p_party:party});
   if(refreshError)throw refreshError;
   setSummary(data as Summary);setLootItem('');setLootQty('1');
   setNotice('Party bank loot distributed.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
  return <section style={{display:'grid',gap:12}}>
  <p>Manage a party across campaign zones, view its initiative summary, apply an atomic group rest, or notify party players privately.</p>
  <label>Party<select value={party} onChange={e=>setParty(e.target.value)}>
   <option value="">Choose party…</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {party&&<>
   <h3>Party Members & Initiative</h3>
   {summary?.members.length?<div style={{display:'grid',gap:7}}>
    {summary.members.map(m=><div key={m.character_id} style={{padding:9,border:'1px solid #36758b',borderRadius:8,display:'grid',gap:4}}>
      <strong>{m.name}</strong>
      <small>Zone: {m.zone_name??'Unassigned'} · HP: {m.hp?.current??'—'}/{m.hp?.max??'—'} · Initiative: {m.initiative_score??'—'}</small>
    </div>)}
   </div>:<p>No active party characters.</p>}
   <div style={{display:'grid',gap:8}}>
    <h3>Move Party</h3>
    <label>Destination zone<select value={zone} onChange={e=>setZone(e.target.value)}>
     <option value="">Select an active zone</option>{zones.filter(z=>z.active).map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
    <button type="button" disabled={busy||!zone} onClick={()=>void act('move')}>Move Party to Zone</button>
   </div>
   <div style={{display:'grid',gap:8}}>
    <h3>Group Rest</h3>
    <p>Short rests spend zero hit dice by default. Each character must have valid rest settings. Hours advance each character's timed effects.</p>
    <label>Rest type<select value={restKind} onChange={e=>{setRestKind(e.target.value);setHours(e.target.value==='long'?'8':'1')}}>
     <option value="short">Short Rest</option><option value="long">Long Rest</option></select></label>
    <label>In-game hours<input type="number" min="0" max="24" step="1" value={hours} onChange={e=>setHours(e.target.value)}/></label>
    <button type="button" disabled={busy||Number(hours)<0||Number(hours)>24} onClick={()=>void act('rest')}>Apply Group Rest</button>
   </div>
   <div style={{display:'grid',gap:8}}>
    <h3>Distribute Party Bank Loot</h3>
    <p>GM distribution is available between sessions and transfers an item directly into a party member's inventory.</p>
    <label>Banked item<select value={lootItem} onChange={e=>setLootItem(e.target.value)}>
     <option value="">Choose shared item…</option>{(summary?.bank_items??[]).map(item=><option key={item.id} value={item.id}>{item.name} ({item.quantity})</option>)}</select></label>
    <label>Recipient<select value={lootTarget} onChange={e=>setLootTarget(e.target.value)}>
     <option value="">Choose recipient…</option>{(summary?.members??[]).map(m=><option key={m.character_id} value={m.character_id}>{m.name}</option>)}</select></label>
    <label>Quantity<input type="number" min="0.000001" step="any"
     max={summary?.bank_items?.find(i=>i.id===lootItem)?.quantity} value={lootQty} onChange={e=>setLootQty(e.target.value)}/></label>
    <button type="button" disabled={busy||!lootItem||!lootTarget} onClick={()=>void distribute()}>Distribute Loot</button>
   </div>
   <PartyCombatBoard db={db} party={party} character={null}/>
   <PartyChat db={db} party={party} character={null}/>
   <div style={{display:'grid',gap:8}}>
    <h3>Message Party</h3>
    <label>Private GM announcement<textarea rows={3} maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/></label>
    <button type="button" disabled={busy||!body.trim()} onClick={()=>void act('message')}>Send to Party</button>
   </div>
  </>}
  <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh Party Data</button>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
