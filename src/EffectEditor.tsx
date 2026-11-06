import React, {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './effect-editor.css';

type Definition={id:string;name:string;category:string;code?:string|null;source_info?:Record<string,unknown>|null};
type EffectRow={effect_id:string;item_definition_id:string;item_name:string;attribute_code:string;operation:string;effect_value:number|string|null;stacking_group:string|null;requires_equipped_category:string|null;visibility:string};
type PreviewCharacter={id:string;name:string};
type PreviewRow={attribute_code:string;attribute_label:string;base_score:number|null;current_score:number|string|null;preview_score:number|string|null;current_modifier:number|null;preview_modifier:number|null;item_is_equipped:boolean};
type Props={db:SupabaseClient;campaign:string;definitions:Definition[];attributes:string[];operations:string[];allowEquippedCategory:boolean;characters:PreviewCharacter[];selectedCharacter:string;onChanged:()=>Promise<void>};
const categories=['weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','gear','container'];
export default function EffectEditor({db,campaign,definitions,attributes,operations,allowEquippedCategory,characters,selectedCharacter,onChanged}:Props){
  const available=(Array.isArray(definitions)?definitions:[]).filter(d=>d&&typeof d.id==='string'&&typeof d.name==='string'&&!d.source_info?.import_batch&&!/^srd/i.test(typeof d.code==='string'?d.code:''));
  const enabledAttributes=Array.isArray(attributes)?attributes.filter(code=>typeof code==='string'):[];
  const enabledOperations=Array.isArray(operations)?operations.filter(op=>typeof op==='string'):[];
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
  const [previewCharacter,setPreviewCharacter]=useState('');
  const [previewRows,setPreviewRows]=useState<PreviewRow[]>([]);
  const [previewSignature,setPreviewSignature]=useState('');
  const [previewPending,setPreviewPending]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const characterOptions=Array.isArray(characters)?characters.filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string'):[];
  const currentPreviewSignature=JSON.stringify([campaign,selected,editing,attribute,operation,amount,stackingGroup,requiresCategory,visibility,previewCharacter,effects]);
  const previewIsCurrent=previewSignature===currentPreviewSignature;

  useEffect(()=>{setSelected('');setEffects([]);setEditing(null);setError('');setNotice('');setPreviewRows([]);setPreviewSignature('');setPreviewCharacter('')},[campaign]);
  useEffect(()=>{if(!previewCharacter&&selectedCharacter)setPreviewCharacter(selectedCharacter)},[selectedCharacter,previewCharacter]);
  useEffect(()=>{if(selected&&available.some(item=>item.id===selected))return;setSelected('');setEditing(null)},[selected,definitions]);
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);
      try{
        const {data,error}=await db.rpc('list_campaign_item_effects',{p_campaign:campaign});
        if(error)throw error;
        if(!cancelled)setEffects(Array.isArray(data)?data as EffectRow[]:[]);
      }catch(e){
        if(!cancelled)setError(inventoryErrorMessage(e));
      }finally{
        if(!cancelled)setLoading(false);
      }
    }
    void load();return()=>{cancelled=true};
  },[db,campaign]);

  const reset=()=>{setEditing(null);setAttribute('');setOperation('add');setAmount('1');setStackingGroup('');setRequiresCategory('');setVisibility('identified');setPreviewRows([]);setPreviewSignature('');setPreviewError('');};
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
  const preview=async()=>{
    setPreviewError('');
    const numeric=Number(amount);
    if(!previewCharacter||!selected||!enabledAttributes.includes(attribute)||!enabledOperations.includes(operation)||!amount.trim()||!Number.isFinite(numeric)){
      setPreviewError('Select an item, character, attribute, operation and valid number before previewing.');return;
    }
    if(operation==='multiply'&&(numeric<0||numeric>100)){setPreviewError('Multiply must be between 0 and 100.');return;}
    if(numeric < -1000||numeric > 1000){setPreviewError('Value must be between -1000 and 1000.');return;}
    if(stackingGroup&&!/^[A-Za-z0-9_-]{1,60}$/.test(stackingGroup)){setPreviewError('Stacking group can contain only letters, digits, underscores and hyphens.');return;}
    setPreviewPending(true);
    const signature=currentPreviewSignature;
    try{
      const {data,error}=await db.rpc('preview_campaign_item_effect',{
        p_campaign:campaign,p_character:previewCharacter,p_definition:selected,p_effect:editing,
        p_attribute:attribute,p_operation:operation,p_value:numeric,p_group:stackingGroup||null,
        p_requires_category:requiresCategory||null,p_visibility:visibility
      });
      if(error)throw error;
      setPreviewRows(Array.isArray(data)?data as PreviewRow[]:[]);
      setPreviewSignature(signature);
    }catch(e){setPreviewRows([]);setPreviewSignature('');setPreviewError(inventoryErrorMessage(e))}
    finally{setPreviewPending(false)}
  };
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');setNotice('');
    const numeric=Number(amount);
    if(!selected||!enabledAttributes.includes(attribute)||!enabledOperations.includes(operation)||!amount.trim()||!Number.isFinite(numeric)){
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
                {enabledAttributes.map(code=><option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label>Operation
              <select value={operation} required onChange={e=>setOperation(e.target.value)}>
                {enabledOperations.map(op=><option key={op} value={op}>{op}</option>)}
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
          <div className="nx-effect-preview">
            <h4>Preview before saving</h4>
            <label htmlFor="nx-effect-preview-character">Preview character
              <select id="nx-effect-preview-character" value={previewCharacter} onChange={e=>setPreviewCharacter(e.target.value)} disabled={pending||previewPending}>
                <option value="">Choose character…</option>
                {characterOptions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={()=>{void preview()}} disabled={pending||previewPending||!previewCharacter} className="nx-effect-preview-button">{previewPending?'Calculating…':'Preview effect'}</button>
            {previewError&&<p className="nx-effect-error" role="alert">{previewError}</p>}
            {!previewIsCurrent&&previewRows.length>0&&<p className="nx-effect-preview-stale">Effect settings changed. Run Preview effect again to update the comparison.</p>}
            {previewIsCurrent&&previewRows.length>0&&<div className="nx-effect-preview-results" role="status" aria-live="polite">
              <strong>Calculated preview · Not saved</strong>
              {!previewRows[0]?.item_is_equipped&&<p className="nx-effect-preview-assumption">Simulation assumes this item is identified and equipped. No equipment slots or inventory items are changed.</p>}
              {previewRows[0]?.item_is_equipped&&<p className="nx-effect-preview-assumption">This item is already equipped; the result previews the effect change without saving it.</p>}
              {previewRows.filter(r=>r.current_score!==null||r.preview_score!==null).map(r=><div className="nx-effect-preview-row" key={r.attribute_code}>
                <span>{r.attribute_code}</span>
                <span>{r.current_score===null?'—':Number(r.current_score).toLocaleString()} ({r.current_modifier===null?'—':(r.current_modifier>=0?'+':'')+r.current_modifier})</span>
                <span aria-hidden="true">→</span>
                <strong>{r.preview_score===null?'—':Number(r.preview_score).toLocaleString()} ({r.preview_modifier===null?'—':(r.preview_modifier>=0?'+':'')+r.preview_modifier})</strong>
              </div>)}
              {previewRows.every(r=>Number(r.current_score)===Number(r.preview_score))&&<p className="nx-effect-preview-assumption">No effective attribute change. The configured condition, stacking policy, or existing equipment may prevent this effect from changing scores.</p>}
            </div>}
            <p className="nx-effect-preview-disclaimer">Preview uses the campaign's live ruleset effects and character attributes. It does not check whether this item can legally occupy an equipment slot.</p>
          </div>
          <div className="nx-effect-controls">
            <button type="submit" disabled={pending||previewPending}>{pending?'Saving…':editing?'Update effect':'Add effect'}</button>
            {editing&&<button type="button" className="secondary" disabled={pending||previewPending} onClick={reset}>Cancel edit</button>}
          </div>
        </form>
      </>}
    </>}
    {error&&<p className="nx-effect-error" role="alert">{error}</p>}
    {notice&&<p className="nx-effect-success" role="status">{notice}</p>}
  </section>;
}
