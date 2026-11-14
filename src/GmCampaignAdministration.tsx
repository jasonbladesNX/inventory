import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
type Member={member_id:string;user_id:string;display_name:string;role:string;status:string;character_count:number;active_character_count:number};
type Character={id:string;name:string;member_id:string;is_active:boolean};
type Audit={event_type:string;created_at:string;reason:string};
type Data={members:Member[];characters:Character[];audit:Audit[]};
export default function GmCampaignAdministration({db,campaign}:{db:SupabaseClient;campaign:string}){
 const [data,setData]=useState<Data>({members:[],characters:[],audit:[]});
 const [inviteId,setInviteId]=useState('');
 const [target,setTarget]=useState('');
 const [char,setChar]=useState('');
 const [reason,setReason]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{const {data,error:e}=await db.rpc('list_campaign_administration',{p_campaign:campaign});if(e)throw e;setData(data as Data)},[db,campaign]);
 useEffect(()=>{void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 async function run(action:string,member?:string,character?:string,user?:string){
  if(busy)return;
  const destructive=['remove','reassign_character','promote','demote'];
  if(destructive.includes(action)&&!window.confirm('Confirm '+action.replaceAll('_',' ')+'?'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('manage_campaign_administration',{
    p_campaign:campaign,p_action:action,p_user:user??null,p_member:member??null,
    p_character:character??null,p_role:null,p_reason:reason
   });
   if(e)throw e;
   setNotice('Campaign administration updated.');setReason('');setInviteId('');await refresh();
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 return <section className="nx-admin" style={{display:'grid',gap:14}}>
  <p>Invite registered Nexus accounts by their user ID, manage campaign membership, and review the administrative audit history.</p>
  <form onSubmit={e=>{e.preventDefault();void run('invite',undefined,undefined,inviteId)}} style={{display:'grid',gap:8}}>
   <label>Existing account user ID<input required value={inviteId} onChange={e=>setInviteId(e.target.value)} placeholder="Registered account UUID"/></label>
   <button disabled={busy||!inviteId.trim()} type="submit">Invite Player</button>
  </form>
  <label>Administrative reason (optional)<input maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <h3>Campaign Members</h3>
  <div style={{display:'grid',gap:8}}>
   {data.members.length===0?<p>No members yet.</p>:data.members.map(m=><article key={m.member_id} style={{border:'1px solid #39768c',borderRadius:9,padding:10,display:'grid',gap:7}}>
    <strong>{m.display_name}</strong><small>{m.role} · {m.status} · {m.active_character_count} active characters</small>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     {m.status==='active'&&m.role==='player'&&<button type="button" disabled={busy} onClick={()=>void run('promote',m.member_id)}>Promote GM</button>}
     {m.status==='active'&&m.role==='gm'&&<button type="button" disabled={busy} onClick={()=>void run('demote',m.member_id)}>Demote GM</button>}
     {m.status!=='removed'&&<button type="button" disabled={busy} onClick={()=>void run('remove',m.member_id)}>Remove Member</button>}
     {m.status==='removed'&&<button type="button" disabled={busy} onClick={()=>void run('reinstate',m.member_id)}>Reinstate</button>}
    </div>
   </article>)}
  </div>
  <h3>Reassign Character (same campaign)</h3>
  <div style={{display:'grid',gap:8}}>
   <label>Character<select value={char} onChange={e=>setChar(e.target.value)}>
    <option value="">Choose character</option>{data.characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>Destination player<select value={target} onChange={e=>setTarget(e.target.value)}>
    <option value="">Choose active member</option>{data.members.filter(m=>m.status==='active').map(m=><option key={m.member_id} value={m.member_id}>{m.display_name}</option>)}</select></label>
   <button type="button" disabled={busy||!char||!target} onClick={()=>void run('reassign_character',target,char)}>Reassign Character</button>
  </div>
  <details><summary>Administration History</summary>
   {data.audit.length===0?<p>No administrative actions recorded.</p>:<ul>{data.audit.map((a,i)=><li key={i}>{a.event_type} · {new Date(a.created_at).toLocaleString()}{a.reason?' — '+a.reason:''}</li>)}</ul>}
  </details>
  <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh Administration</button>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
