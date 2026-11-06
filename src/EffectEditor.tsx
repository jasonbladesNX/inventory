import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './effect-editor.css';

type Definition={id:string;name:string;category:string;code?:string|null;source_info?:Record<string,unknown>|null};
type EffectRow={effect_id:string;item_definition_id:string;item_name:string;attribute_code:string;operation:string;effect_value:number|string|null;stacking_group:string|null;requires_equipped_category:string|null;visibility:string};
type Props={db:SupabaseClient;campaign:string;definitions:Definition[];attributes:string[];operations:string[];allowEquippedCategory:boolean;onChanged:()=>Promise<void>};
const categories=['weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','gear','container'];
export default function EffectEditor({db,campaign,definitions,attributes,operations,allowEquippedCategory,onChanged}:Props){
  const available=definitions.filter(d=>!d.source_info?.import_batch&&!/^srd/i.test(d.code??''));
  const [selected,setSelected]=useState('');
  const [effects,setEffects]=useState<EffectRow[]>([]);
  const [editing,setEditing]=useState<string|null>(null);
  const [attribute,setAttribute]=useState('');
  const [operation,setOperation]=useState('add');
  const [amount,setAmount]=useState('1');
  const [stackingGroup,setStackingGroup]=useState('');
  const [requiresCategory,setRequiresCategory]=useState('');
  const [visibility,setVisibility]=useState('identified');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pending,setPending]=useState(false);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{setSelected('');setEffects([]);setEditing(null);setError('');setNotice('')},[campaign]);
  useEffect(()=>{if(selected&&available.some(item=>item.id===selected))return;setSelected('');setEditing(null)},[selected,definitions]);
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);
      const {data,error}=await db.rpc('list_campaign_item_effects',{p_campaign:campaign});
      if(!cancelled){if(error)setError(inventoryErrorMessage(error));else setEffects((data||[]) as EffectRow[]);setLoading(false)}
    }
    void load();return()=>{cancelled=true};
  },[db,campaign]);

  const reset=()=>{setEditing(null);setAttribute('');setOperation('add');setAmount('1');setStackingGroup('');setRequiresCategory('');setVisibility('identified');};
  const beginEdit=(effect:EffectRow)=>{
    setSelected(effect.item_definition_id);setEditing(effect.effect_id);setAttribute(effect.attribute_code);
    setOperation(effect.operation);setAmount(String(effect.effect_value??0));setStackingGroup(effect.stacking_group??'');
    setRequiresCategory(effect.requires_equipped_category??'');setVisibility(effect.visibility);setNotice('');setError('');
  };
  async function reload(){
    const {data,error}=await db.rpc('list_campaign_item_effects',{p_campaign:campaign});
    if(error)throw error;
    setEffects((data||[]) as EffectRow[]);
    await onChanged();
  }
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');setNotice('');
    const numeric=Number(amount);
    if(!selected||!attributes.includes(attribute)||!operations.includes(operation)||!amount.trim()||!Number.isFinite(numeric)){
      setError('Select an item, a permitted attribute and operation, and a valid number.');return;
    }
    setPending(true);
    try{
      const {error}=await db.rpc('save_campaign_item_effect',{
        p_campaign:campaign,p_definition:selected,p_effect:editing,p_attribute:attribute,
        p_operation:operation,p_value:numeric,p_group:stackingGroup||null,
        p_requires_category:requiresCategory||null,p_visibility:visibility
      });
      if(error)throw error;
      await reload();reset();setNotice('Equipment effect saved.');
    }catch(e){setError(inventoryErrorMessage(e))}
    finally{setPending(false)}
  };
  const remove=async(effect:EffectRow)=>{
    if(!window.confirm(`Delete the ${effect.attribute_code} ${effect.operation} effect from ${effect.item_name}?`))return;
    setPending(true);setError('');setNotice('');
    try{
      const {error}=await db.rpc('delete_campaign_item_effect',{p_campaign:campaign,p_effect:effect.effect_id});
      if(error)throw error;
      await reload();reset();setNotice('Equipment effect deleted.');
    }catch(e){setError(inventoryErrorMessage(e))}
    finally{setPending(false)}
  };
  const visible=effects.filter(effect=>effect.item_definition_id===selected);
  return <section className="nx-effect-panel" aria-labelledby="nx-effects-heading">
    <h3 id="nx-effects-heading">Equipment Effects (GM)</h3>
    <p className="nx-effect-helper">Configure effects on campaign-created catalog items. Shared SRD imports are protected. Changes affect equipped copies of an item.</p>
    {available.length===0?<p>No editable campaign-created items yet. Create one in GM item catalog above.</p>:<>
      <label htmlFor="nx-effect-definition">Catalog item</label>
      <select id="nx-effect-definition" value={selected} disabled={pending} onChange={e=>{setSelected(e.target.value);reset();setError('');setNotice('')}}>
        <option value="">Choose an item…</option>
        {[...available].sort((a,b)=>a.name.localeCompare(b.name)).map(def=><option key={def.id} value={def.id}>{def.name}</option>)}
      </select>
      {selected&&<>
        <div className="nx-effect-current">
          <strong>Existing effects {loading?'(loading…)':`(${visible.length})`}</strong>
          {visible.length===0?<p>No effects configured for this item.</p>:visible.map(effect=><div key={effect.effect_id} className="nx-effect-existing">
            <div><strong>{effect.attribute_code} · {effect.operation} {String(effect.effect_value)}</strong>
              <small>{effect.stacking_group?`Group: ${effect.stacking_group} · `:''}{effect.requires_equipped_category?`Requires ${effect.requires_equipped_category} · `:''}{effect.visibility}</small>
            </div>
            <button type="button" disabled={pending} onClick={()=>beginEdit(effect)}>Edit</button>
            <button type="button" disabled={pending} className="nx-effect-danger" onClick={()=>{void remove(effect)}}>Delete</button>
          </div>)}
        </div>
        <form className="nx-effect-form" onSubmit={e=>{void save(e)}}>
          <h4>{editing?'Edit effect':'New effect'}</h4>
          <div className="nx-effect-grid">
            <label>Attribute
              <select value={attribute} required onChange={e=>setAttribute(e.target.value)}>
                <option value="">Choose…</option>
                {attributes.map(code=><option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label>Operation
              <select value={operation} required onChange={e=>setOperation(e.target.value)}>
                {operations.map(op=><option key={op} value={op}>{op}</option>)}
              </select>
            </label>
            <label>Value
              <input type="number" step="any" required min={operation==='multiply'?0:-1000} max={operation==='multiply'?100:1000} value={amount} onChange={e=>setAmount(e.target.value)}/>
            </label>
            <label>Stacking group (optional)
              <input maxLength={60} pattern="[A-Za-z0-9_-]*" value={stackingGroup} placeholder="e.g. enhancement" onChange={e=>setStackingGroup(e.target.value)}/>
            </label>
            <label>Visibility
              <select value={visibility} onChange={e=>setVisibility(e.target.value)}>
                <option value="identified">Identified only</option>
                <option value="public">Public</option>
              </select>
            </label>
            {allowEquippedCategory&&<label>Requires equipped category
              <select value={requiresCategory} onChange={e=>setRequiresCategory(e.target.value)}>
                <option value="">None</option>
                {categories.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </label>}
          </div>
          <div className="nx-effect-controls">
            <button type="submit" disabled={pending}>{pending?'Saving…':editing?'Update effect':'Add effect'}</button>
            {editing&&<button type="button" className="secondary" disabled={pending} onClick={reset}>Cancel edit</button>}
          </div>
        </form>
      </>}
    </>}
    {error&&<p className="nx-effect-error" role="alert">{error}</p>}
    {notice&&<p className="nx-effect-success" role="status">{notice}</p>}
  </section>;
}
