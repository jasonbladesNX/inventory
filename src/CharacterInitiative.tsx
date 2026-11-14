import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './zone-initiative.css';
type Initiative={zone_id:string;zone_name:string;phase:string;round:number;active_position:number;active_character:string|null;my_modifier:number;my_roll:number|null;my_score:number|null;my_position:number|null;participant_count:number;ready_count:number};
export default function CharacterInitiative({db,campaign,character,onChanged}:{db:SupabaseClient;campaign:string;character:string;onChanged?:()=>Promise<void>}){
 const [info,setInfo]=useState<Initiative|null>(null);
 const [modifier,setModifier]=useState('0');
 const [roll,setRoll]=useState('');
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const {data,error:e}=await db.rpc('get_character_initiative',{p_character:character});
  if(e)throw e;
  setInfo(data as Initiative);
 },[db,character]);
 useEffect(()=>{setInfo(null);setError('');void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 useEffect(()=>{const timer=window.setInterval(()=>void refresh().catch(()=>{}),15000);return()=>window.clearInterval(timer)},[refresh]);
 useEffect(()=>{if(info){setModifier(String(info.my_modifier));setRoll(info.my_roll==null?'':String(info.my_roll))}},[info?.my_modifier,info?.my_roll,info?.zone_id]);
 async function act(action:'modifier'|'roll'){
  if(saving||!info)return;
  setSaving(true);setError('');setNotice('');
  try{
   const result=action==='modifier'?
    await db.rpc('set_character_initiative_modifier',{p_character:character,p_modifier:Number(modifier)}):
    await db.rpc('manage_zone_initiative',{p_campaign:campaign,p_zone:info.zone_id,p_action:'roll',p_character:character,p_roll:Number(roll)});
   if(result.error)throw result.error;
   await refresh();setNotice(action==='modifier'?'Initiative modifier saved for future requests.':'Initiative roll recorded.');
   if(action==='roll')await onChanged?.();
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setSaving(false)}
 }
 const validMod=/^-?\d+$/.test(modifier)&&Number(modifier)>=-100&&Number(modifier)<=100;
 const validRoll=/^\d+$/.test(roll)&&Number(roll)>=1&&Number(roll)<=20;
 return <section className="nx-character-zone-status" aria-label="Character initiative" aria-live="polite">
  <strong>Initiative</strong>
  {!info?<span> Loading initiative…</span>:<>
   <span> · {info.phase==='none'?'No active encounter':info.phase==='rolling'?'Roll requested':info.phase==='active'?'Round '+info.round:'Encounter finished'}</span>
   {info.phase==='active'&&<p>Position: <strong>{info.my_position??'—'} / {info.participant_count}</strong> · Score: <strong>{info.my_score??'—'}</strong> · Acting: <strong>{info.active_character??'—'}</strong>{info.my_position===info.active_position?' · Your turn!':''}</p>}
   {info.phase==='rolling'&&<p>Rolls submitted: {info.ready_count} / {info.participant_count}</p>}
   <div className="nx-init-edit">
    <label>Initiative modifier
     <input type="number" step="1" min="-100" max="100" disabled={saving} value={modifier} onChange={e=>setModifier(e.target.value)}/>
    </label>
    <button type="button" disabled={saving||!validMod||Number(modifier)===info.my_modifier} onClick={()=>void act('modifier')}>Save Modifier</button>
    {info.phase==='rolling'&&<>
     <label>d20 roll<input type="number" min="1" max="20" step="1" disabled={saving} value={roll} onChange={e=>setRoll(e.target.value)}/></label>
     <button type="button" disabled={saving||!validRoll} onClick={()=>void act('roll')}>{info.my_roll==null?'Submit Roll':'Update Roll'}</button>
    </>}
   </div>
   {info.phase==='rolling'&&<p className="nx-small-note">The current request uses the modifier captured when the GM requested initiative. Saving a new modifier updates future requests.</p>}
  </>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="mv-storage-error">{error}</p>}
 </section>;
}
