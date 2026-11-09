import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FlaskConical,RefreshCw} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './crafting.css';
type Ingredient={definition_id:string;name:string;quantity:number};
type Recipe={id:string;name:string;description:string;output_name:string;output_quantity:number;active:boolean;ingredients:Ingredient[]};
type Material={definition_id:string;name:string;available:number|string};
type ToolRequirement={recipe_id:string;definition_id:string;name:string;quantity:number};
type CraftHistory={id:string;recipe_name:string;output_name:string;quantity:number;crafts:number;occurred_at:string};
type Props={db:SupabaseClient;campaign:string;character:string;inventoryVersion:number;busy:boolean;onChanged:()=>Promise<void>};
export default function CharacterCraftingPanel({db,campaign,character,inventoryVersion,busy,onChanged}:Props){
 const [recipes,setRecipes]=useState<Recipe[]>([]),[materials,setMaterials]=useState<Material[]>([]),[history,setHistory]=useState<CraftHistory[]>([]);
 const [requirements,setRequirements]=useState<ToolRequirement[]>([]),[ownedTools,setOwnedTools]=useState<Material[]>([]);
 const [craftCounts,setCraftCounts]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [review,setReview]=useState<{recipe:Recipe;count:number}|null>(null);
 const load=async()=>{
  const [a,b,c,d,e]=await Promise.all([
   db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),
   db.rpc('list_character_crafting_materials',{p_character:character}),
   db.rpc('list_character_crafting_history',{p_character:character,p_limit:30}),
   db.rpc('list_campaign_crafting_tools',{p_campaign:campaign}),
   db.rpc('list_character_crafting_tools',{p_character:character})
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;if(e.error)throw e.error;
  setRecipes((a.data||[]).filter((r:Recipe)=>r.active));setMaterials(b.data||[]);setHistory(c.data||[]);
  setRequirements(d.data||[]);setOwnedTools(e.data||[]);
 };
 useEffect(()=>{let cancelled=false;setLoading(true);setError('');setReview(null);
  void Promise.all([
   db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),
   db.rpc('list_character_crafting_materials',{p_character:character}),
   db.rpc('list_character_crafting_history',{p_character:character,p_limit:30}),
   db.rpc('list_campaign_crafting_tools',{p_campaign:campaign}),
   db.rpc('list_character_crafting_tools',{p_character:character})
  ]).then(([a,b,c,d,e])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;if(e.error)throw e.error;
   if(!cancelled){setRecipes((a.data||[]).filter((r:Recipe)=>r.active));setMaterials(b.data||[]);setHistory(c.data||[]);setRequirements(d.data||[]);setOwnedTools(e.data||[])}
  }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))})
  .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[db,campaign,character,inventoryVersion]);
 const available=(id:string)=>Number(materials.find(m=>m.definition_id===id)?.available??0);
 const toolCount=(id:string)=>Number(ownedTools.find(t=>t.definition_id===id)?.available??0);
 const toolsFor=(id:string)=>requirements.filter(t=>t.recipe_id===id);
 const canCraft=(r:Recipe,n:number)=>n>=1&&n<=100&&Number.isInteger(n)&&r.ingredients.length>0&&
 r.ingredients.every(i=>available(i.definition_id)>=Number(i.quantity)*n)&&
 toolsFor(r.id).every(t=>toolCount(t.definition_id)>=Number(t.quantity));
 const craft=async()=>{
  if(!review||working||busy)return;setWorking(true);setError('');setNotice('');
  try{
   const {data,error:rpcError}=await db.rpc('craft_character_recipe',{p_character:character,p_recipe:review.recipe.id,p_crafts:review.count});
   if(rpcError)throw rpcError;
   setReview(null);
   await onChanged();await load();
   setNotice('Crafted '+data.quantity+' × '+data.output+'. Required materials were consumed.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setWorking(false)}
 };
 return <section className="mv-crafting-screen">
  <div className="mv-crafting-heading"><h3><FlaskConical size={20}/> Crafting</h3>
   <button type="button" disabled={working||loading||busy} onClick={()=>{setLoading(true);void load().catch(e=>setError(inventoryErrorMessage(e))).finally(()=>setLoading(false))}}><RefreshCw size={15}/> Refresh</button>
  </div>
  <p>Combine materials using GM-approved recipes. Ingredients are consumed; required tools must be present but are not consumed. Only eligible, identified, unmodified, unequipped items outside containers are used as ingredients.</p>
  {loading&&<p>Loading recipes and available materials…</p>}
  {!loading&&recipes.length===0&&<p className="mv-empty">No active crafting recipes yet. Your GM can add recipes in the GM Dashboard.</p>}
  <div className="mv-crafting-recipes">{recipes.map(r=>{
   const count=Number(craftCounts[r.id]??'1'),eligible=canCraft(r,count);
   return <div className="mv-crafting-recipe" key={r.id}>
    <h4>{r.name}</h4>
    {r.description&&<p>{r.description}</p>}
    <p className="mv-crafting-output">Produces {r.output_quantity} × {r.output_name} per craft</p>
    <div className="mv-crafting-ingredients"><strong>Required materials</strong>
     {r.ingredients.map(i=><div key={i.definition_id}>
      <span>{i.name} × {Number(i.quantity)*Math.max(Number.isInteger(count)&&count>0?count:1,1)}</span>
      <span className={available(i.definition_id)>=Number(i.quantity)*count?'mv-crafting-ok':'mv-crafting-missing'}>Have {available(i.definition_id)}</span>
     </div>)}
    </div>
    {toolsFor(r.id).length>0&&<div className="mv-crafting-ingredients mv-crafting-tools"><strong>Required tools (not consumed)</strong>
     {toolsFor(r.id).map(t=><div key={t.definition_id}>
      <span>{t.name} × {t.quantity}</span>
      <span className={toolCount(t.definition_id)>=t.quantity?'mv-crafting-ok':'mv-crafting-missing'}>Have {toolCount(t.definition_id)}</span>
     </div>)}
    </div>}
    <label>Craft count<input type="number" min="1" max="100" step="1" value={craftCounts[r.id]??'1'} onChange={e=>{setCraftCounts(v=>({...v,[r.id]:e.target.value}));setReview(null)}}/></label>
    <button type="button" disabled={working||busy||!eligible} onClick={()=>{setReview({recipe:r,count});setError('')}}>Craft</button>
   </div>
  })}</div>
  {review&&<div className="mv-crafting-review" role="group" aria-label="Confirm crafting recipe">
   <strong>Confirm Crafting</strong>
   <p>Consume materials to produce {review.count*review.recipe.output_quantity} × {review.recipe.output_name}? This cannot be undone automatically.</p>
   <div><button type="button" disabled={working} onClick={()=>setReview(null)}>Cancel</button>
    <button type="button" disabled={working||busy||!canCraft(review.recipe,review.count)} onClick={()=>void craft()}>Confirm Craft</button></div>
  </div>}
  {error&&<p role="alert" className="mv-storage-error">{error}</p>}
  {notice&&<p role="status" className="mv-crafting-success">{notice}</p>}
  <section className="mv-crafting-history"><h4>Crafting History</h4>
   {history.length?history.map(h=><div key={h.id}><strong>{h.recipe_name} · {h.quantity} × {h.output_name}</strong>
    <span>{h.crafts} craft(s) · {new Date(h.occurred_at).toLocaleString()}</span></div>):<p>No crafting history yet.</p>}
  </section>
 </section>;
}
