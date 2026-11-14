import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
import './campaign-comms.css';

type Inbox={id:string;kind:string;title:string;body:string;message_id:string|null;read_at:string|null;created_at:string};
type Msg={id:string;sender:string;sender_label:string;audience:string;subject:string;body:string;created_at:string;read_at:string|null};
type Prefs={announcements:boolean;direct_messages:boolean;gameplay:boolean};
type Settings={allow_direct_messages:boolean;alerts_initiative:boolean;alerts_trades:boolean;alerts_approvals:boolean};
type State={inbox:Inbox[];unread:number;preferences:Prefs;settings:Settings};
type Targets={users:{id:string;label:string}[];zones:{id:string;name:string}[];is_gm:boolean};
const defaults:State={inbox:[],unread:0,preferences:{announcements:true,direct_messages:true,gameplay:true},
 settings:{allow_direct_messages:true,alerts_initiative:true,alerts_trades:true,alerts_approvals:true}};
export default function CampaignComms({db,campaign,isGm=false}:{db:SupabaseClient;campaign:string;isGm?:boolean}){
 const [state,setState]=useState<State>(defaults);
 const [messages,setMessages]=useState<Msg[]>([]);
 const [targets,setTargets]=useState<Targets>({users:[],zones:[],is_gm:isGm});
 const [audience,setAudience]=useState<'all'|'zone'|'direct'>(isGm?'all':'direct');
 const [recipient,setRecipient]=useState('');
 const [zone,setZone]=useState('');
 const [subject,setSubject]=useState('');
 const [body,setBody]=useState('');
 const [view,setView]=useState<'inbox'|'messages'|'compose'|'settings'>('inbox');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [feedback,setFeedback]=useState('');
 const refresh=useCallback(async()=>{
  const [inbox,msgs,people]=await Promise.all([
   db.rpc('get_campaign_notification_state',{p_campaign:campaign}),
   db.rpc('list_campaign_messages',{p_campaign:campaign,p_limit:50}),
   db.rpc('list_campaign_message_targets',{p_campaign:campaign})
  ]);
  for(const result of [inbox,msgs,people])if(result.error)throw result.error;
  setState((inbox.data??defaults) as State);
  setMessages((msgs.data??[]) as Msg[]);
  setTargets((people.data??{users:[],zones:[],is_gm:isGm}) as Targets);
 },[db,campaign,isGm]);
 useEffect(()=>{setError('');void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 useEffect(()=>{
  let alive=true;let channel:ReturnType<SupabaseClient['channel']>|undefined;
  void db.auth.getUser().then(({data,error:e})=>{
   if(!alive||e||!data.user)return;
   channel=db.channel('nx-inbox-'+campaign+'-'+data.user.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notification_inbox',filter:'user_id=eq.'+data.user.id},
      ()=>{void refresh().catch(()=>{})}).subscribe();
  });
  const timer=window.setInterval(()=>void refresh().catch(()=>{}),30000);
  return()=>{alive=false;window.clearInterval(timer);if(channel)void db.removeChannel(channel)};
 },[db,campaign,refresh]);
 async function act(name:string,payload:Record<string,unknown>){
  if(busy)return false;
  setBusy(true);setError('');setFeedback('');
  try{
   const {error:e}=await db.rpc('manage_campaign_notifications',{p_campaign:campaign,p_action:name,p_payload:payload});
   if(e)throw e;await refresh();setFeedback('Saved.');return true;
  }catch(e){setError(inventoryErrorMessage(e));return false}finally{setBusy(false)}
 }
 async function send(event:React.FormEvent){
  event.preventDefault();if(busy)return;
  setBusy(true);setError('');setFeedback('');
  try{
   const {error:e}=await db.rpc('send_campaign_message',{p_campaign:campaign,p_audience:audience,p_body:body,
    p_subject:subject,p_zone:audience==='zone'?zone||null:null,p_user:audience==='direct'?recipient||null:null});
   if(e)throw e;
   setBody('');setSubject('');setFeedback('Message sent.');setView('messages');await refresh();
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 const prefs=state.preferences,settings=state.settings;
 return <section className="nx-comms" aria-label="Campaign messages and notifications">
  <div className="nx-comms-tabs">
   {(['inbox','messages','compose','settings'] as const).map(v=><button key={v} type="button" aria-pressed={view===v}
    onClick={()=>setView(v)}>{v==='inbox'?'Notifications ('+state.unread+')':v==='messages'?'Messages':v==='compose'?'New Message':'Preferences'}</button>)}
  </div>
  {view==='inbox'&&<>
   <div className="nx-comms-actions"><button type="button" disabled={busy||!state.unread} onClick={()=>void act('read_all',{})}>Mark All Read</button>
    <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}>Refresh</button></div>
   <div className="nx-comms-stream">{state.inbox.length===0?<p>No notifications yet.</p>:state.inbox.map(n=><article key={n.id} className={n.read_at?'':'nx-comms-unread'}>
    <div><strong>{n.title}</strong><small>{n.kind} · {new Date(n.created_at).toLocaleString()}</small></div>
    <p>{n.body}</p>{!n.read_at&&<button type="button" disabled={busy} onClick={()=>void act('read',{id:n.id})}>Mark Read</button>}
   </article>)}</div>
  </>}
  {view==='messages'&&<div className="nx-comms-stream">{messages.length===0?<p>No campaign messages yet.</p>:messages.map(m=><article key={m.id}>
   <div><strong>{m.subject||m.sender_label}</strong><small>{m.sender_label} · {m.audience} · {new Date(m.created_at).toLocaleString()}</small></div>
   <p>{m.body}</p>{!m.read_at&&<button disabled={busy} type="button" onClick={()=>void act('message_read',{id:m.id})}>Mark Message Read</button>}
  </article>)}</div>}
  {view==='compose'&&<form className="nx-comms-form" onSubmit={e=>void send(e)}>
   <label>Audience<select value={audience} disabled={busy} onChange={e=>setAudience(e.target.value as typeof audience)}>
    {isGm&&<><option value="all">Whole campaign</option><option value="zone">Selected zone</option></>}
    <option value="direct">Direct message</option></select></label>
   {audience==='zone'&&<label>Zone<select required value={zone} onChange={e=>setZone(e.target.value)}><option value="">Choose zone…</option>
    {targets.zones.map(z=><option value={z.id} key={z.id}>{z.name}</option>)}</select></label>}
   {audience==='direct'&&<label>Recipient<select required value={recipient} onChange={e=>setRecipient(e.target.value)}>
    <option value="">Choose recipient…</option>{targets.users.map(u=><option key={u.id} value={u.id}>{u.label}</option>)}</select></label>}
   <label>Subject<input maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Optional subject"/></label>
   <label>Message<textarea required minLength={1} maxLength={4000} rows={4} value={body} onChange={e=>setBody(e.target.value)}/></label>
   <button type="submit" disabled={busy||!body.trim()||(audience==='direct'&&!recipient)||(audience==='zone'&&!zone)}>Send Message</button>
  </form>}
  {view==='settings'&&<>
   <fieldset className="nx-comms-prefs"><legend>My notifications</legend>
    {(['announcements','direct_messages','gameplay'] as const).map(k=><label key={k}><input type="checkbox" checked={prefs[k]}
     onChange={e=>setState(s=>({...s,preferences:{...s.preferences,[k]:e.target.checked}}))}/>{k.replaceAll('_',' ')}</label>)}
    <button type="button" disabled={busy} onClick={()=>void act('preferences',prefs)}>Save My Preferences</button>
   </fieldset>
   {isGm&&<fieldset className="nx-comms-prefs"><legend>Campaign controls (GM)</legend>
    {(['allow_direct_messages','alerts_initiative','alerts_trades','alerts_approvals'] as const).map(k=><label key={k}><input type="checkbox" checked={settings[k]}
     onChange={e=>setState(s=>({...s,settings:{...s.settings,[k]:e.target.checked}}))}/>{k.replaceAll('_',' ')}</label>)}
    <button type="button" disabled={busy} onClick={()=>void act('settings',settings)}>Save Campaign Controls</button>
   </fieldset>}
   <p className="nx-small-note">In-app notifications work on the web. Native APNs/FCM push delivery requires a future signed mobile app and configured push provider credentials.</p>
  </>}
  {feedback&&<p role="status">{feedback}</p>}{error&&<p role="alert" className="mv-storage-error">{error}</p>}
 </section>;
}
