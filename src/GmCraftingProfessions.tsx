import React,{useEffect,useMemo,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BookMarked} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
type Profession={skill_id:string;skill_name:string;attribute_code:string;category_id:string|null;category_name:string|null};
type Attr={code:string;label:string};
type Character={id:string;name:string};
type SkillLevel={skill_id:string;skill_name:string;attribute_modifier:number;skill_bonus:number;total_modifier:number};
export default function GmCraftingProfessions({db,campaign,characters,onChanged}:{db:SupabaseClient;campaign:string;characters:Character[];onChanged:()=>void}){
 const [rows,setRows]=useState<Profession[]>([]),[attrs,setAttrs]=useState<Attr[]>([]),[levels,setLevels]=useState<SkillLevel[]>([]);
 const [skillName,setSkillName]=useState(''),[attribute,setAttribute]=useState(''),[categoryName,setCategoryName]=useState(''),[categorySkill,setCategorySkill]=useState('');
 const [character,setCharacter]=useState(''),[bonusSkill,setBonusSkill]=useState(''),[bonus,setBonus]=useState('0');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const skills=useMemo(()=>Array.from(new Map(rows.map(r=>[r.skill_id,r])).values()),[rows]);
 const refresh=async()=>{
  const [a,b]=await Promise.all([db.rpc('list_crafting_professions',{p_campaign:campaign}),db.rpc('list_campaign_crafting_attributes',{p_campaign:campaign})]);
  if(a.error)throw a.error;if(b.error)throw b.error;
  setRows(a.data||[]);setAttrs(b.data||[]);onChanged();
 };
 useEffect(()=>{let cancelled=false;setRows([]);setAttrs([]);setCharacter('');setLevels([]);
  void Promise.all([db.rpc('list_crafting_professions',{p_campaign:campaign}),db.rpc('list_campaign_crafting_attributes',{p_campaign:campaign})])
  .then(([a,b])=>{if(a.error)throw a.error;if(b.error)throw b.error;if(!cancelled){setRows(a.data||[]);setAttrs(b.data||[])}})
  .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});return()=>{cancelled=true};
 },[db,campaign]);
 useEffect(()=>{let cancelled=false;setLevels([]);if(!character)return;
  void Promise.resolve(db.rpc('list_character_crafting_skills',{p_character:character}))
  .then(({data,error:rpcError})=>{if(rpcError)throw rpcError;if(!cancelled)setLevels(data||[])})
  .catch(e=>{if(!cancelled)setError(inventoryErrorMessage(e))});return()=>{cancelled=true};
 },[db,character,rows]);
 const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');
  try{await action()}catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 };
 return <section className="nx-crafting-professions">
  <h3><BookMarked size={18}/> Crafting Skills & Categories</h3>
  <p>Each category belongs to a GM-created skill. Checks roll 1d20 plus the skill's governing attribute modifier and a GM-set skill bonus.</p>
  <div className="nx-crafting-recipes">{skills.map(s=><div key={s.skill_id}>
   <strong>{s.skill_name}</strong> ({s.attribute_code}) · {rows.filter(r=>r.skill_id===s.skill_id&&r.category_id).map(r=>r.category_name).join(', ')||'No categories'}
  </div>)}</div>
  <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
   const {error:rpcError}=await db.rpc('save_crafting_skill',{p_campaign:campaign,p_name:skillName.trim(),p_attribute:attribute,p_skill:null});
   if(rpcError)throw rpcError;setSkillName('');await refresh();setNotice('Crafting skill created.');
  })}}>
   <h4>Create Skill</h4>
   <label>Skill name<input required minLength={2} maxLength={80} placeholder="Alchemy" value={skillName} onChange={e=>setSkillName(e.target.value)}/></label>
   <label>Governing attribute<select required value={attribute} onChange={e=>setAttribute(e.target.value)}>
    <option value="">Select attribute…</option>{attrs.map(a=><option key={a.code} value={a.code}>{a.label} ({a.code})</option>)}
   </select></label>
   <button type="submit" disabled={busy||!skillName.trim()||!attribute}>Add Crafting Skill</button>
  </form>
  <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
   const {error:rpcError}=await db.rpc('save_crafting_category',{p_campaign:campaign,p_name:categoryName.trim(),p_skill:categorySkill,p_category:null});
   if(rpcError)throw rpcError;setCategoryName('');await refresh();setNotice('Crafting category created.');
  })}}>
   <h4>Create Recipe Category</h4>
   <label>Category name<input required minLength={2} maxLength={80} placeholder="Potions" value={categoryName} onChange={e=>setCategoryName(e.target.value)}/></label>
   <label>Associated skill<select required value={categorySkill} onChange={e=>setCategorySkill(e.target.value)}>
    <option value="">Select skill…</option>{skills.map(s=><option key={s.skill_id} value={s.skill_id}>{s.skill_name}</option>)}
   </select></label>
   <button type="submit" disabled={busy||!categoryName.trim()||!categorySkill}>Add Category</button>
  </form>
  <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
   const val=Number(bonus);if(!Number.isInteger(val)||val< -30||val>30)throw Error('Skill bonus must be -30 to 30.');
   const {error:rpcError}=await db.rpc('set_character_crafting_skill_bonus',{p_character:character,p_skill:bonusSkill,p_bonus:val});
   if(rpcError)throw rpcError;
   const {data,error:readErr}=await db.rpc('list_character_crafting_skills',{p_character:character});
   if(readErr)throw readErr;setLevels(data||[]);setNotice('Character crafting skill bonus updated.');
  })}}>
   <h4>Character Skill Bonus</h4>
   <label>Character<select required value={character} onChange={e=>{setCharacter(e.target.value);setBonusSkill('')}}>
    <option value="">Select character…</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
   </select></label>
   <label>Crafting skill<select required value={bonusSkill} onChange={e=>{setBonusSkill(e.target.value);setBonus(String(levels.find(v=>v.skill_id===e.target.value)?.skill_bonus??0))}}>
    <option value="">Select skill…</option>{skills.map(s=><option key={s.skill_id} value={s.skill_id}>{s.skill_name}</option>)}
   </select></label>
   {bonusSkill&&<p>{levels.find(v=>v.skill_id===bonusSkill)?.attribute_modifier??0} attribute modifier + {levels.find(v=>v.skill_id===bonusSkill)?.skill_bonus??0} skill bonus</p>}
   <label>Additional skill bonus<input type="number" required min="-30" max="30" step="1" value={bonus} onChange={e=>setBonus(e.target.value)}/></label>
   <button type="submit" disabled={busy||!character||!bonusSkill}>Save Skill Bonus</button>
  </form>
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
