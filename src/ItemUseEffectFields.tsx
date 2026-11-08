import React from 'react';

export type UseEffectDraft={
  type:string;dice_count:string;dice_sides:string;bonus:string;
  amount:string;code:string;value:string;unit:string;duration:string;
};
export const emptyUseEffect:UseEffectDraft={
  type:'none',dice_count:'2',dice_sides:'4',bonus:'2',
  amount:'5',code:'poisoned',value:'2',unit:'round',duration:'3'
};
export function draftFromEffect(effect:Record<string,unknown>|null|undefined):UseEffectDraft{
  if(!effect||!effect.type)return {...emptyUseEffect};
  return {
    ...emptyUseEffect,
    type:String(effect.type),
    dice_count:String(effect.dice_count??2),
    dice_sides:String(effect.dice_sides??4),
    bonus:String(effect.bonus??0),
    amount:String(effect.amount??5),
    code:String(effect.code??'poisoned'),
    value:String(effect.value??2),
    unit:String(effect.unit??'round'),
    duration:String(effect.duration??3)
  };
}
function intIn(value:string,min:number,max:number,label:string):number{
  if(!/^-?\d+$/.test(value)||Number(value)<min||Number(value)>max)throw Error(`${label} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
export function buildUseEffect(draft:UseEffectDraft):Record<string,unknown>|null{
  switch(draft.type){
    case 'none':return null;
    case 'heal_hp':return {type:'heal_hp',
      dice_count:intIn(draft.dice_count,1,10,'Healing dice'),
      dice_sides:intIn(draft.dice_sides,2,100,'Die sides'),
      bonus:intIn(draft.bonus,0,100,'Healing bonus')};
    case 'temp_hp':return {type:'temp_hp',amount:intIn(draft.amount,1,100000,'Temporary HP')};
    case 'remove_condition':
    case 'add_condition':
    case 'ability_bonus':{
      const code=(draft.type==='ability_bonus'?draft.code.toLowerCase():draft.code.trim().toLowerCase());
      if(!/^[a-z][a-z0-9_ -]{0,59}$/.test(code))throw Error('Enter a valid condition or ability name.');
      if(draft.type==='ability_bonus'&&!['str','dex','con','int','wis','cha'].includes(code))throw Error('Choose a supported ability score.');
      if(draft.type==='remove_condition')return {type:draft.type,code};
      const unit=draft.unit;
      if(!['round','turn','minute','hour','rest','permanent'].includes(unit))throw Error('Choose a duration unit.');
      const duration=unit==='permanent'?null:intIn(draft.duration,1,100000,'Duration');
      return {
        type:draft.type,code,unit,duration,
        ...(draft.type==='ability_bonus'?{value:intIn(draft.value,-30,30,'Ability bonus')}:{})
      };
    }
    default:throw Error('Choose a supported use effect.');
  }
}
type Props={value:UseEffectDraft;onChange:(next:UseEffectDraft)=>void;disabled?:boolean;prefix:string};
const effectTypes=[
  ['none','No automatic effect (consume only)'],
  ['heal_hp','Restore hit points'],
  ['temp_hp','Grant temporary hit points'],
  ['remove_condition','Remove a condition'],
  ['add_condition','Apply a condition'],
  ['ability_bonus','Temporary ability-score bonus']
];
const conditionOptions=['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious'];
export default function ItemUseEffectFields({value,onChange,disabled,prefix}:Props){
  const update=(key:keyof UseEffectDraft,val:string)=>onChange({...value,[key]:val});
  const timed=value.type==='ability_bonus'||value.type==='add_condition';
  return <fieldset className="nx-use-effect-fields" disabled={disabled}>
    <legend>Automatic Use Effect</legend>
    <label>When used
      <select value={value.type} onChange={e=>onChange({...value,type:e.target.value,code:e.target.value==='ability_bonus'?'str':(['add_condition','remove_condition'].includes(e.target.value)?'poisoned':value.code)})}>
        {effectTypes.map(([code,label])=><option key={code} value={code}>{label}</option>)}
      </select>
    </label>
    {value.type==='heal_hp'&&<div className="nx-effect-field-grid">
      <label>Number of dice<input aria-label={`${prefix} healing dice count`} type="number" min="1" max="10" step="1" value={value.dice_count} onChange={e=>update('dice_count',e.target.value)}/></label>
      <label>Die sides<input aria-label={`${prefix} healing die sides`} type="number" min="2" max="100" step="1" value={value.dice_sides} onChange={e=>update('dice_sides',e.target.value)}/></label>
      <label>Flat healing bonus<input aria-label={`${prefix} healing bonus`} type="number" min="0" max="100" step="1" value={value.bonus} onChange={e=>update('bonus',e.target.value)}/></label>
      <small>Example: 2 dice, 4 sides, +2 = 2d4+2 HP.</small>
    </div>}
    {value.type==='temp_hp'&&<label>Temporary HP granted
      <input type="number" min="1" max="100000" step="1" value={value.amount} onChange={e=>update('amount',e.target.value)}/>
    </label>}
    {['remove_condition','add_condition'].includes(value.type)&&<label>Condition
      <input list={`${prefix}-condition-options`} maxLength={60} value={value.code} onChange={e=>update('code',e.target.value)}/>
      <datalist id={`${prefix}-condition-options`}>{conditionOptions.map(code=><option key={code} value={code}/>)}</datalist>
    </label>}
    {value.type==='ability_bonus'&&<>
      <label>Ability score<select value={['str','dex','con','int','wis','cha'].includes(value.code)?value.code:'str'} onChange={e=>update('code',e.target.value)}>
        {['str','dex','con','int','wis','cha'].map(code=><option key={code} value={code}>{code.toUpperCase()}</option>)}
      </select></label>
      <label>Score adjustment<input type="number" min="-30" max="30" step="1" value={value.value} onChange={e=>update('value',e.target.value)}/></label>
    </>}
    {timed&&<div className="nx-effect-field-grid">
      <label>Duration unit<select value={value.unit} onChange={e=>update('unit',e.target.value)}>
        {['round','turn','minute','hour','rest','permanent'].map(unit=><option key={unit} value={unit}>{unit}</option>)}
      </select></label>
      {value.unit!=='permanent'&&<label>Duration<input type="number" min="1" max="100000" step="1" value={value.duration} onChange={e=>update('duration',e.target.value)}/></label>}
    </div>}
    <small>Effects apply when a player uses the item. Assigning it to inventory does not trigger the effect.</small>
  </fieldset>;
}
