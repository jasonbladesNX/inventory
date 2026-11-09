import React,{useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Hammer} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './crafting.css';
type Definition={id:string;name:string;category:string};
type Ingredient={definition_id:string;name?:string;quantity:number};
type Recipe={id:string;name:string;description:string;output_definition_id:string;output_name:string;output_quantity:number;active:boolean;ingredients:Ingredient[]};
type RequiredTool={recipe_id:string;definition_id:string;name:string;quantity:number};
type CraftCheck={recipe_id:string;minutes_per_craft:number;check_name:string|null;attribute_code:string|null;difficulty_class:number|null};
type AttributeCode={code:string;label:string};
type Profession={skill_id:string;skill_name:string;attribute_code:string;category_id:string|null;category_name:string|null};
type Progression={recipe_id:string;category_id:string;category_name:string;skill_name:string;learn_dc:number;craft_dc:number;time_mode:string;minutes_per_craft:number;recipe_item_id:string};
type Character={id:string;name:string};
export default function GmCraftingManager({db,campaign,definitions,characters,configVersion}:{db:SupabaseClient;campaign:string;definitions:Definition[];characters:Character[];configVersion:number}){
 const [catalog,setCatalog]=useState<Definition[]>([]);
 const [recipes,setRecipes]=useState<Recipe[]>([]),[recipeTools,setRecipeTools]=useState<RequiredTool[]>([]);
 const [tools,setTools]=useState<{definition_id:string;quantity:string}[]>([]);
 const [checks,setChecks]=useState<CraftCheck[]>([]);
 const [minutes,setMinutes]=useState('0'),[checkName,setCheckName]=useState(''),[attribute,setAttribute]=useState(''),[dc,setDc]=useState('10');
 const [attributes,setAttributes]=useState<AttributeCode[]>([]);
 const [professions,setProfessions]=useState<Profession[]>([]),[progressions,setProgressions]=useState<Progression[]>([]);
 const [category,setCategory]=useState(''),[learnDc,setLearnDc]=useState('10'),[craftDc,setCraftDc]=useState('10'),[timeMode,setTimeMode]=useState('game');
 const [recipient,setRecipient]=useState('');
 const [recipe,setRecipe]=useState(''),[name,setName]=useState(''),[description,setDescription]=useState('');
 const [output,setOutput]=useState(''),[outputQty,setOutputQty]=useState('1'),[ingredients,setIngredients]=useState<{definition_id:string;quantity:string}[]>([{definition_id:'',quantity:'1'}]);
 const [active,setActive]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  const [a,b,c,d,e,g]=await Promise.all([
   db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),
   db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),
   db.rpc('list_campaign_crafting_tools',{p_campaign:campaign}),
   db.rpc('list_campaign_crafting_checks',{p_campaign:campaign}),
   db.rpc('list_crafting_professions',{p_campaign:campaign}),
   db.rpc('list_crafting_recipe_progression',{p_campaign:campaign})
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;if(e.error)throw e.error;if(g.error)throw g.error;
  setRecipes(a.data||[]);setCatalog(b.data||[]);setRecipeTools(c.data||[]);setChecks(d.data||[]);setProfessions(e.data||[]);setProgressions(g.data||[]);
 };
 useEffect(()=>{let cancelled=false;setRecipes([]);setCatalog([]);setRecipeTools([]);setChecks([]);setRecipe('');setTools([]);setProfessions([]);setProgressions([]);setError('');
  void Promise.all([
   db.rpc('list_campaign_crafting_recipes',{p_campaign:campaign}),
   db.rpc('list_campaign_shop_item_definitions',{p_campaign:campaign}),
   db.rpc('list_campaign_crafting_tools',{p_campaign:campaign}),
   db.rpc('list_campaign_crafting_checks',{p_campaign:campaign}),
   db.rpc('list_campaign_crafting_attributes',{p_campaign:campaign}),
   db.rpc('list_crafting_professions',{p_campaign:campaign}),
   db.rpc('list_crafting_recipe_progression',{p_campaign:campaign})
  ])
  .then(([a,b,c,d,e,g,h])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;if(e.error)throw e.error;if(g.error)throw g.error;if(h.error)throw h.error;if(!cancelled){setRecipes(a.data||[]);setCatalog(b.data||[]);setRecipeTools(c.data||[]);setChecks(d.data||[]);setAttributes(e.data||[]);setProfessions(g.data||[]);setProgressions(h.data||[])}})
  .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});
  return()=>{cancelled=true};
 },[db,campaign,definitions.length,configVersion]);
 const choose=(id:string)=>{
  setRecipe(id);setError('');setNotice('');
  const r=recipes.find(r=>r.id===id);
  if(!r){setName('');setDescription('');setOutput('');setOutputQty('1');setIngredients([{definition_id:'',quantity:'1'}]);setTools([]);setMinutes('0');setCheckName('');setAttribute('');setDc('10');setCategory('');setLearnDc('10');setCraftDc('10');setTimeMode('game');setActive(true);return}
  setName(r.name);setDescription(r.description);setOutput(r.output_definition_id);setOutputQty(String(r.output_quantity));
  setIngredients(r.ingredients.map(i=>({definition_id:i.definition_id,quantity:String(i.quantity)})));
  setTools(recipeTools.filter(t=>t.recipe_id===id).map(t=>({definition_id:t.definition_id,quantity:String(t.quantity)})));
  const check=checks.find(c=>c.recipe_id===id);setMinutes(String(check?.minutes_per_craft??0));setCheckName(check?.check_name??'');setAttribute(check?.attribute_code??'');setDc(String(check?.difficulty_class??10));
  const progression=progressions.find(p=>p.recipe_id===id);
  setCategory(progression?.category_id??'');setLearnDc(String(progression?.learn_dc??10));setCraftDc(String(progression?.craft_dc??10));setTimeMode(progression?.time_mode??'game');
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
   const duration=Number(minutes);
   if(!Number.isInteger(duration)||duration<0||duration>10080)throw Error('Crafting time must be 0–10080 whole minutes per craft.');
   if(attribute&&(!checkName.trim()||!Number.isInteger(Number(dc))||Number(dc)<1||Number(dc)>40))throw Error('Set a check name and difficulty class (1–40).');
   if(!attribute&&checkName.trim())throw Error('Choose an attribute for the named check.');
   const learnThreshold=Number(learnDc),craftThreshold=Number(craftDc);
   if(!category||!Number.isInteger(learnThreshold)||!Number.isInteger(craftThreshold)||
      learnThreshold<1||learnThreshold>40||craftThreshold<1||craftThreshold>40)throw Error('Choose a recipe category and set learning and crafting DCs from 1–40.');
   const {data,error:rpcError}=await db.rpc('save_campaign_crafting_recipe',{
    p_campaign:campaign,p_name:name.trim(),p_output:output,p_output_quantity:Number(outputQty),
    p_ingredients:mapped,p_description:description.trim(),p_recipe:recipe||null,p_active:active
   });
   if(rpcError)throw rpcError;
   const {error:toolsError}=await db.rpc('set_campaign_crafting_tools',{p_recipe:data,p_tools:required});
   if(toolsError)throw toolsError;
   const {error:progressionError}=await db.rpc('configure_crafting_recipe_learning',{
     p_recipe:data,p_category:category,p_learn_dc:learnThreshold,p_craft_dc:craftThreshold,
     p_time_mode:timeMode,p_minutes:duration
   });
   if(progressionError)throw progressionError;
   await load();setRecipe(String(data));setNotice('Recipe saved. Grant or distribute its Recipe item so players can learn it.');
  }catch(ex){setError(inventoryErrorMessage(ex))}finally{setBusy(false)}
 };
 return <section className="nx-page-card nx-gm-tools" aria-label="Campaign Crafting Recipes">
  <h2><Hammer size={20}/> Campaign Crafting Recipes</h2>
  <p>Every recipe belongs to a category linked to a GM-defined skill. Players must acquire and successfully study a Recipe item before crafting. Materials are consumed even on a failed crafting check; tools are retained. Crafting time can be in-game or real-time.</p>
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
   <h4>Category, Learning & Crafting Rules</h4>
   <label>Recipe category<select required value={category} onChange={e=>setCategory(e.target.value)}>
    <option value="">Select category…</option>{professions.filter(p=>p.category_id).map(p=><option key={p.category_id!} value={p.category_id!}>{p.category_name} · {p.skill_name}</option>)}
   </select></label>
   <label>Minimum learning check DC<input required type="number" min="1" max="40" step="1" value={learnDc} onChange={e=>setLearnDc(e.target.value)}/></label>
   <label>Crafting check DC<input required type="number" min="1" max="40" step="1" value={craftDc} onChange={e=>setCraftDc(e.target.value)}/></label>
   <label>Time mode<select value={timeMode} onChange={e=>setTimeMode(e.target.value)}>
    <option value="game">In-game time (immediate item result)</option>
    <option value="realtime">Real time (complete after duration)</option>
   </select></label>
   <label>Minutes per craft<input required type="number" min="0" max="10080" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
   <p>Learning and crafting checks use 1d20 + the category skill's attribute modifier + the character's skill bonus. Failed learning leaves the Recipe item intact. Failed crafting consumes the ingredients.</p>
   <label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Recipe active (players must learn it using a Recipe item)</label>
   <button type="submit" disabled={busy||!name.trim()||!output||!category||ingredients.some(i=>!i.definition_id)||tools.some(t=>!t.definition_id)}>Save Recipe</button>
  </form>
  {recipe&&progressions.find(p=>p.recipe_id===recipe)&&<div className="nx-tool-form">
    <h4>Distribute Recipe Item</h4>
    <p>Giving a character this item does not automatically teach the recipe. They must study and consume it in their Craft tab.</p>
    <label>Recipient character<select value={recipient} onChange={e=>setRecipient(e.target.value)}>
     <option value="">Select recipient…</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    <button type="button" disabled={busy||!recipient} onClick={()=>{void (async()=>{
     setBusy(true);setError('');setNotice('');
     try{
      const item=progressions.find(p=>p.recipe_id===recipe);
      if(!item)throw Error('Save recipe first.');
      const {error:rpcError}=await db.rpc('add_inventory_item',{p_campaign:campaign,p_character:recipient,p_definition:item.recipe_item_id,p_quantity:1});
      if(rpcError)throw rpcError;setNotice('Recipe item granted. The player can study it in the Craft tab.');
     }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
    })()}}>Grant Recipe Item</button>
   </div>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="nx-character-list-error">{error}</p>}
 </section>;
}
