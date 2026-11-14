import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Users,Plus,LogIn,LogOut,RefreshCw,Lock} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './player-party.css';

type PartyMember={character_id:string;name:string};
type Party={id:string;name:string;member_count:number;members:PartyMember[]};
type PartyState={campaign_id:string;is_running:boolean;current_party_id:string|null;parties:Party[]};

export default function PlayerPartyManager({db,character,campaign,onPartyChanged}:{
 db:SupabaseClient;character:string;campaign:string;onPartyChanged?:()=>Promise<void>;
}){
 const [state,setState]=useState<PartyState>({campaign_id:campaign,is_running:false,current_party_id:null,parties:[]});
 const [name,setName]=useState('');
 const [choice,setChoice]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');

 const refresh=useCallback(async()=>{
  const {data,error:e}=await db.rpc('list_player_party_options',{p_character:character});
  if(e)throw e;
  const next=data as PartyState;
  setState(next);
  setChoice(previous=>next.parties.some(p=>p.id===previous)?previous:'');
 },[db,character]);

 useEffect(()=>{
  let active=true;
  setLoading(true);setError('');setNotice('');
  void refresh().catch(e=>{if(active)setError(inventoryErrorMessage(e))})
   .finally(()=>{if(active)setLoading(false)});
  const interval=window.setInterval(()=>{if(active)void refresh().catch(()=>{})},20000);
  return()=>{active=false;window.clearInterval(interval)};
 },[refresh]);

 async function action(type:'create'|'join'|'leave',party?:string){
  if(busy||state.is_running)return;
  if(type==='leave'&&!window.confirm('Leave your party? You will lose access to its shared bank, but all party bank contents will remain stored.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('manage_player_party',{
    p_character:character,p_action:type,p_party:party??null,p_name:type==='create'?name.trim():null
   });
   if(e)throw e;
   await refresh();
   if(type==='create')setName('');
   if(type==='join')setChoice('');
   await onPartyChanged?.();
   setNotice(type==='create'?'Party created. You are its first member.':
    type==='join'?'You joined the party. Its shared bank is now available between sessions.':
    'You left the party. Its shared bank and items were preserved.');
  }catch(e){setError(inventoryErrorMessage(e));void refresh().catch(()=>{})}
  finally{setBusy(false)}
 }

 const ownParty=state.parties.find(p=>p.id===state.current_party_id);
 return <section className="mv-panel nx-player-parties" aria-label="Player party management">
  <div className="nx-player-parties-head">
   <div><h3><Users size={20}/> My Party</h3>
    <p>Create a party, join another party in this campaign, or leave your current party.</p></div>
   <button type="button" className="nx-party-refresh" disabled={busy||loading}
    aria-label="Refresh parties" onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>
    <RefreshCw size={17}/>
   </button>
  </div>
  {state.is_running&&<p className="nx-party-lock" role="status"><Lock size={17}/> Game in progress — party changes are locked until the GM ends the session.</p>}
  {loading?<p role="status">Loading parties…</p>:
   ownParty?<div className="nx-party-current">
    <div className="nx-party-current-header"><strong>{ownParty.name}</strong><span>{ownParty.member_count} members</span></div>
    <div className="nx-party-members">{ownParty.members.map(m=>
     <span key={m.character_id} className={m.character_id===character?'nx-party-self':''}>
      {m.name}{m.character_id===character?' (you)':''}
     </span>)}</div>
    <p className="nx-party-help">Your party bank appears in Inventory → Home & Party Banks. Party storage is available only between games.</p>
    <button type="button" className="nx-party-leave" disabled={busy||state.is_running}
     onClick={()=>void action('leave',ownParty.id)}><LogOut size={16}/> Leave Party</button>
   </div>:
   <div className="nx-party-actions">
    <form onSubmit={e=>{e.preventDefault();if(name.trim())void action('create')}} className="nx-party-action">
     <h4>Create a Party</h4>
     <p>Start a new party and automatically create a shared party bank.</p>
     <label>Party name<input required maxLength={100} placeholder="The Silver Compass"
      value={name} disabled={busy||state.is_running} onChange={e=>setName(e.target.value)}/></label>
     <button type="submit" disabled={busy||state.is_running||!name.trim()}><Plus size={16}/> Create Party</button>
    </form>
    <form onSubmit={e=>{e.preventDefault();if(choice)void action('join',choice)}} className="nx-party-action">
     <h4>Join a Party</h4>
     <p>Choose an existing party in this campaign. Only one party may be active per character.</p>
     <label>Available parties<select value={choice} disabled={busy||state.is_running||state.parties.length===0}
      onChange={e=>setChoice(e.target.value)}>
      <option value="">Choose a party…</option>
      {state.parties.map(p=><option key={p.id} value={p.id}>{p.name} ({p.member_count} members)</option>)}
     </select></label>
     <button type="submit" disabled={busy||state.is_running||!choice}><LogIn size={16}/> Join Party</button>
    </form>
   </div>}
  {notice&&<p className="nx-party-success" role="status">{notice}</p>}
  {error&&<p className="nx-party-error" role="alert">{error}</p>}
 </section>
}
