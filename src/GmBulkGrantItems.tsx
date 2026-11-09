import React,{useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Plus,Trash2} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './gm-multi-grants.css';

type Character={id:string;name:string};
type Definition={id:string;name:string;category?:string};
type GrantLine={key:number;definition:string;quantity:string};
type Props={
  db:SupabaseClient;
  campaign:string;
  characters:Character[];
  definitions:Definition[];
  disabled:boolean;
  onGranted:(characterId:string)=>Promise<void>;
};
const MAX_LINES=25;
const MAX_TOTAL=1000000;

export default function GmBulkGrantItems({db,campaign,characters,definitions,disabled,onGranted}:Props){
  const [recipient,setRecipient]=useState('');
  const [lines,setLines]=useState<GrantLine[]>([{key:0,definition:'',quantity:'1'}]);
  const nextKey=useRef(1);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const occupied=new Set(lines.map(l=>l.definition).filter(Boolean));
  const selectedCount=lines.filter(l=>l.definition).length;
  const totalUnits=lines.reduce((sum,l)=>sum+(Number.isSafeInteger(Number(l.quantity))&&Number(l.quantity)>0?Number(l.quantity):0),0);
  const unavailable=disabled||saving;

  function changeLine(key:number,field:'definition'|'quantity',value:string){
    setLines(old=>old.map(l=>l.key===key?{...l,[field]:value}:l));
    setError('');setMessage('');
  }
  function addLine(){
    if(lines.length>=MAX_LINES)return;
    setLines(old=>[...old,{key:nextKey.current++,definition:'',quantity:'1'}]);
    setError('');setMessage('');
  }
  function removeLine(key:number){
    setLines(old=>old.length===1?[{key:nextKey.current++,definition:'',quantity:'1'}]:old.filter(l=>l.key!==key));
    setError('');setMessage('');
  }
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(unavailable)return;
    setError('');setMessage('');
    const character=characters.find(c=>c.id===recipient);
    if(!character){setError('Select a recipient character.');return;}
    if(!lines.length||lines.length>MAX_LINES){setError('Select between 1 and 25 different items.');return;}
    const seen=new Set<string>();
    const payload:{definition_id:string;quantity:number}[]=[];
    let total=0;
    for(const line of lines){
      const item=definitions.find(d=>d.id===line.definition);
      const quantity=Number(line.quantity);
      if(!item){setError('Choose a catalog item for every row.');return;}
      if(seen.has(item.id)){setError('Each catalog item can appear only once; increase its quantity instead.');return;}
      if(!/^\d+$/.test(line.quantity)||!Number.isSafeInteger(quantity)||quantity<1||quantity>MAX_TOTAL){
        setError('Enter a whole-number quantity between 1 and 1,000,000 for each item.');return;
      }
      total+=quantity;
      if(total>MAX_TOTAL){setError('The total quantity for one grant cannot exceed 1,000,000 units.');return;}
      seen.add(item.id);
      payload.push({definition_id:item.id,quantity});
    }
    setSaving(true);
    try{
      const {data,error:rpcError}=await db.rpc('grant_inventory_items_bulk',{
        p_campaign:campaign,p_character:recipient,p_items:payload
      });
      if(rpcError)throw rpcError;
      const numberOfTypes=Number(data?.item_types??payload.length);
      const numberOfUnits=Number(data?.total_quantity??total);
      setLines([{key:nextKey.current++,definition:'',quantity:'1'}]);
      setMessage(`Granted ${numberOfUnits.toLocaleString()} unit(s) across ${numberOfTypes} different item(s) to ${character.name}.`);
      // The grant is already committed; a preview refresh error should not
      // suggest that re-submitting the grant is safe.
      try{await onGranted(recipient);}
      catch{setMessage(`Grant completed for ${character.name}, but the character preview could not refresh. Reopen the inventory to see the items.`);}
    }catch(err){
      setError(`No items were granted. ${inventoryErrorMessage(err)}`);
    }finally{setSaving(false);}
  }

  return <form className="nx-tool-form nx-grant-form" onSubmit={e=>void submit(e)}>
    <label className="nx-form-field" htmlFor="nx-grant-recipient">Recipient Character
      <select id="nx-grant-recipient" required value={recipient} disabled={unavailable} onChange={e=>{setRecipient(e.target.value);setError('');setMessage('')}}>
        <option value="">Choose a character…</option>
        {characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    <div className="nx-grant-lines">
      <div className="nx-grant-lines-header"><h3>Items to Grant</h3><span>Up to {MAX_LINES} different items</span></div>
      {lines.map((line,index)=><div className="nx-grant-line" key={line.key}>
        <label className="nx-grant-item-label" htmlFor={`nx-grant-item-${line.key}`}>Item {index+1}
          <select id={`nx-grant-item-${line.key}`} required disabled={unavailable}
            value={line.definition} onChange={e=>changeLine(line.key,'definition',e.target.value)}>
            <option value="">Choose a catalog item…</option>
            {definitions.map(d=><option key={d.id} value={d.id} disabled={occupied.has(d.id)&&d.id!==line.definition}>{d.name}</option>)}
          </select>
        </label>
        <label className="nx-grant-quantity-label" htmlFor={`nx-grant-quantity-${line.key}`}>Quantity
          <input id={`nx-grant-quantity-${line.key}`} type="number" min="1" max={MAX_TOTAL} step="1" required
            value={line.quantity} disabled={unavailable} onChange={e=>changeLine(line.key,'quantity',e.target.value)}/>
        </label>
        <button type="button" className="nx-grant-remove" disabled={unavailable} aria-label={`Remove item ${index+1}`}
          onClick={()=>removeLine(line.key)}><Trash2 size={15} aria-hidden="true"/> Remove</button>
      </div>)}
    </div>
    <div className="nx-grant-actions">
      <button type="button" className="nx-grant-add" onClick={addLine}
        disabled={unavailable||lines.length>=MAX_LINES||occupied.size>=definitions.length}>
        <Plus size={16} aria-hidden="true"/> Add Another Item
      </button>
      <span className="nx-grant-summary">{selectedCount} item type(s) · {totalUnits.toLocaleString()} total unit(s)</span>
    </div>
    <p className="nx-small-note">Each row has its own quantity. Stackable items combine where compatible; equipment remains separate. All entries are granted together or none are.</p>
    {error&&<p className="nx-grant-error" role="alert">{error}</p>}
    {message&&<p className="nx-grant-success" role="status">{message}</p>}
    <button type="submit" className="nx-primary-action"
      disabled={unavailable||!recipient||!lines.every(l=>l.definition&&l.quantity)}>Grant Selected Items</button>
  </form>;
}
