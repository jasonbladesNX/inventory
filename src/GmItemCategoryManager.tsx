import React,{useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';

export type CampaignItemCategory={
  id:string;code:string;name:string;description:string;default_stackable:boolean;active:boolean;
};
type ItemDefinition={id:string;name:string;category:string;campaign_id:string|null};
type Props={
  db:SupabaseClient;campaign:string;categories:CampaignItemCategory[];
  definitions:ItemDefinition[];builtInCategories:string[][];
  onChanged:()=>Promise<void>;
};
export default function GmItemCategoryManager({db,campaign,categories,definitions,builtInCategories,onChanged}:Props){
  const [selectedCategory,setSelectedCategory]=useState('');
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [stackable,setStackable]=useState(true);
  const [active,setActive]=useState(true);
  const [selectedItem,setSelectedItem]=useState('');
  const [targetCategory,setTargetCategory]=useState('gear');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  function pickCategory(id:string){
    setSelectedCategory(id);
    const row=categories.find(c=>c.id===id);
    setName(row?.name??'');setDescription(row?.description??'');
    setStackable(row?.default_stackable??true);setActive(row?.active??true);
  }
  async function saveCategory(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const {error:rpcError}=await db.rpc('save_campaign_item_category',{
        p_campaign:campaign,p_category_id:selectedCategory||null,p_name:name,
        p_description:description,p_default_stackable:stackable,p_active:active
      });
      if(rpcError)throw rpcError;
      await onChanged();setMessage(selectedCategory?'Category updated. Existing item references are preserved.':'Category created.');
      if(!selectedCategory)pickCategory('');
    }catch(err){setError(inventoryErrorMessage(err))}
    finally{setBusy(false)}
  }
  async function assignCategory(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const {error:rpcError}=await db.rpc('set_campaign_item_category',{
        p_campaign:campaign,p_definition:selectedItem,p_category:targetCategory
      });
      if(rpcError)throw rpcError;
      await onChanged();setMessage('Item category saved. Existing inventory and history remain linked to this item.');
    }catch(err){setError(inventoryErrorMessage(err))}
    finally{setBusy(false)}
  }
  const customItems=definitions.filter(d=>!!d.campaign_id).sort((a,b)=>a.name.localeCompare(b.name));
  const choices=[...builtInCategories,...categories.filter(c=>c.active).map(c=>[c.code,c.name])];
  return <div className="nx-gm-item-categories">
    <form className="nx-tool-form" onSubmit={saveCategory}>
      <h3>Manage Item Categories</h3>
      <p className="nx-small-note">Categories belong to this campaign. Renaming preserves the category ID and existing item assignments. Stacking defaults apply to newly created items only.</p>
      <label>Category to edit
        <select value={selectedCategory} onChange={e=>pickCategory(e.target.value)}>
          <option value="">Create a new category…</option>
          {categories.map(c=><option key={c.id} value={c.id}>{c.name}{!c.active?' (inactive)':''}</option>)}
        </select>
      </label>
      <label>Category name<input required minLength={2} maxLength={70} value={name} placeholder="Herbs, Minerals, Quest Items…" onChange={e=>setName(e.target.value)}/></label>
      <label>Description (optional)<input maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label className="nx-checkbox"><input type="checkbox" checked={stackable} onChange={e=>setStackable(e.target.checked)}/> New items stack by default</label>
      {selectedCategory&&<label className="nx-checkbox"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Category active (cannot deactivate while items use it)</label>}
      <button type="submit" disabled={busy||!name.trim()}>{selectedCategory?'Save Category':'Create Category'}</button>
    </form>
    <form className="nx-tool-form" onSubmit={assignCategory}>
      <h3>Assign Item Category</h3>
      <p className="nx-small-note">Move a custom catalog item to a different category without recreating its definition. Equipped items must be unequipped first; equipment and stacking rules remain enforced.</p>
      <label>Custom catalog item
        <select required value={selectedItem} onChange={e=>{const id=e.target.value;setSelectedItem(id);setTargetCategory(customItems.find(d=>d.id===id)?.category??'gear')}}>
          <option value="">Choose an item…</option>
          {customItems.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label>Assign to category
        <select value={targetCategory} onChange={e=>setTargetCategory(e.target.value)}>
          {choices.map(([code,label])=><option value={code} key={code}>{label}</option>)}
          {!choices.some(([code])=>code===targetCategory)&&<option value={targetCategory}>{categories.find(c=>c.code===targetCategory)?.name??targetCategory} (inactive)</option>}
        </select>
      </label>
      <button type="submit" disabled={busy||!selectedItem}>Save Item Category</button>
    </form>
    {error&&<p className="mv-error" role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
  </div>
}
