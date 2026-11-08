import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {HeartPulse,ShieldPlus,Timer,Activity} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './combat-status.css';

type StatusEntry={code:string;unit:string;remaining:number|null;source?:string;kind?:string;value?:number|null};
type DeathSaves={successes:number;failures:number;stable:boolean;dead:boolean};
export type CombatState={temporary_hp:number;conditions:StatusEntry[];effects:StatusEntry[];death_saves:DeathSaves};
type Props={db:SupabaseClient;character:string;inventoryVersion:number;busy:boolean;hpCurrent:number|null;onChanged:()=>Promise<void>;onCombatLoaded?:(state:CombatState)=>void};
const initial:CombatState={temporary_hp:0,conditions:[],effects:[],death_saves:{successes:0,failures:0,stable:false,dead:false}};
const commonConditions=['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious'];
const units=['round','turn','minute','hour','rest','permanent'];
function durationText(entry:StatusEntry){return entry.remaining===null?'Until removed':`${entry.remaining} ${entry.unit}${entry.remaining===1?'':'s'} left`;}
export default function CombatStatusPanel({db,character,inventoryVersion,busy,hpCurrent,onChanged,onCombatLoaded}:Props){
  const [state,setState]=useState<CombatState>(initial);
  const [loading,setLoading]=useState(true);
  const [acting,setActing]=useState(false);
  const [error,setError]=useState('');
  const [temp,setTemp]=useState('0');
  const [condition,setCondition]=useState('poisoned');
  const [conditionDuration,setConditionDuration]=useState('1');
  const [conditionUnit,setConditionUnit]=useState('round');
  const [effectCode,setEffectCode]=useState('str');
  const [effectValue,setEffectValue]=useState('2');
  const [effectDuration,setEffectDuration]=useState('1');
  const [effectUnit,setEffectUnit]=useState('minute');
  const [advanceUnit,setAdvanceUnit]=useState('round');
  const [advanceAmount,setAdvanceAmount]=useState('1');
  const [deathRoll,setDeathRoll]=useState('10');
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');setState(initial);
    void db.rpc('get_character_combat_state',{p_character:character}).then(({data,error:rpcError})=>{
      if(rpcError)throw rpcError;
      if(!cancelled){const value=data as CombatState;setState(value);setTemp(String(value.temporary_hp));onCombatLoaded?.(value)}
    }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[db,character,inventoryVersion]);
  const act=async(action:string,payload:Record<string,string|number>)=>{
    if(acting||loading||busy)return;
    setActing(true);setError('');
    try{
      const {data,error:rpcError}=await db.rpc('update_character_combat_state',{
        p_character:character,p_action:action,p_payload:payload
      });
      if(rpcError)throw rpcError;
      const result=data as CombatState;
      setState(result);setTemp(String(result.temporary_hp));onCombatLoaded?.(result);
      await onChanged();
    }catch(e){setError(inventoryErrorMessage(e))}
    finally{setActing(false)}
  };
  const disabled=loading||acting||busy;
  const integer=(value:string,min:number,max:number)=>/^\d+$/.test(value)&&Number(value)>=min&&Number(value)<=max;
  return <section className="mv-panel mv-combat-panel" aria-labelledby="mv-combat-title">
    <h3 id="mv-combat-title"><Activity size={20}/> Combat Status</h3>
    <div className="mv-combat-section">
      <h4><ShieldPlus size={17}/> Temporary Hit Points</h4>
      <div className="mv-combat-inline">
        <strong>{state.temporary_hp} Temp HP</strong>
        <label>New amount <input type="number" min="0" max="100000" step="1" value={temp} disabled={disabled} onChange={event=>setTemp(event.target.value)}/></label>
        <button type="button" disabled={disabled||!integer(temp,0,100000)} onClick={()=>void act('temp_hp',{amount:Number(temp)})}>Grant / Clear</button>
      </div>
      <p>New temporary HP replaces the current value only if higher. Enter 0 to clear; damage absorbs temporary HP first.</p>
    </div>
    <div className="mv-combat-section">
      <h4>Conditions</h4>
      <div className="mv-combat-status-list">
        {state.conditions.length===0?<span className="mv-combat-muted">No active conditions</span>:state.conditions.map(entry=><div className="mv-combat-status-row" key={entry.code}>
          <span><strong>{entry.code}</strong><small>{durationText(entry)}</small></span>
          <button type="button" disabled={disabled} onClick={()=>void act('condition_remove',{code:entry.code})}>Remove</button>
        </div>)}
      </div>
      <div className="mv-combat-controls">
        <label>Condition <select value={condition} disabled={disabled} onChange={e=>setCondition(e.target.value)}>{commonConditions.map(code=><option key={code} value={code}>{code}</option>)}</select></label>
        <label>Duration <input type="number" min="1" max="100000" value={conditionDuration} disabled={disabled||conditionUnit==='permanent'} onChange={e=>setConditionDuration(e.target.value)}/></label>
        <label>Unit <select value={conditionUnit} disabled={disabled} onChange={e=>setConditionUnit(e.target.value)}>{units.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
        <button type="button" disabled={disabled||(conditionUnit!=='permanent'&&!integer(conditionDuration,1,100000))}
          onClick={()=>void act('condition_add',{code:condition,duration:Number(conditionDuration),unit:conditionUnit})}>Apply</button>
      </div>
    </div>
    <div className="mv-combat-section">
      <h4>Timed Effects</h4>
      <div className="mv-combat-status-list">
        {state.effects.length===0?<span className="mv-combat-muted">No active timed effects</span>:state.effects.map(entry=><div key={entry.code} className="mv-combat-status-row">
          <span><strong>{entry.code.toUpperCase()}{entry.kind==='bonus'?` ${Number(entry.value)>=0?'+':''}${entry.value}`:''}</strong><small>{durationText(entry)} · {entry.source??'Manual'}</small></span>
          <button type="button" disabled={disabled} onClick={()=>void act('effect_remove',{code:entry.code})}>Remove</button>
        </div>)}
      </div>
      <div className="mv-combat-controls">
        <label>Ability <select value={effectCode} disabled={disabled} onChange={e=>setEffectCode(e.target.value)}>{['str','dex','con','int','wis','cha'].map(code=><option key={code} value={code}>{code.toUpperCase()}</option>)}</select></label>
        <label>Bonus <input type="number" min="-30" max="30" value={effectValue} disabled={disabled} onChange={e=>setEffectValue(e.target.value)}/></label>
        <label>Duration <input type="number" min="1" max="100000" value={effectDuration} disabled={disabled||effectUnit==='permanent'} onChange={e=>setEffectDuration(e.target.value)}/></label>
        <label>Unit <select value={effectUnit} disabled={disabled} onChange={e=>setEffectUnit(e.target.value)}>{units.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
        <button type="button" disabled={disabled||!Number.isInteger(Number(effectValue))||Number(effectValue)<-30||Number(effectValue)>30||(effectUnit!=='permanent'&&!integer(effectDuration,1,100000))}
          onClick={()=>void act('effect_add',{code:effectCode,value:Number(effectValue),kind:'bonus',duration:Number(effectDuration),unit:effectUnit})}>Add Effect</button>
      </div>
      <p>Timed ability bonuses are tracked separately from equipped-item bonuses; they are not yet included in derived attribute calculations.</p>
      <div className="mv-combat-controls">
        <label>Advance <input type="number" min="1" max="100000" value={advanceAmount} disabled={disabled} onChange={e=>setAdvanceAmount(e.target.value)}/></label>
        <label>Unit <select value={advanceUnit} disabled={disabled} onChange={e=>setAdvanceUnit(e.target.value)}>{units.filter(u=>u!=='permanent').map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
        <button type="button" disabled={disabled||!integer(advanceAmount,1,100000)}
          onClick={()=>void act('advance',{unit:advanceUnit,amount:Number(advanceAmount)})}><Timer size={15}/> Advance Time</button>
      </div>
    </div>
    <div className="mv-combat-section">
      <h4><HeartPulse size={17}/> Death Saving Throws</h4>
      <div className="mv-death-save-summary">
        <span>Successes: {state.death_saves.successes} / 3</span>
        <span>Failures: {state.death_saves.failures} / 3</span>
        {state.death_saves.stable&&<strong>Stable</strong>}
        {state.death_saves.dead&&<strong>Dead</strong>}
      </div>
      <div className="mv-combat-inline">
        <label>d20 result <input type="number" min="1" max="20" value={deathRoll} disabled={disabled||hpCurrent!==0} onChange={e=>setDeathRoll(e.target.value)}/></label>
        <button type="button" disabled={disabled||hpCurrent!==0||state.death_saves.dead||state.death_saves.stable||!integer(deathRoll,1,20)}
          onClick={()=>void act('death_roll',{roll:Number(deathRoll)})}>Record Save</button>
        <button type="button" disabled={disabled} onClick={()=>void act('death_reset',{})}>Reset Saves</button>
      </div>
      <p>At 0 HP: 10+ succeeds, 1 counts as two failures, and 20 restores 1 HP. Three successes stabilize; three failures mark death. Healing above 0 resets saves.</p>
    </div>
    {error&&<p className="mv-storage-error" role="alert">{error}</p>}
  </section>;
}
