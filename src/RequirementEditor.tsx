import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './requirement-editor.css';

type Definition={id:string;name:string;code?:string|null;source_info?:Record<string,unknown>|null;default_properties?:Record<string,unknown>|null};
type Props={db:SupabaseClient;campaign:string;definitions:Definition[];attributes:string[];onChanged:()=>Promise<void>};
const categoryOptions=['weapon','shield','armor','clothing','jewelry','ring','headgear','footwear','focus','tool','wondrous','gear','container'];
export default function RequirementEditor({db,campaign,definitions,attributes,onChanged}:Props){
  const available=(Array.isArray(definitions)?definitions:[]).filter(d=>d&&typeof d.id==='string'&&typeof d.name==='string'&&!d.source_info?.import_batch&&!/^srd/i.test(d.code??''));
  const codes=(Array.isArray(attributes)?attributes:[]).filter((a):a is string=>typeof a==='string');
  const [selected,setSelected]=useState('');
  const [minimums,setMinimums]=useState<Record<string,string>>({});
  const [forbidden,setForbidden]=useState<string[]>([]);
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{setSelected('');setMinimums({});setForbidden([]);setMessage('');setError('')},[campaign]);
  const selectedDefinition=available.find(d=>d.id===selected);
  function selectDefinition(id:string){
    setSelected(id);setMessage('');setError('');
    const item=available.find(d=>d.id===id);
    const raw=item?.default_properties?.equip_requirements;
    const requirements=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
    const attrs=requirements.min_attributes&&typeof requirements.min_attributes==='object'&&!Array.isArray(requirements.min_attributes)?requirements.min_attributes as Record<string,unknown>:{};
    setMinimums(Object.fromEntries(codes.map(code=>[code,attrs[code]===undefined?'':String(attrs[code])])));
    setForbidden(Array.isArray(requirements.forbidden_equipped_categories)?requirements.forbidden_equipped_categories.filter((c):c is string=>typeof c==='string'&&categoryOptions.includes(c)):[]);
  }
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');setMessage('');
    if(!selectedDefinition){setError('Select a campaign-created item.');return;}
    const mins:Record<string,number>={};
    for(const code of codes){
      const value=minimums[code]?.trim()??'';
      if(!value)continue;
      if(!/^\d{1,3}$/.test(value)||Number(value)>100){setError('Requirements must be whole base attribute scores between 0 and 100.');return;}
      mins[code]=Number(value);
    }
    setPending(true);
    try{
      const {error:rpcError}=await db.rpc('save_campaign_item_equip_requirements',{
        p_campaign:campaign,p_definition:selected,p_min_attributes:mins,p_forbidden_categories:forbidden
      });
      if(rpcError)throw rpcError;
      await onChanged();
      setMessage('Equipment requirements saved. Characters must meet these rules before equipping.');
    }catch(e){setError(inventoryErrorMessage(e))}
    finally{setPending(false)}
  };
  return <section className="nx-requirement-panel" aria-labelledby="nx-requirement-heading">
    <h2 id="nx-requirement-heading">Equipment Requirements (GM)</h2>
    <p>Set prerequisites and equipment conflicts for campaign-created items. Minimum scores use the character's saved base attributes, not equipment-adjusted scores.</p>
    {available.length===0?<p>Create a custom catalog item before configuring requirements.</p>:<>
      <label>Catalog item
        <select value={selected} disabled={pending} onChange={e=>selectDefinition(e.target.value)}>
          <option value="">Select an item…</option>
          {[...available].sort((a,b)=>a.name.localeCompare(b.name)).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      {selected&&<form className="nx-requirement-form" onSubmit={e=>{void save(e)}}>
        <h3>Minimum base attributes</h3>
        <div className="nx-requirement-attributes">
          {codes.map(code=><label key={code}>{code}
            <input type="number" inputMode="numeric" min={0} max={100} step={1} placeholder="None"
              value={minimums[code]??''} disabled={pending}
              onChange={e=>setMinimums(old=>({...old,[code]:e.target.value}))}/>
          </label>)}
        </div>
        <h3>Cannot equip alongside</h3>
        <div className="nx-requirement-categories">
          {categoryOptions.map(category=><label key={category}>
            <input type="checkbox" checked={forbidden.includes(category)} disabled={pending}
              onChange={e=>setForbidden(old=>e.target.checked?[...old,category]:old.filter(c=>c!==category))}/>
            {category}
          </label>)}
        </div>
        <p className="nx-requirement-help">Slot occupants that would be automatically replaced do not count as conflicts. Requirements are checked before replacement and equip transactions.</p>
        <button type="submit" disabled={pending}>{pending?'Saving…':'Save Requirements'}</button>
        {error&&<p role="alert" className="nx-requirement-error">{error}</p>}
        {message&&<p role="status" className="nx-requirement-success">{message}</p>}
      </form>}
    </>}
  </section>;
}
