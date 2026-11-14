import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Users,Plus,LogIn,LogOut,RefreshCw,Lock,Settings} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './player-party.css';

type PartyMember={character_id:string;name:string;is_leader?:boolean};
type Party={id:string;name:string;join_policy:'open'|'approval';is_organizer:boolean;leader_character_id:string|null;member_count:number;members:PartyMember[]};
type PartyRequest={id:string;party_id:string;party_name:string;character_id:string;character_name:string;request_type:'join'|'invite';can_respond:boolean;can_cancel:boolean};
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
 const [requests,setRequests]=useState<PartyRequest[]>([]);
 const [candidates,setCandidates]=useState<{id:string;name:string}[]>([]);
 const [inviteCharacter,setInviteCharacter]=useState('');
 const [configOpen,setConfigOpen]=useState(false);
 const [partyDraft,setPartyDraft]=useState('');
 const [policyDraft,setPolicyDraft]=useState<'open'|'approval'>('open');
 const [nextLeader,setNextLeader]=useState('');

 const refresh=useCallback(async()=>{
  const [partyResult,requestResult]=await Promise.all([
   db.rpc('list_player_party_options',{p_character:character}),
   db.rpc('list_party_membership_requests',{p_character:character})
  ]);
  if(partyResult.error)throw partyResult.error;
  if(requestResult.error)throw requestResult.error;
  const next=partyResult.data as PartyState;
  setRequests((requestResult.data??[]) as PartyRequest[]);
  setState(next);
  const myParty=next.parties.find(p=>p.id===next.current_party_id);
  if(!myParty?.is_organizer)setConfigOpen(false);
  setChoice(previous=>next.parties.some(p=>p.id===previous)?previous:'');
  const mine=next.parties.find(p=>p.id===next.current_party_id);
  if(mine?.is_organizer){
   const response=await db.rpc('list_party_invitable_characters',{p_party:mine.id});
   if(response.error)throw response.error;
   setCandidates((response.data??[]) as {id:string;name:string}[]);
  }else setCandidates([]);
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

 async function membershipRequest(action:'request'|'invite'|'accept'|'decline'|'cancel',partyId:string,target:string,requestId?:string){
  if(busy||state.is_running)return;
  if(action==='invite'&&!target)return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('manage_party_membership_request',{
    p_character:target,p_party:partyId,p_action:action,p_request:requestId??null
   });
   if(e)throw e;
   await refresh();await onPartyChanged?.();
   setInviteCharacter('');
   setNotice(action==='request'?'Join request sent to the organizer.':
    action==='invite'?'Party invitation created.':
    action==='accept'?'Party membership approved.':
    action==='decline'?'Request declined.':'Request cancelled.');
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setBusy(false)}
 }
  async function saveSettings(party:Party){
  if(busy||state.is_running||!party.is_organizer)return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('configure_party',{p_party:party.id,p_name:partyDraft.trim(),p_policy:policyDraft});
   if(e)throw e;await refresh();await onPartyChanged?.();
   setConfigOpen(false);setNotice('Party settings saved.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 async function kickMember(party:Party,member:PartyMember){
  if(busy||state.is_running||!party.is_organizer||member.character_id===character)return;
  if(!window.confirm('Remove '+member.name+'? Their shared-bank access will end, but bank contents remain.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('remove_party_member',{p_party:party.id,p_character:member.character_id});
   if(e)throw e;await refresh();await onPartyChanged?.();setNotice('Member removed.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 async function transferLeadership(party:Party){
  const target=party.members.find(m=>m.character_id===nextLeader);
  if(busy||state.is_running||!party.is_organizer||!target||target.character_id===character)return;
  if(!window.confirm('Transfer party leadership to '+target.name+'? You will immediately lose all leader configuration and invitation privileges.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:e}=await db.rpc('transfer_party_leadership',{
    p_party:party.id,p_target_character:target.character_id
   });
   if(e)throw e;
   setConfigOpen(false);setNextLeader('');
   await refresh();await onPartyChanged?.();
   setNotice('Leadership transferred to '+target.name+'. You are now a regular party member.');
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
      {m.name}{m.character_id===character?' (you)':''}{m.is_leader||m.character_id===ownParty.leader_character_id?' · Leader':''}
     </span>)}</div>
    {ownParty.is_organizer&&<>
     <button type="button" aria-expanded={configOpen} disabled={busy}
      onClick={()=>{if(!configOpen){setPartyDraft(ownParty.name);setPolicyDraft(ownParty.join_policy)}setConfigOpen(!configOpen)}}>
      <Settings size={16}/> Configure Party
     </button>
     {configOpen&&<div className="nx-party-action nx-party-settings">
      <h4>Party Settings</h4>
      <form className="nx-party-settings-form" onSubmit={e=>{e.preventDefault();void saveSettings(ownParty)}}>
       <label>Party Name<input required maxLength={100} value={partyDraft}
        disabled={busy||state.is_running} onChange={e=>setPartyDraft(e.target.value)}/></label>
       <label>Join Policy<select value={policyDraft} disabled={busy||state.is_running}
        onChange={e=>setPolicyDraft(e.target.value as 'open'|'approval')}>
         <option value="open">Open — join immediately</option>
         <option value="approval">Approval Required — organizer reviews requests</option>
        </select></label>
       <button type="submit" disabled={busy||state.is_running||!partyDraft.trim()}>Save Party Settings</button>
      </form>
      <h4>Manage Members</h4>
      {ownParty.members.map(m=><div key={m.character_id} className="nx-party-manage-member">
       <span>{m.name}{m.character_id===character?' (you)':''}</span>
       {m.character_id!==character&&<button type="button" disabled={busy||state.is_running}
        onClick={()=>void kickMember(ownParty,m)}>Remove</button>}
      </div>)}
      <p className="nx-party-help">Removing a member revokes shared-bank access without deleting bank contents.</p>
      <div className="nx-party-transfer-leadership">
       <h4>Transfer Party Leadership</h4>
       <p className="nx-party-help">The new leader immediately gains exclusive party configuration, invitation and approval privileges. You will become a regular member.</p>
       <label>New Party Leader
        <select value={nextLeader} disabled={busy||state.is_running} onChange={e=>setNextLeader(e.target.value)}>
         <option value="">Select a party member…</option>
         {ownParty.members.filter(m=>m.character_id!==ownParty.leader_character_id).map(m=>
          <option key={m.character_id} value={m.character_id}>{m.name}</option>)}
        </select>
       </label>
       <button type="button" disabled={busy||state.is_running||!nextLeader}
        onClick={()=>void transferLeadership(ownParty)}>Transfer Leadership</button>
      </div>
     </div>}
    </>}
    <p className="nx-party-help">Join policy: {ownParty.join_policy==='approval'?'Organizer approval':'Open enrollment'}. Your party bank appears in Inventory → Home & Party Banks.</p>
    {ownParty.is_organizer&&<div className="nx-party-action">
      <h4>Invite a Character</h4>
      <label>Campaign character<select value={inviteCharacter} disabled={busy||state.is_running} onChange={e=>setInviteCharacter(e.target.value)}>
       <option value="">Select character…</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <button type="button" disabled={busy||state.is_running||!inviteCharacter}
       onClick={()=>void membershipRequest('invite',ownParty.id,inviteCharacter)}>Send Invitation</button>
     </div>}
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
    <form onSubmit={e=>{e.preventDefault();if(!choice)return;
     const selected=state.parties.find(p=>p.id===choice);
     if(!selected)return;
     if(selected.join_policy==='approval')void membershipRequest('request',selected.id,character);
     else void action('join',selected.id);
    }} className="nx-party-action">
     <h4>Join a Party</h4>
     <p>Open parties allow immediate joining. Approval-required parties receive a join request.</p>
     <label>Available parties<select value={choice} disabled={busy||state.is_running||state.parties.length===0}
      onChange={e=>setChoice(e.target.value)}>
      <option value="">Choose a party…</option>
      {state.parties.map(p=><option key={p.id} value={p.id}>{p.name} ({p.member_count} members)</option>)}
     </select></label>
     <button type="submit" disabled={busy||state.is_running||!choice}>
      <LogIn size={16}/> {state.parties.find(p=>p.id===choice)?.join_policy==='approval'?'Request to Join':'Join Party'}</button>
    </form>
   </div>}
  {requests.length>0&&<div className="nx-party-action">
   <h4>Pending Party Invitations & Requests</h4>
   {requests.map(r=><div key={r.id} className="nx-party-request">
    <strong>{r.party_name}</strong>
    <span>{r.request_type==='invite'?'Invitation for':'Join request from'} {r.character_name}</span>
    <div className="nx-party-request-actions">
     {r.can_respond&&<button type="button" disabled={busy||state.is_running}
      onClick={()=>void membershipRequest('accept',r.party_id,r.character_id,r.id)}>
      {r.request_type==='invite'?'Accept Invitation':'Approve Request'}</button>}
     {r.can_respond&&<button type="button" disabled={busy||state.is_running}
      onClick={()=>void membershipRequest('decline',r.party_id,r.character_id,r.id)}>Decline</button>}
     {r.can_cancel&&<button type="button" disabled={busy||state.is_running}
      onClick={()=>void membershipRequest('cancel',r.party_id,r.character_id,r.id)}>Cancel</button>}
    </div>
   </div>)}
  </div>}
  {notice&&<p className="nx-party-success" role="status">{notice}</p>}
  {error&&<p className="nx-party-error" role="alert">{error}</p>}
 </section>
}
