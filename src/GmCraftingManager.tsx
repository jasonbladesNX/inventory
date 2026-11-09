import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Hammer} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './crafting.css';
type Definition={id:string;name:string;category:string};
type Ingredient={definition_id:string;name?:string;quantity:number};
type Recipe={id:string;name:string;description:string;output_definition_id:string;output_name:string;output_quantity:number;active:boolean;ingredients:Ingredient[]};
type RequiredTool={recipe_id:string;definition_id:string;name:string;quantity:number};
export default function GmCraftingManager({db,campaign,definitions}:{db:SupabaseClient;campaign:string;definitions:Definition[]}){
 const [catalog,setCatalog]=useState<Definition[]>([]);
 const [recipes,setRecipes]=useState<Recipe[]>([]),[recipeTools,setRecipeTools]=useState<RequiredTool[]>([]);
 const [tools,setTools]=useState<{definition_id:string;quantity:string}[]>([]);
 const [recipe,setRecipe]=useState(''),[name,setName]=useState(''),[description,setDescription]=useState('');
 const [output,setOutput]=useState(''),[outputQty,setOutputQty]=useState('1'),[ingredients,setIngredients]=useState<{definition_id:string;quantity:string}[]>([{definition_id:'',quantity:'1'}]);
 const [active,setActive]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  const [a,b,c]=await Promise.all([db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),db.rpc('list_campaign_crafting_tools',{p_campaign:campaign})]);
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;
  setRecipes(a.data||[]);setCatalog(b.data||[]);setRecipeTools(c.data||[]);
 };
 useEffect(()=>{let cancelled=false;setRecipes([]);setCatalog([]);setRecipeTools([]);setRecipe('');setTools([]);setError('');
  void Promise.all([db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),db.rpc('list_campaign_crafting_tools',{p_campaign:campaign})])
  .then(([a,b,c])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(!cancelled){setRecipes(a.data||[]);setCatalog(b.data||[]);setRecipeTools(c.data||[])}})
  .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,campaign,definitions.length]);
 const choose=(id:string)=>{
  setRecipe(id);setError('');setNotice('');
  const r=recipes.find(r=>r.id===id);
  if(!r){setName('');setDescription('');setOutput('');setOutputQty('1');setIngredients([{definition_id:'',quantity:'1'}]);setTools([]);setActive(true);return}
  setName(r.name);setDescription(r.description);setOutput(r.output_definition_id);setOutputQty(String(r.output_quantity));
  setIngredients(r.ingredients.map(i=>({definition_id:i.definition_id,quantity:String(i.quantity)})));
  setTools(recipeTools.filter(t=>t.recipe_id===id).map(t=>({definition_id:t.definition_id,quantity:String(t.quantity)})));
  setActive(r.active);
 };
 const updateIngredient=(index:number,patch:Partial<{definition_id:string;quantity:string}>)=>setIngredients(rows=>rows.map((r,i)=>i===index?{...r,...patch}:r));
 const updateTool=(index:number,patch:Partial<{definition_id:string;quantity:string}>)=>setTools(rows=>rows.map((r,i)=>i===index?{...r,...patch}:r));
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   const mapped=ingredients.map(i=>({definition_id:i.definition_id,quantity:Number(i.quantity)}));
   if(!mapped.length||mapped.some(i=>!i.definition_id||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>100000))throw Error('Each ingredient needs a valid item and positive whole quantity.');
   if(new Set(mapped.map(i=>i.definition_id)).size!==mapped.length)throw Error('An ingredient may appear only once. Adjust its quantity instead.');
   const required=tools.map(t=>({definition_id:t.definition_id,quantity:Number(t.quantity)}));
   if(required.some(t=>!t.definition_id||!Number.isInteger(t.quantity)||t.quantity<1||t.quantity>500))throw Error('Each required tool needs a catalog item and valid quantity.');
   if(new Set(required.map(t=>t.definition_id)).size!==required.length)throw Error('Do not list a required tool twice.');
   if(required.some(t=>mapped.some(i=>i.definition_id===t.definition_id)))throw Error('A required tool cannot also be a consumed ingredient.');
   const {data,error:rpcError}=await db.rpc('save_campaign_crafting_recipe',{
    p_campaign:campaign,p_name:name.trim(),p_output:output,p_output_quantity:Number(outputQty),
    p_ingredients:mapped,p_description:description.trim(),p_recipe:recipe||null,p_active:active
   });
   if(rpcError)throw rpcError;
   const {error:toolsError}=await db.rpc('set_campaign_crafting_tools',{p_recipe:data,p_tools:required});
   if(toolsError)throw toolsError;
   await load();setRecipe(String(data));setNotice('Recipe and required tools saved. Tools are not consumed by crafting.');
  }catch(ex){setError(inventoryErrorMessage(ex))}finally{setBusy(false)}
 };
 return <section className="nx-page-card nx-gm-tools" aria-label="Campaign Crafting Recipes">
  <h2><Hammer size={20}/> Campaign Crafting Recipes</h2>
  <p>Create recipes from campaign or ruleset items. Ingredients are consumed; optional required tools must be owned but are never consumed. Skill checks and crafting times are not yet enabled.</p>
  <label>Edit recipe<select value={recipe} disabled={busy} onChange={e=>choose(e.target.value)}>
   <option value="">Create new recipe…</option>{recipes.map(r=><option value={r.id} key={r.id}>{r.name}{r.active?'':' (inactive)'}</option>)}
  </select></label>
  <form className="nx-tool-form nx-crafting-editor" onSubmit={e=>void save(e)}>
   <h3>{recipe?'Edit Recipe':'New Recipe'}</h3>
   <label>Recipe name<input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
   <label>Description<input maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   <label>Crafted item<select required value={output} onChange={e=>setOutput(e.target.value)}>
    <option value="">Choose output item…</option>{catalog.map(d=><option value={d.id} key={d.id}>{d.name} ({d.category})</option>)}
   </select></label>
   <label>Output quantity per craft<input type="number" min="1" max="500" step="1" required value={outputQty} onChange={e=>setOutputQty(e.target.value)}/></label>
   <h4>Ingredients per craft</h4>
   {ingredients.map((ing,i)=><div className="nx-crafting-ingredient-editor" key={i}>
    <label>Material<select required value={ing.definition_id} onChange={e=>updateIngredient(i,{definition_id:e.target.value})}>
     <option value="">Choose ingredient…</option>{catalog.map(d=><option value={d.id} key={d.id}>{d.name} ({d.category})</option>)}
    </select></label>
    <label>Quantity<input required type="number" min="1" max="100000" step="1" value={ing.quantity} onChange={e=>updateIngredient(i,{quantity:e.target.value})}/></label>
    <button type="button" disabled={busy||ingredients.length===1} onClick={()=>setIngredients(rows=>rows.filter((_,j)=>i!==j))}>Remove</button>
   </div>)}
   <button type="button" disabled={busy||ingredients.length>=20} onClick={()=>setIngredients(v=>[...v,{definition_id:'',quantity:'1'}])}>Add Ingredient</button>
   <h4>Required Tools (optional, not consumed)</h4>
   {tools.map((tool,i)=><div className="nx-crafting-ingredient-editor" key={i}>
    <label>Tool<select required value={tool.definition_id} onChange={e=>updateTool(i,{definition_id:e.target.value})}>
     <option value="">Choose tool…</option>{catalog.map(d=><option key={d.id} value={d.id}>{d.name} ({d.category})</option>)}
    </select></label>
    <label>Quantity<input required type="number" min="1" max="500" step="1" value={tool.quantity} onChange={e=>updateTool(i,{quantity:e.target.value})}/></label>
    <button type="button" disabled={busy} onClick={()=>setTools(rows=>rows.filter((_,j)=>i!==j))}>Remove</button>
   </div>)}
   <button type="button" disabled={busy||tools.length>=20} onClick={()=>setTools(rows=>[...rows,{definition_id:'',quantity:'1'}])}>Add Required Tool</button>
   <label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Recipe available to players</label>
   <button type="submit" disabled={busy||!name.trim()||!output||ingredients.some(i=>!i.definition_id)||tools.some(t=>!t.definition_id)}>Save Recipe</button>
  </form>
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="nx-character-list-error">{error}</p>}
 </section>;
}
