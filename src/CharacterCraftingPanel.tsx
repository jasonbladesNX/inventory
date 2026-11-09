import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BookOpen,Clock3,FlaskConical,RefreshCw,X} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './crafting.css';
type Ingredient={definition_id:string;name:string;quantity:number};
type Recipe={id:string;name:string;description:string;output_name:string;output_quantity:number;active:boolean;ingredients:Ingredient[]};
type Material={definition_id:string;name:string;available:number|string};
type Requirement={recipe_id:string;definition_id:string;name:string;quantity:number};
type Progression={recipe_id:string;category_name:string;skill_id:string;skill_name:string;attribute_code:string;learn_dc:number;craft_dc:number;time_mode:string;minutes_per_craft:number};
type Known={recipe_id:string;learned_at:string};
type Scroll={item_id:string;recipe_id:string;recipe_name:string;category_name:string;skill_name:string;learn_dc:number;quantity:number};
type Skill={skill_id:string;skill_name:string;attribute_code:string;attribute_modifier:number;skill_bonus:number;total_modifier:number};
type Job={id:string;recipe_id:string;recipe_name:string;status:string;started_at:string;ready_at:string;completed_at:string|null;crafts:number;success:boolean;roll:number;modifier:number;total:number;dc:number;time_mode:string;minutes:number;output_name:string;output_quantity:number};
type Props={db:SupabaseClient;campaign:string;character:string;inventoryVersion:number;busy:boolean;onChanged:()=>Promise<void>};
export default function CharacterCraftingPanel({db,campaign,character,inventoryVersion,busy,onChanged}:Props){
 const [recipes,setRecipes]=useState<Recipe[]>([]),[materials,setMaterials]=useState<Material[]>([]);
 const [tools,setTools]=useState<Requirement[]>([]),[ownedTools,setOwnedTools]=useState<Material[]>([]);
 const [progression,setProgression]=useState<Progression[]>([]),[known,setKnown]=useState<Known[]>([]),[scrolls,setScrolls]=useState<Scroll[]>([]);
 const [skills,setSkills]=useState<Skill[]>([]),[jobs,setJobs]=useState<Job[]>([]);
 const [counts,setCounts]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true),[working,setWorking]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [review,setReview]=useState<{recipe:Recipe;count:number}|null>(null);
 const [selectedRecipeId,setSelectedRecipeId]=useState<string|null>(null);
 const modalCloseRef=useRef<HTMLButtonElement>(null);
 const recipeTriggerRef=useRef<HTMLButtonElement|null>(null);
 const [clock,setClock]=useState(()=>Date.now());
 const load=async()=>{
  const names=['list_campaign_crafting_recipes','list_character_crafting_materials','list_campaign_crafting_tools',
   'list_character_crafting_tools','list_crafting_recipe_progression','list_character_learned_crafting_recipes',
   'list_character_recipe_items','list_character_crafting_skills','list_character_crafting_jobs'] as const;
  const args=[{p_campaign:campaign},{p_character:character},{p_campaign:campaign},{p_character:character},
   {p_campaign:campaign},{p_character:character},{p_character:character},{p_character:character},{p_character:character}];
  const rows=await Promise.all(names.map((name,i)=>db.rpc(name,args[i])));
  for(const row of rows)if(row.error)throw row.error;
  setRecipes((rows[0].data||[]).filter((r:Recipe)=>r.active));setMaterials(rows[1].data||[]);
  setTools(rows[2].data||[]);setOwnedTools(rows[3].data||[]);
  setProgression(rows[4].data||[]);setKnown(rows[5].data||[]);
  setScrolls(rows[6].data||[]);setSkills(rows[7].data||[]);setJobs(rows[8].data||[]);
  setClock(Date.now());
 };
 useEffect(()=>{let alive=true;setLoading(true);setError('');setReview(null);setSelectedRecipeId(null);
  void load().catch(e=>{if(alive)setError(inventoryErrorMessage(e))}).finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[db,campaign,character,inventoryVersion]);
 useEffect(()=>{const id=window.setInterval(()=>setClock(Date.now()),1000);return()=>window.clearInterval(id)},[]);
 const closeRecipeDetails=()=>{setSelectedRecipeId(null);setReview(null);};
 useEffect(()=>{
  if(!selectedRecipeId)return;
  const focusRequest=window.requestAnimationFrame(()=>modalCloseRef.current?.focus());
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();closeRecipeDetails();recipeTriggerRef.current?.focus();}
   if(event.key==='Tab'){
    const dialog=modalCloseRef.current?.closest('[role="dialog"]');
    const focusable=dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]');
    if(!focusable?.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   }
  };
  document.addEventListener('keydown',onKey);
  return()=>{window.cancelAnimationFrame(focusRequest);document.removeEventListener('keydown',onKey)};
 },[selectedRecipeId]);

 const reload=async()=>{setLoading(true);setError('');try{await load()}catch(e){setError(inventoryErrorMessage(e))}finally{setLoading(false)}};
 const skillFor=(id:string)=>skills.find(s=>s.skill_id===progression.find(p=>p.recipe_id===id)?.skill_id);
 const settingFor=(id:string)=>progression.find(p=>p.recipe_id===id);
 const owned=(id:string)=>Number(materials.find(m=>m.definition_id===id)?.available??0);
 const toolCount=(id:string)=>Number(ownedTools.find(m=>m.definition_id===id)?.available??0);
 const toolsFor=(id:string)=>tools.filter(t=>t.recipe_id===id);
 const canCraft=(r:Recipe,count:number)=>Number.isInteger(count)&&count>=1&&count<=100&&
 r.ingredients.length>0&&Boolean(settingFor(r.id))&&known.some(k=>k.recipe_id===r.id)&&
 r.ingredients.every(i=>owned(i.definition_id)>=i.quantity*count)&&
 toolsFor(r.id).every(t=>toolCount(t.definition_id)>=t.quantity);
 const visible=useMemo(()=>recipes.filter(r=>known.some(k=>k.recipe_id===r.id)&&progression.some(p=>p.recipe_id===r.id))
  .sort((a,b)=>(settingFor(a.id)?.category_name??'').localeCompare(settingFor(b.id)?.category_name??'')||a.name.localeCompare(b.name)),
  [recipes,known,progression]);
 const act=async(fn:()=>Promise<void>)=>{if(working||busy)return;setWorking(true);setError('');setNotice('');
  try{await fn()}catch(e){setError(inventoryErrorMessage(e))}finally{setWorking(false)}
 };
 const learn=(item:Scroll)=>void act(async()=>{
  const {data,error:rpcError}=await db.rpc('learn_character_crafting_recipe',{p_character:character,p_item:item.item_id});
  if(rpcError)throw rpcError;
  await onChanged();await load();
  setNotice(data.success?
   'Learned '+data.recipe_name+'. Your Recipe item was consumed. Check '+data.roll+' + '+data.modifier+' = '+data.total+' vs DC '+data.dc+'.':
   'Learning check failed: '+data.roll+' + '+data.modifier+' = '+data.total+' vs DC '+data.dc+'. Your Recipe item remains available.');
 });
 const craft=()=>void act(async()=>{
  if(!review||!canCraft(review.recipe,review.count))throw Error('Recipe requirements are not met.');
  const {data,error:rpcError}=await db.rpc('start_character_crafting',{
   p_character:character,p_recipe:review.recipe.id,p_crafts:review.count});
  if(rpcError)throw rpcError;setReview(null);setSelectedRecipeId(null);
  await onChanged();await load();
  if(!data.success)setNotice('Crafting failed: '+data.roll+' + '+data.modifier+' = '+data.total+' vs DC '+data.dc+'. Materials consumed; no item produced.');
  else if(data.status==='pending')setNotice('Craft started. Materials consumed. Finish after '+data.minutes+' real-world minutes.');
  else setNotice('Craft completed: '+data.roll+' + '+data.modifier+' = '+data.total+' vs DC '+data.dc+'. Materials consumed; item created.');
 });
 const finish=(job:Job)=>void act(async()=>{
  const {data,error:rpcError}=await db.rpc('complete_character_crafting_job',{p_character:character,p_job:job.id});
  if(rpcError)throw rpcError;
  await onChanged();await load();
  setNotice('Crafting completed: '+data.quantity+' × '+job.output_name+' added to inventory.');
 });
 return <section className="mv-crafting-screen">
  <div className="mv-crafting-heading">
   <h3><FlaskConical size={20}/> Crafting</h3>
   <button type="button" disabled={working||busy||loading} onClick={()=>void reload()}><RefreshCw size={15}/> Refresh</button>
  </div>
  <p>Learn recipes from Recipe items, then craft with the category's skill. Crafting consumes ingredients even if the skill check fails. Required tools are never consumed. Real-time jobs become claimable when their timers finish.</p>
  {loading&&<p>Loading recipes, skills and crafting jobs…</p>}
  <section className="mv-crafting-history">
   <h4><BookOpen size={16}/> Recipe Items — Learn New Recipes</h4>
   {!loading&&scrolls.length===0&&<p>No unlearned Recipe items in your inventory. Ask the GM for a Recipe item or acquire one through gameplay.</p>}
   {scrolls.map(item=>{
    const skill=skills.find(s=>s.skill_name===item.skill_name);
    return <div key={item.item_id}>
     <strong>{item.recipe_name} · {item.category_name}</strong>
     <span>{item.skill_name} check DC {item.learn_dc} · Your modifier {skill?.total_modifier??0} · {item.quantity} Recipe item(s)</span>
     <button type="button" disabled={working||busy} onClick={()=>learn(item)}>Study & Learn Recipe</button>
    </div>;
   })}
  </section>
  <section className="mv-crafting-history">
   <h4>Your Crafting Skills</h4>
   {skills.length?skills.map(s=><div key={s.skill_id}>
    <strong>{s.skill_name} ({s.attribute_code})</strong>
    <span>Attribute {s.attribute_modifier>=0?'+':''}{s.attribute_modifier}; skill bonus {s.skill_bonus>=0?'+':''}{s.skill_bonus}; total modifier {s.total_modifier>=0?'+':''}{s.total_modifier}</span>
   </div>):<p>Your GM has not configured crafting skills.</p>}
  </section>
  <h4>Learned Recipes</h4>
  {!loading&&visible.length===0&&<p className="mv-empty">No learned recipes yet. Consume a Recipe item above to learn one.</p>}
  <div className="mv-crafting-recipe-list">{visible.map(r=>{
   const count=Number(counts[r.id]??'1'),eligible=canCraft(r,count);
   return <div className="mv-crafting-recipe-row" key={r.id}>
    <button type="button" className="mv-crafting-recipe-name" aria-haspopup="dialog"
     onClick={event=>{recipeTriggerRef.current=event.currentTarget;setSelectedRecipeId(r.id);setReview(null)}}>{r.name}</button>
    <label className="mv-crafting-row-count">Craft Count
     <input type="number" min="1" max="100" step="1" value={counts[r.id]??'1'}
      onChange={e=>{setCounts(old=>({...old,[r.id]:e.target.value}));setReview(null)}}/>
    </label>
    <button type="button" className="mv-crafting-row-action" disabled={loading||working||busy||!eligible}
     onClick={()=>{setReview({recipe:r,count});setSelectedRecipeId(r.id)}}>Craft</button>
   </div>;
  })}</div>
  {selectedRecipeId&&visible.some(r=>r.id===selectedRecipeId)&&(()=>{
   const r=visible.find(r=>r.id===selectedRecipeId)!;
   const count=Number(counts[r.id]??'1'),setting=settingFor(r.id),skill=skillFor(r.id),eligible=canCraft(r,count);
   return <div className="mv-crafting-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeRecipeDetails()}}>
    <section className="mv-crafting-modal" role="dialog" aria-modal="true" aria-labelledby="mv-crafting-modal-title">
     <header className="mv-crafting-modal-header">
      <h3 id="mv-crafting-modal-title">{r.name}</h3>
      <button type="button" className="mv-crafting-modal-close" aria-label="Close recipe details"
       ref={modalCloseRef} onClick={closeRecipeDetails}><X size={20}/></button>
     </header>
     <div className="mv-crafting-modal-body">
      <p>{setting?.category_name} · {setting?.skill_name} ({setting?.attribute_code})</p>
      {r.description&&<p>{r.description}</p>}
      <p className="mv-crafting-output">Produces {r.output_quantity} × {r.output_name} per craft</p>
      <p>Check DC {setting?.craft_dc} · Your skill modifier {skill?.total_modifier??0}</p>
      <p>{setting?.time_mode==='realtime'?'Real time':'In-game time'}: {(setting?.minutes_per_craft??0)*Math.max(Number.isInteger(count)&&count>0?count:1,1)} minutes</p>
      <div className="mv-crafting-ingredients"><strong>Consumed ingredients (including on failure)</strong>
       {r.ingredients.map(i=><div key={i.definition_id}>
        <span>{i.name} × {i.quantity*Math.max(Number.isInteger(count)&&count>0?count:1,1)}</span>
        <span className={owned(i.definition_id)>=i.quantity*count?'mv-crafting-ok':'mv-crafting-missing'}>Have {owned(i.definition_id)}</span>
       </div>)}
      </div>
      {toolsFor(r.id).length>0&&<div className="mv-crafting-ingredients">
       <strong>Required tools (not consumed)</strong>
       {toolsFor(r.id).map(t=><div key={t.definition_id}>
        <span>{t.name} × {t.quantity}</span>
        <span className={toolCount(t.definition_id)>=t.quantity?'mv-crafting-ok':'mv-crafting-missing'}>Have {toolCount(t.definition_id)}</span>
       </div>)}
      </div>}
      <div className="mv-crafting-modal-actions">
       <label>Craft Count<input type="number" min="1" max="100" step="1" value={counts[r.id]??'1'}
        onChange={e=>{setCounts(old=>({...old,[r.id]:e.target.value}));setReview(null)}}/></label>
       <button type="button" disabled={loading||working||busy||!eligible}
        onClick={()=>setReview({recipe:r,count})}>Craft</button>
      </div>
      {review?.recipe.id===r.id&&<div className="mv-crafting-review" role="group" aria-label="Confirm crafting">
       <strong>Confirm Crafting</strong>
       <p>Spend the ingredients for {review.count} craft(s) of {r.name}? The {setting?.skill_name} check may fail, in which case you lose the ingredients without producing an item. {setting?.time_mode==='realtime'?'Successful crafting will have a real-time completion delay.':''}</p>
       <div><button type="button" disabled={working} onClick={()=>setReview(null)}>Cancel</button>
        <button type="button" disabled={working||busy||!canCraft(r,review.count)} onClick={craft}>Confirm Craft</button></div>
      </div>}
     </div>
    </section>
   </div>;
  })()}
  {error&&<p role="alert" className="mv-storage-error">{error}</p>}
  {notice&&<p role="status" className="mv-crafting-success">{notice}</p>}
  <section className="mv-crafting-history">
   <h4><Clock3 size={16}/> Crafting Jobs & History</h4>
   {jobs.length?jobs.map(job=>{
    const seconds=Math.max(0,Math.ceil((new Date(job.ready_at).getTime()-clock)/1000));
    return <div key={job.id}>
     <strong>{job.recipe_name} · {job.status==='failed'?'Failed':job.status==='completed'?'Completed':'In progress'}</strong>
     <span>Check {job.roll} + {job.modifier} = {job.total} vs DC {job.dc} · {job.output_quantity} × {job.output_name}</span>
     <span>{job.time_mode==='realtime'?'Real time':'In-game time'}: {job.minutes} minutes · {new Date(job.started_at).toLocaleString()}</span>
     {job.status==='pending'&&<button type="button" disabled={working||busy||seconds>0} onClick={()=>finish(job)}>
      {seconds>0?'Ready in '+Math.floor(seconds/60)+'m '+String(seconds%60).padStart(2,'0')+'s':'Complete Craft & Collect'}
     </button>}
    </div>;
   }):<p>No crafting attempts yet.</p>}
  </section>
 </section>;
}
