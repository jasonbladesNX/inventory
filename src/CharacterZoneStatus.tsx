import React,{useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './campaign-zones.css';
type Zone={id:string;name:string;active:boolean;turn:number};
export default function CharacterZoneStatus({db,character,onZoneChanged}:{db:SupabaseClient;character:string;onZoneChanged?:()=>Promise<void>}){
 const [zone,setZone]=useState<Zone|null>(null);
 const [error,setError]=useState('');
 const previous=useRef<{character:string;zone:string;turn:number}|null>(null);
 useEffect(()=>{let live=true;
  async function load(){
   const {data,error:e}=await db.rpc('get_character_zone_state',{p_character:character});
   if(live){if(e)setError(inventoryErrorMessage(e));else{const next=data as Zone;const old=previous.current;previous.current={character,zone:next.id,turn:next.turn};setZone(next);setError('');if(old&&old.character===character&&(old.zone!==next.id||old.turn!==next.turn))void onZoneChanged?.().catch(()=>{})}}
  }
  void load();const timer=window.setInterval(()=>void load(),15000);
  return()=>{live=false;window.clearInterval(timer)};
 },[db,character,onZoneChanged]);
 return <div className="nx-character-zone-status" aria-live="polite">
 {zone?<span>Current Zone: <strong>{zone.name}</strong> · Zone Turn: <strong>{zone.turn}</strong>{!zone.active?' (inactive)':''}</span>:error?<span role="alert">Unable to load zone: {error}</span>:<span>Loading campaign zone…</span>}
 </div>;
}
