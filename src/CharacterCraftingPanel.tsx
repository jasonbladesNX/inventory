import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FlaskConical,RefreshCw} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './crafting.css';
type Ingredient={definition_id:string;name:string;quantity:number};
type Recipe={id:string;name:string;description:string;output_name:string;output_quantity:number;active:boolean;ingredients:Ingredient[]};
type Material={definition_id:string;name:string;available:number|string};
type ToolRequirement={recipe_id:string;definition_id:string;name:string;quantity:number};
type CraftCheck={recipe_id:string;minutes_per_craft:number;check_name:string|null;attribute_code:string|null;difficulty_class:number|null};
type CheckHistory={id:string;recipe_name:string;success:boolean;check_name:string|null;roll:number|null;modifier:number|null;total:number|null;difficulty_class:number|null;minutes:number|null;output_name:string|null;quantity:number|null;occurred_at:string};
type CraftHistory={id:string;recipe_name:string;output_name:string;quantity:number;crafts:number;occurred_at:string};
type Props={db:SupabaseClient;campaign:string;character:string;inventoryVersion:number;busy:boolean;onChanged:()=>Promise<void>};
export default function CharacterCraftingPanel({db,campaign,character,inventoryVersion,busy,onChanged}:Props){
 const [recipes,setRecipes]=useState<Recipe[]>([]),[materials,setMaterials]=useState<Material[]>([]),[history,setHistory]=useState<CraftHistory[]>([]);
 const [requirements,setRequirements]=useState<ToolRequirement[]>([]),[ownedTools,setOwnedTools]=useState<Material[]>([]);
 const [checks,setChecks]=useState<CraftCheck[]>([]),[checkHistory,setCheckHistory]=useState<CheckHistory[]>([]);
 const [craftCounts,setCraftCounts]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [review,setReview]=useState<{recipe:Recipe;count:number}|null>(null);
 const load=async()=>{
  const [a,b,c,d,e,f,g]=await Promise.all([
   db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),
   db.rpc('list_character_crafting_materials',{p_character:character}),
   db.rpc('list_character_crafting_history',{p_character:character,p_limit:30}),
   db.rpc('list_campaign_crafting_tools',{p_campaign:campaign}),
   db.rpc('list_character_crafting_tools',{p_character:character}),
   db.rpc('list_campaign_crafting_checks',{p_campaign:campaign}),
   db.rpc('list_character_crafting_check_history',{p_character:character,p_limit:30})
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;if(e.error)throw e.error;if(f.error)throw f.error;if(g.error)throw g.error;
  setRecipes((a.data||[]).filter((r:Recipe)=>r.active));setMaterials(b.data||[]);setHistory(c.data||[]);
  setRequirements(d.data||[]);setOwnedTools(e.data||[]);setChecks(f.data||[]);setCheckHistory(g.data||[]);
 };
 useEffect(()=>{let cancelled=false;setLoading(true);setError('');setReview(null);
  void Promise.all([
   db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),
   db.rpc('list_character_crafting_materials',{p_character:character}),
   db.rpc('list_character_crafting_history',{p_character:character,p_limit:30}),
   db.rpc('list_campaign_crafting_tools',{p_campaign:campaign}),
   db.rpc('list_character_crafting_tools',{p_character:character}),
   db.rpc('list_campaign_crafting_checks',{p_campaign:campaign}),
   db.rpc('list_character_crafting_check_history',{p_character:character,p_limit:30})
  ]).then(([a,b,c,d,e,f,g])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;if(e.error)throw e.error;if(f.error)throw f.error;if(g.error)throw g.error;
   if(!cancelled){setRecipes((a.data||[]).filter((r:Recipe)=>r.active));setMaterials(b.data||[]);setHistory(c.data||[]);setRequirements(d.data||[]);setOwnedTools(e.data||[]);setChecks(f.data||[]);setCheckHistory(g.data||[])}
  }).catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))})
  .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[db,campaign,character,inventoryVersion]);
 const available=(id:string)=>Number(materials.find(m=>m.definition_id===id)?.available??0);
 const toolCount=(id:string)=>Number(ownedTools.find(t=>t.definition_id===id)?.available??0);
 const toolsFor=(id:string)=>requirements.filter(t=>t.recipe_id===id);
 const checkFor=(id:string)=>checks.find(c=>c.recipe_id===id);
 const canCraft=(r:Recipe,n:number)=>n>=1&&n<=100&&Number.isInteger(n)&&r.ingredients.length>0&&
 r.ingredients.every(i=>available(i.definition_id)>=Number(i.quantity)*n)&&
 toolsFor(r.id).every(t=>toolCount(t.definition_id)>=Number(t.quantity));
 const craft=async()=>{
  if(!review||working||busy)return;setWorking(true);setError('');setNotice('');
  try{
   const {data,error:rpcError}=await db.rpc('craft_character_recipe_checked',{p_character:character,p_recipe:review.recipe.id,p_crafts:review.count});
   if(rpcError)throw rpcError;
   setReview(null);
   await onChanged();await load();
   if(data.success===false){
    setNotice('Crafting check failed: '+data.check_name+' '+data.total+' (rolled '+data.roll+' + '+data.modifier+') vs DC '+data.difficulty_class+'. No materials consumed.');
   }else{
    setNotice('Crafted '+data.quantity+' × '+data.output+'.'+(data.roll==null?'':' Check '+data.total+' vs DC '+data.difficulty_class+'.')+' In-game time: '+data.minutes+' minutes.');
   }
  }catch(e){setError(inventoryErrorMessage(e))}finally{setWorking(false)}
 };
 return <section className="mv-crafting-screen">
  <div className="mv-crafting-heading"><h3><FlaskConical size={20}/> Crafting</h3>
   <button type="button" disabled={working||loading||busy} onClick={()=>{setLoading(true);void load().catch(e=>setError(inventoryErrorMessage(e))).finally(()=>setLoading(false))}}><RefreshCw size={15}/> Refresh</button>
  </div>
  <p>Craft using GM-approved recipes. Ingredients are consumed on success; tools remain in inventory. Optional checks roll a server-side d20 plus your effective attribute modifier. Time is recorded in-game, not counted down in real time.</p>
  {loading&&<p>Loading recipes and available materials…</p>}
  {!loading&&recipes.length===0&&<p className="mv-empty">No active crafting recipes yet. Your GM can add recipes in the GM Dashboard.</p>}
  <div className="mv-crafting-recipes">{recipes.map(r=>{
   const count=Number(craftCounts[r.id]??'1'),eligible=canCraft(r,count);
   return <div className="mv-crafting-recipe" key={r.id}>
    <h4>{r.name}</h4>
    {r.description&&<p>{r.description}</p>}
    <p className="mv-crafting-output">Produces {r.output_quantity} × {r.output_name} per craft</p>
    {checkFor(r.id)&&<p className="mv-crafting-check-info">
      In-game time: {Number(checkFor(r.id)?.minutes_per_craft??0)*Math.max(count>0&&Number.isInteger(count)?count:1,1)} minutes
      {checkFor(r.id)?.attribute_code&&<> · {checkFor(r.id)?.check_name} ({checkFor(r.id)?.attribute_code}) DC {checkFor(r.id)?.difficulty_class} — one check per crafting action</>}
    </p>}
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
   <p>{checkFor(review.recipe.id)?.attribute_code?'Roll the required check and, if successful, consume materials to produce':'Consume materials to produce'} {review.count*review.recipe.output_quantity} × {review.recipe.output_name}? {checkFor(review.recipe.id)?.minutes_per_craft?String(Number(checkFor(review.recipe.id)?.minutes_per_craft)*review.count)+' in-game minutes are recorded. ':''}Successful crafting cannot be undone automatically.</p>
   <div><button type="button" disabled={working} onClick={()=>setReview(null)}>Cancel</button>
    <button type="button" disabled={working||busy||!canCraft(review.recipe,review.count)} onClick={()=>void craft()}>Confirm Craft</button></div>
  </div>}
  {error&&<p role="alert" className="mv-storage-error">{error}</p>}
  {notice&&<p role="status" className="mv-crafting-success">{notice}</p>}
  <section className="mv-crafting-history"><h4>Crafting History</h4>
   {checkHistory.length?checkHistory.map(h=><div key={h.id}>
    <strong>{h.recipe_name} · {h.success?String(h.quantity??0)+' × '+(h.output_name??'crafted item'):'Check failed — no materials consumed'}</strong>
    <span>{h.check_name&&h.roll!=null?h.check_name+': '+h.roll+' + '+h.modifier+' = '+h.total+' vs DC '+h.difficulty_class+' · ':''}{h.minutes??0} in-game minutes · {new Date(h.occurred_at).toLocaleString()}</span>
   </div>):<p>No crafting history yet.</p>}
  </section>
 </section>;
}
