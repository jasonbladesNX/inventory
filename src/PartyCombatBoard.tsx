import React,{useCallback,useEffect,useState} from 'react';
import type{SupabaseClient}from '@supabase/supabase-js';
import {Swords,RefreshCw,Shield} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './party-combat.css';

type CombatMember={
 character_id:string;name:string;is_leader:boolean;
 hp:{current?:number;max?:number}|null;
 modifier:number|null;roll:number|null;score:number|null;
 position:number|null;is_acting:boolean;
};
type CombatZone={
 zone_id:string;zone_name:string;phase:'none'|'rolling'|'active'|'complete';
 round:number;active_position:number;
 active_party_character:{character_id:string;name:string}|null;
 party_members:CombatMember[];
};
type Board={party_id:string;party_name:string;zones:CombatZone[]};

export default function PartyCombatBoard({db,party,character=null}:{
 db:SupabaseClient;party:string;character?:string|null;
}){
 const[board,setBoard]=useState<Board|null>(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');
 const refresh=useCallback(async()=>{
  const{data,error:e}=await db.rpc('get_party_combat_board',{
   p_party:party,p_character:character
  });
  if(e)throw e;
  setBoard(data as Board);
 },[db,party,character]);
 useEffect(()=>{
  let live=true;
  setBoard(null);setLoading(true);setError('');
  void refresh().catch(e=>{if(live)setError(inventoryErrorMessage(e))})
   .finally(()=>{if(live)setLoading(false)});
  const timer=window.setInterval(()=>{if(live)void refresh().catch(e=>{if(live)setError(inventoryErrorMessage(e))})},15000);
  return()=>{live=false;window.clearInterval(timer)};
 },[refresh]);
 const zones=board?.zones??[];
 return <section className="nx-party-combat" aria-label="Party combat coordination">
  <div className="nx-party-combat-heading">
   <h4><Swords size={18}/> Party Combat Board</h4>
   <button type="button" aria-label="Refresh party combat" title="Refresh combat"
    onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>
    <RefreshCw size={16}/>
   </button>
  </div>
  <p className="nx-party-combat-note">Live read-only view of the GM's initiative tracker. Only party members are shown; the GM controls combat rounds and turn changes.</p>
  {loading?<p className="nx-party-combat-empty">Loading encounters…</p>:
   zones.length===0?<p className="nx-party-combat-empty">No active party members are assigned to a zone.</p>:
   zones.map(zone=><div className="nx-party-combat-zone" key={zone.zone_id}>
    <div className="nx-party-combat-zone-header">
     <strong>{zone.zone_name}</strong>
     <span>{zone.phase==='active'?'Encounter Active':
      zone.phase==='rolling'?'Awaiting Initiative Rolls':
      zone.phase==='complete'?'Encounter Ended':'No Encounter'}</span>
    </div>
    <div className="nx-party-combat-summary">
     <span>Round <strong>{zone.round||'—'}</strong></span>
     <span>Current position <strong>{zone.phase==='active'?zone.active_position:'—'}</strong></span>
    </div>
    {zone.phase==='active'&&<div className="nx-party-combat-turn">
     <Shield size={15}/>
     {zone.active_party_character?<>
      Party member acting: <strong>{zone.active_party_character.name}</strong>
     </>:<>Another participant is acting</>}
    </div>}
    <div className="nx-party-combat-members">
     {zone.party_members.map(member=><div key={member.character_id}
      className={'nx-party-combat-member'+(member.is_acting?' nx-party-combat-acting':'')}>
      <div className="nx-party-combat-member-name">
       <strong>{member.name}{member.is_leader?' · Leader':''}</strong>
       {member.is_acting&&<span>Acting Now</span>}
      </div>
      <div className="nx-party-combat-stats">
       <span>HP: {member.hp?.current??'—'} / {member.hp?.max??'—'}</span>
       <span>Position: {member.position??'—'}</span>
       <span>Roll: {member.roll??'—'}</span>
       <span>Score: {member.score??'—'}</span>
      </div>
     </div>)}
    </div>
   </div>)}
  {error&&<p role="alert" className="nx-party-combat-error">{error}</p>}
 </section>;
}
