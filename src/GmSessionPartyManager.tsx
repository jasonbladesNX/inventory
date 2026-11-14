import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Lock,Play,Square,Users} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
type Character={id:string;name:string};
type Party={id:string;name:string;join_policy:'open'|'approval';bank_withdrawal_policy:'direct'|'approval';members:{character_id:string;name:string}[]};
export default function GmSessionPartyManager({db,campaign,characters}:{db:SupabaseClient;campaign:string;characters:Character[]}){
 const [running,setRunning]=useState(false),[parties,setParties]=useState<Party[]>([]);
 const [name,setName]=useState(''),[chosen,setChosen]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const [sessions,partyList]=await Promise.all([
    db.rpc('get_campaign_session_state',{p_campaign:campaign}),
    db.rpc('list_campaign_parties',{p_campaign:campaign})
  ]);
  if(sessions.error)throw sessions.error;if(partyList.error)throw partyList.error;
  setRunning(Boolean(sessions.data?.is_running));setParties((partyList.data??[]) as Party[]);
 },[db,campaign]);
 useEffect(()=>{void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 async function action(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');
  try{await fn();await refresh();setNotice('Campaign updated.')}catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 return <section className="nx-session-party" style={{display:'grid',gap:14}}>
  <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
   <strong>{running?<><Lock size={16} style={{display:'inline'}}/> Game in progress</>:'Between sessions — banks available'}</strong>
   <button type="button" disabled={busy} onClick={()=>{if(!window.confirm(running?'End the game session and unlock banks?':'Start the game and lock all personal/party banks?'))return;
    void action(async()=>{const {error:e}=await db.rpc('manage_campaign_session',{p_campaign:campaign,p_running:!running});if(e)throw e})}}>
    {running?<><Square size={15}/> End Game</>:<><Play size={15}/> Start Game</>}
   </button>
  </div>
  <p>When the GM starts the game, deposits and withdrawals are blocked at the database layer. Characters can carry only items withdrawn before play.</p>
  <form onSubmit={e=>{e.preventDefault();void action(async()=>{const {error:e}=await db.rpc('manage_campaign_party',{p_campaign:campaign,p_action:'create',p_party:null,p_name:name,p_character:null});if(e)throw e;setName('')})}}
   style={{display:'grid',gap:7}}>
   <label>New party name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="The Adventurers"/></label>
   <button disabled={busy||!name.trim()} type="submit"><Users size={16}/> Create Party & Shared Bank</button>
  </form>
  <div style={{display:'grid',gap:8}}>{parties.length===0?<p>No parties created yet.</p>:
   parties.map(party=><article key={party.id} style={{border:'1px solid #387990',borderRadius:9,padding:12,display:'grid',gap:8}}>
    <strong>{party.name}</strong>
    <label>Player join policy
     <select value={party.join_policy??'open'} disabled={busy||running}
      onChange={e=>void action(async()=>{
       const {error:x}=await db.rpc('set_party_join_policy',{p_party:party.id,p_policy:e.target.value});
       if(x)throw x;
      })}>
      <option value="open">Open — players join immediately</option>
      <option value="approval">Approval required — organizer/GM reviews requests</option>
     </select>
    </label>
    <label>Party bank withdrawal policy
     <select value={party.bank_withdrawal_policy??'direct'} disabled={busy||running}
      onChange={e=>void action(async()=>{
       const {error:x}=await db.rpc('set_party_bank_withdrawal_policy',{p_party:party.id,p_policy:e.target.value});
       if(x)throw x;
      })}>
      <option value="direct">Direct — members may withdraw between sessions</option>
      <option value="approval">Approval required — items need leader/GM approval</option>
     </select>
    </label>
    <small>Approval required blocks direct item and currency withdrawals. Players can request either through My Party; the party leader or GM can approve transfers.</small>
    <small>Party bank is shared with these characters:</small>
    {party.members.length===0?<p>No members yet.</p>:<div style={{display:'grid',gap:6}}>
     {party.members.map(m=><div key={m.character_id} style={{display:'flex',justifyContent:'space-between',gap:10}}>
      <span>{m.name}</span><button type="button" disabled={busy} onClick={()=>void action(async()=>{
       const {error:e}=await db.rpc('manage_campaign_party',{p_campaign:campaign,p_action:'remove_member',
        p_party:party.id,p_name:null,p_character:m.character_id});if(e)throw e
      })}>Remove</button>
     </div>)}</div>}
    <div style={{display:'grid',gap:6}}>
     <label>Add character<select value={chosen[party.id]??''} onChange={e=>setChosen(s=>({...s,[party.id]:e.target.value}))}>
      <option value="">Choose character…</option>
      {characters.filter(c=>!party.members.some(m=>m.character_id===c.id)).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
     <button type="button" disabled={busy||!chosen[party.id]} onClick={()=>void action(async()=>{
      const {error:e}=await db.rpc('manage_campaign_party',{p_campaign:campaign,p_action:'add_member',
       p_party:party.id,p_name:null,p_character:chosen[party.id]});if(e)throw e;
      setChosen(v=>({...v,[party.id]:''}))
     })}>Add to Party</button>
    </div>
   </article>)}</div>
  <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh Session & Parties</button>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
