import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Activity,HeartPulse,ShieldPlus,Timer,X} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './combat-status.css';

type StatusEntry={code:string;unit:string;remaining:number|null;source?:string;kind?:string;value?:number|null};
type DeathSaves={successes:number;failures:number;stable:boolean;dead:boolean};
type TempDuration={unit:string;remaining:number}|null;
export type CombatState={temporary_hp:number;temporary_hp_duration?:TempDuration;conditions:StatusEntry[];effects:StatusEntry[];death_saves:DeathSaves};
type Props={db:SupabaseClient;character:string;inventoryVersion:number;busy:boolean;hpCurrent:number|null;
 onChanged:()=>Promise<void>;onCombatLoaded?:(state:CombatState)=>void;tempOpen:boolean;onCloseTemp:()=>void};
const initial:CombatState={temporary_hp:0,temporary_hp_duration:null,conditions:[],effects:[],death_saves:{successes:0,failures:0,stable:false,dead:false}};
const conditions=['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious'];
const units=['round','turn','minute','hour','rest','permanent'];
const durationText=(entry:StatusEntry)=>entry.remaining===null?'Until removed':String(entry.remaining)+' '+entry.unit+(entry.remaining===1?'':'s')+' left';
const validInt=(value:string,min:number,max:number)=>/^\d+$/.test(value)&&Number(value)>=min&&Number(value)<=max;
export default function CombatStatusPanel({db,character,inventoryVersion,busy,hpCurrent,onChanged,onCombatLoaded,tempOpen,onCloseTemp}:Props){
  const [state,setState]=useState<CombatState>(initial);
  const [loading,setLoading]=useState(true);
  const [acting,setActing]=useState(false);
  const [healing,setHealing]=useState(false);
  const [error,setError]=useState('');
  const [dialog,setDialog]=useState<'add'|'advance'|'death'|null>(null);
  const [kind,setKind]=useState<'condition'|'ability'>('condition');
  const [temp,setTemp]=useState('0');
  const [tempUnit,setTempUnit]=useState('permanent');
  const [tempDuration,setTempDuration]=useState('1');
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
  const [healAmount,setHealAmount]=useState('1');
  const [deathDismissed,setDeathDismissed]=useState(false);
  const closeRef=useRef<HTMLButtonElement>(null);
  const wasZero=useRef(false);
  const close=()=>{if(acting||healing)return;setDialog(null);onCloseTemp()};
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');setState(initial);
    void Promise.resolve(db.rpc('get_character_combat_state',{p_character:character})).then(({data,error:rpcError})=>{
      if(rpcError)throw rpcError;
      if(!cancelled){const value=data as CombatState;setState(value);setTemp(String(value.temporary_hp));setTempUnit(value.temporary_hp_duration?.unit??'permanent');setTempDuration(String(value.temporary_hp_duration?.remaining??1));onCombatLoaded?.(value)}
    }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[db,character,inventoryVersion]);
  useEffect(()=>{wasZero.current=false;setDeathDismissed(false);setDialog(null);onCloseTemp()},[character]);
  useEffect(()=>{
    if(hpCurrent===0&& !wasZero.current){setDeathDismissed(false);setDialog('death')}
    if(hpCurrent!==0){setDeathDismissed(false);if(dialog==='death')setDialog(null)}
    wasZero.current=hpCurrent===0;
  },[hpCurrent]);
  useEffect(()=>{if(hpCurrent===0&&!deathDismissed&&!dialog&&!tempOpen)setDialog('death')},[hpCurrent,deathDismissed,dialog,tempOpen]);
  useEffect(()=>{
    if(!(dialog||tempOpen))return;
    closeRef.current?.focus();
    const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!acting&&!healing){if(dialog==='death')setDeathDismissed(true);close()}};
    document.addEventListener('keydown',esc);return()=>document.removeEventListener('keydown',esc);
  },[dialog,tempOpen,acting,healing]);
  const act=async(action:string,payload:Record<string,string|number>)=>{
    if(acting||loading||busy)return false;
    setActing(true);setError('');
    try{
      const {data,error:rpcError}=await db.rpc('update_character_combat_state',{p_character:character,p_action:action,p_payload:payload});
      if(rpcError)throw rpcError;
      const result=data as CombatState;
      setState(result);setTemp(String(result.temporary_hp));onCombatLoaded?.(result);
      await onChanged();
      return true;
    }catch(e){setError(inventoryErrorMessage(e));return false}
    finally{setActing(false)}
  };
  const heal=async()=>{
    if(!validInt(healAmount,1,100000)||busy||healing)return;
    setHealing(true);setError('');
    try{
      const {error:rpcError}=await db.rpc('adjust_character_hit_points',{p_character:character,p_operation:'heal',p_amount:Number(healAmount)});
      if(rpcError)throw rpcError;
      await onChanged();setDialog(null);setDeathDismissed(true);
    }catch(e){setError(inventoryErrorMessage(e))}
    finally{setHealing(false)}
  };
  const disabled=loading||acting||healing||busy;
  const submitNew=async()=>{
    const payload=kind==='condition'?{code:condition,duration:Number(conditionDuration),unit:conditionUnit}:
      {code:effectCode,value:Number(effectValue),kind:'bonus',duration:Number(effectDuration),unit:effectUnit};
    if(await act(kind==='condition'?'condition_add':'effect_add',payload))setDialog(null);
  };
  const modal=dialog||tempOpen;
  return <>
    <div className="mv-combat-toolbar" aria-label="Character combat actions">
      <button type="button" disabled={disabled} onClick={()=>{setError('');setDialog('advance')}}><Timer size={16}/> Advance Time</button>
      <button type="button" disabled={disabled} onClick={()=>{setError('');setDialog('add')}}><Activity size={16}/> Add Condition / Effect</button>
      {hpCurrent===0&&<button type="button" className="mv-death-open" disabled={disabled} onClick={()=>{setError('');setDeathDismissed(false);setDialog('death')}}><HeartPulse size={16}/> Death Saves</button>}
    </div>
    {(state.conditions.length>0||state.effects.some(entry=>entry.kind!=='bonus'))&&<section className="mv-combat-active" aria-label="Active conditions and status effects">
      <strong>Active Conditions & Effects</strong>
      <div className="mv-combat-status-list">
        {[...state.conditions.map(entry=>({...entry,group:'condition' as const})),...state.effects.filter(entry=>entry.kind!=='bonus').map(entry=>({...entry,group:'effect' as const}))].map(entry=><div className="mv-combat-status-row" key={entry.group+':'+entry.code}>
          <span><strong>{entry.code.toUpperCase()}</strong><small>{durationText(entry)} · {entry.source??'Manual'}</small></span>
          <button type="button" disabled={disabled} onClick={()=>void act(entry.group==='condition'?'condition_remove':'effect_remove',{code:entry.code})}>Remove</button>
        </div>)}
      </div>
    </section>}
    {state.temporary_hp>0&&<p className="mv-combat-temp-indicator"><ShieldPlus size={15}/> {state.temporary_hp} temporary HP{state.temporary_hp_duration?' · '+String(state.temporary_hp_duration.remaining)+' '+state.temporary_hp_duration.unit+(state.temporary_hp_duration.remaining===1?'':'s')+' left':''}</p>}
    {error&&!modal&&<p className="mv-storage-error" role="alert">{error}</p>}
    {modal&&createPortal(<div className="mv-modal-backdrop" onMouseDown={event=>{if(event.currentTarget===event.target){if(dialog==='death')setDeathDismissed(true);close()}}}>
      <section className="mv-item-modal mv-combat-dialog" role="dialog" aria-modal="true" aria-labelledby="mv-combat-dialog-title">
        <div className="mv-modal-header">
          <div className="mv-modal-heading"><Activity size={22}/><h3 id="mv-combat-dialog-title">{tempOpen?'Temporary Hit Points':dialog==='add'?'Add Condition / Effect':dialog==='advance'?'Advance Character Time':'Death Saving Throws'}</h3></div>
          <button type="button" ref={closeRef} className="mv-modal-close" disabled={acting||healing} aria-label="Close combat dialog" onClick={()=>{if(dialog==='death')setDeathDismissed(true);close()}}><X size={22}/></button>
        </div>
        <div className="mv-modal-body mv-combat-dialog-body">
          {tempOpen&&<>
            <p>Grant temporary HP or clear it. New grants do not stack; the higher amount is retained.</p>
            <label>Temporary HP <input type="number" min="1" max="100000" step="1" value={temp} onChange={e=>setTemp(e.target.value)}/></label>
            <label>Duration <select value={tempUnit} onChange={e=>setTempUnit(e.target.value)}>{units.map(unit=><option key={unit} value={unit}>{unit==='permanent'?'No timer':unit}</option>)}</select></label>
            {tempUnit!=='permanent'&&<label>Number of {tempUnit}s <input type="number" min="1" max="100000" value={tempDuration} onChange={e=>setTempDuration(e.target.value)}/></label>}
            <button type="button" disabled={disabled||!validInt(temp,1,100000)||(tempUnit!=='permanent'&&!validInt(tempDuration,1,100000))}
              onClick={()=>{void (async()=>{if(await act('temp_hp',{amount:Number(temp),unit:tempUnit,duration:Number(tempDuration)}))onCloseTemp()})()}}>Grant Temporary HP</button>
          </>}
          {dialog==='add'&&!tempOpen&&<>
            <label>Type <select value={kind} onChange={e=>setKind(e.target.value as 'condition'|'ability')}>
              <option value="condition">Condition</option><option value="ability">Timed Ability Bonus</option></select></label>
            {kind==='condition'?<>
              <label>Condition <select value={condition} onChange={e=>setCondition(e.target.value)}>{conditions.map(code=><option key={code} value={code}>{code}</option>)}</select></label>
              <label>Duration <input type="number" min="1" max="100000" value={conditionDuration} onChange={e=>setConditionDuration(e.target.value)} disabled={conditionUnit==='permanent'}/></label>
              <label>Unit <select value={conditionUnit} onChange={e=>setConditionUnit(e.target.value)}>{units.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
            </>:<>
              <label>Ability <select value={effectCode} onChange={e=>setEffectCode(e.target.value)}>{['str','dex','con','int','wis','cha'].map(code=><option key={code} value={code}>{code.toUpperCase()}</option>)}</select></label>
              <label>Bonus <input type="number" min="-30" max="30" step="1" value={effectValue} onChange={e=>setEffectValue(e.target.value)}/></label>
              <label>Duration <input type="number" min="1" max="100000" value={effectDuration} onChange={e=>setEffectDuration(e.target.value)} disabled={effectUnit==='permanent'}/></label>
              <label>Unit <select value={effectUnit} onChange={e=>setEffectUnit(e.target.value)}>{units.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
            </>}
            <button type="button" disabled={disabled||(kind==='condition'?(conditionUnit!=='permanent'&&!validInt(conditionDuration,1,100000)):(!Number.isInteger(Number(effectValue))||Number(effectValue)<-30||Number(effectValue)>30||(effectUnit!=='permanent'&&!validInt(effectDuration,1,100000))))}
              onClick={()=>void submitNew()}>Apply {kind==='condition'?'Condition':'Effect'}</button>
          </>}
          {dialog==='advance'&&!tempOpen&&<>
            <p>Advance time for this character. Campaign-wide GM time advancement will be added later.</p>
            <label>Amount <input type="number" min="1" max="100000" step="1" value={advanceAmount} onChange={e=>setAdvanceAmount(e.target.value)}/></label>
            <label>Unit <select value={advanceUnit} onChange={e=>setAdvanceUnit(e.target.value)}>{units.filter(u=>u!=='permanent').map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
            <button type="button" disabled={disabled||!validInt(advanceAmount,1,100000)} onClick={()=>{void (async()=>{if(await act('advance',{amount:Number(advanceAmount),unit:advanceUnit}))setDialog(null)})()}}>Advance Time</button>
          </>}
          {dialog==='death'&&!tempOpen&&<>
            <p>At 0 HP, roll death saving throws or restore HP. Three successes stabilize; three failures mark death. Natural 20 restores 1 HP.</p>
            <div className="mv-death-save-summary"><span>Successes: {state.death_saves.successes} / 3</span><span>Failures: {state.death_saves.failures} / 3</span>
              {state.death_saves.stable&&<strong>Stable</strong>}{state.death_saves.dead&&<strong>Dead</strong>}</div>
            <label>d20 result <input type="number" min="1" max="20" step="1" value={deathRoll} onChange={e=>setDeathRoll(e.target.value)}/></label>
            <button type="button" disabled={disabled||hpCurrent!==0||state.death_saves.dead||state.death_saves.stable||!validInt(deathRoll,1,20)}
              onClick={()=>void act('death_roll',{roll:Number(deathRoll)})}>Record Death Save</button>
            <button type="button" disabled={disabled} onClick={()=>void act('death_reset',{})}>Reset Saves</button>
            <div className="mv-combat-heal">
              <label>Heal HP <input type="number" min="1" max="100000" step="1" value={healAmount} onChange={e=>setHealAmount(e.target.value)}/></label>
              <button type="button" disabled={disabled||!validInt(healAmount,1,100000)} onClick={()=>void heal()}>Heal HP</button>
            </div>
          </>}
          {error&&<p className="mv-storage-error" role="alert">{error}</p>}
        </div>
      </section>
    </div>,document.body)}
  </>;
}
