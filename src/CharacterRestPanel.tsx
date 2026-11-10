import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Moon, X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './rest-panel.css';

type RestState={hp:{current:number;max:number}|null;hit_dice:{max:number;remaining:number;sides:number};last_rest?:{type:'short'|'long';hp_recovered:number;hit_dice_spent:number;hours_advanced:number}|null};
type Props={db:SupabaseClient;character:string;inventoryVersion:number;busy:boolean;onChanged:()=>Promise<void>};
export default function CharacterRestPanel({db,character,inventoryVersion,busy,onChanged}:Props){
  const [state,setState]=useState<RestState|null>(null);
  const [loading,setLoading]=useState(true);
  const [open,setOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  const [kind,setKind]=useState<'short'|'long'>('short');
  const [spend,setSpend]=useState('1');
  const [hours,setHours]=useState('0');
  const [editDice,setEditDice]=useState(false);
  const [diceMax,setDiceMax]=useState('0');
  const [diceAvailable,setDiceAvailable]=useState('0');
  const [diceSides,setDiceSides]=useState('8');
  const trigger=useRef<HTMLButtonElement>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const valid=(n:string,min:number,max:number)=>/^\d+$/.test(n)&&Number(n)>=min&&Number(n)<=max;
  const close=()=>{if(saving)return;setOpen(false);setEditDice(false);setError('');trigger.current?.focus()};
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');
    void Promise.resolve(db.rpc('get_character_rest_state',{p_character:character})).then(({data,error:rpcError})=>{
      if(rpcError)throw rpcError;
      if(!cancelled){
        const next=data as RestState;setState(next);
        setDiceMax(String(next.hit_dice.max));setDiceAvailable(String(next.hit_dice.remaining));setDiceSides(String(next.hit_dice.sides));
      }
    }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[db,character,inventoryVersion]);
  useEffect(()=>{setOpen(false);setEditDice(false);setFeedback('');setHours('0')},[character]);
  useEffect(()=>{
    if(!open)return;
    closeButton.current?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!saving){e.preventDefault();close()}};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[open,saving]);
  const run=async(action:'rest'|'configure')=>{
    if(busy||loading||saving)return;
    setSaving(true);setError('');
    try{
      if(action==='configure'){
        const {data,error:rpcError}=await db.rpc('configure_character_hit_dice',{
          p_character:character,p_max:Number(diceMax),p_remaining:Number(diceAvailable),p_sides:Number(diceSides)
        });
        if(rpcError)throw rpcError;
        setState(data as RestState);setEditDice(false);setFeedback('Hit dice settings saved.');
      }else{
        const {data,error:rpcError}=await db.rpc('take_character_rest',{
          p_character:character,p_kind:kind,p_hit_dice:kind==='short'?Number(spend):0,
          p_advance_hours:Number(hours)
        });
        if(rpcError)throw rpcError;
        const next=data as {rest:RestState;hp_recovered:number;rolled:number;con_modifier:number};
        setState(next.rest);
        setFeedback((kind==='short'?'Short rest':'Long rest')+' complete: '+next.hp_recovered+' HP restored.');
        setOpen(false);
        await onChanged();
      }
    }catch(e){setError(inventoryErrorMessage(e))}
    finally{setSaving(false)}
  };
  return <>
    <div className="mv-rest-toolbar">
      <button ref={trigger} type="button" disabled={busy||loading} onClick={()=>{setOpen(true);setError('')}}><Moon size={16}/> Rest</button>
    </div>
    {feedback&&<p className="mv-rest-feedback" role="status">{feedback}</p>}
    {error&&!open&&<p className="mv-storage-error" role="alert">{error}</p>}
    {open&&createPortal(<div className="mv-modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}>
      <section role="dialog" aria-modal="true" aria-labelledby="mv-rest-title" className="mv-item-modal mv-rest-dialog">
        <div className="mv-modal-header">
          <div className="mv-modal-heading"><Moon size={22}/><h3 id="mv-rest-title">Character Rest</h3></div>
          <button ref={closeButton} className="mv-modal-close" type="button" disabled={saving} aria-label="Close rest dialog" onClick={close}><X size={22}/></button>
        </div>
        <div className="mv-modal-body mv-rest-body">
          <label>Rest type
            <select disabled={saving} value={kind} onChange={e=>setKind(e.target.value as 'short'|'long')}>
              <option value="short">Short Rest</option><option value="long">Long Rest</option>
            </select>
          </label>
          <p>{kind==='short'?'Spend hit dice to heal. Each die rolls its configured size and adds the effective CON modifier.':'Recover to maximum HP and regain up to half your maximum hit dice (minimum one, if configured).'}</p>
          <div className="mv-rest-summary">HP: {state?.hp?.current??'—'} / {state?.hp?.max??'—'} · Hit Dice: {state?.hit_dice.remaining??0} / {state?.hit_dice.max??0} (d{state?.hit_dice.sides??8})</div>
          {kind==='short'&&<label>Hit dice to spend
            <input type="number" min="0" max={state?.hit_dice.remaining??0} step="1" value={spend} disabled={saving} onChange={e=>setSpend(e.target.value)}/>
          </label>}
          <label>Advance elapsed hours (optional)
            <input type="number" min="0" max="24" step="1" value={hours} disabled={saving} onChange={e=>setHours(e.target.value)}/>
          </label>
          <p>Rest-based condition and effect durations advance one rest. Hour-based durations advance only if hours are entered above. Other resources and conditions do not reset automatically.</p>
          <button type="button" disabled={saving||busy||loading||!state?.hp||state.hp.current===0||!valid(hours,0,24)||(kind==='short'&&!valid(spend,0,state?.hit_dice.remaining??0))}
            onClick={()=>void run('rest')}>Take {kind==='short'?'Short':'Long'} Rest</button>
          <div className="mv-rest-settings">
            <button type="button" className="mv-rest-settings-trigger" disabled={saving} onClick={()=>setEditDice(v=>!v)}>{editDice?'Hide Hit Dice Settings':'Configure Hit Dice'}</button>
            {editDice&&<>
              <label>Maximum hit dice <input type="number" min="0" max="100" step="1" value={diceMax} onChange={e=>setDiceMax(e.target.value)}/></label>
              <label>Available hit dice <input type="number" min="0" max="100" step="1" value={diceAvailable} onChange={e=>setDiceAvailable(e.target.value)}/></label>
              <label>Hit die size <select value={diceSides} onChange={e=>setDiceSides(e.target.value)}>{[4,6,8,10,12,20].map(n=><option key={n} value={n}>d{n}</option>)}</select></label>
              <button type="button" disabled={saving||!valid(diceMax,0,100)||!valid(diceAvailable,0,Number(diceMax))} onClick={()=>void run('configure')}>Save Hit Dice</button>
            </>}
          </div>
          {error&&<p className="mv-storage-error" role="alert">{error}</p>}
        </div>
      </section>
    </div>,document.body)}
  </>;
}
