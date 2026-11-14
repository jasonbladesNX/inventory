import React,{useCallback,useEffect,useState} from 'react';
import type{SupabaseClient}from '@supabase/supabase-js';
import{MessageCircle,RefreshCw,Send}from'lucide-react';
import{inventoryErrorMessage}from'./inventoryErrors';
import './party-chat.css';

type Message={id:string;sender:string;is_gm:boolean;is_mine:boolean;body:string;created_at:string};
export default function PartyChat({db,party,character=null}:{db:SupabaseClient;party:string;character?:string|null}){
 const[messages,setMessages]=useState<Message[]>([]);
 const[draft,setDraft]=useState('');
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const[notice,setNotice]=useState('');
 const[loading,setLoading]=useState(true);
 const refresh=useCallback(async()=>{
  const{data,error:e}=await db.rpc('list_party_messages',{p_party:party,p_character:character,p_limit:50});
  if(e)throw e;
  setMessages((data??[])as Message[]);
 },[db,party,character]);
 useEffect(()=>{
  let active=true;
  setMessages([]);setDraft('');setError('');setLoading(true);
  void refresh().catch(e=>{if(active)setError(inventoryErrorMessage(e))}).finally(()=>{if(active)setLoading(false)});
  const poll=window.setInterval(()=>{if(active)void refresh().catch(e=>{if(active)setError(inventoryErrorMessage(e))})},15000);
  return()=>{active=false;window.clearInterval(poll)};
 },[refresh]);
 async function send(){
  if(busy||!draft.trim())return;
  setBusy(true);setError('');setNotice('');
  try{
   const{error:e}=await db.rpc('send_party_message',{p_party:party,p_character:character,p_body:draft.trim()});
   if(e)throw e;
   setDraft('');await refresh();setNotice('Message sent.');
  }catch(e){setError(inventoryErrorMessage(e))}
  finally{setBusy(false)}
 }
 return <section className="nx-party-chat" aria-label="Private party conversation">
  <div className="nx-party-chat-title">
   <h4><MessageCircle size={17}/> Party Messages</h4>
   <button type="button" aria-label="Refresh party messages" disabled={busy}
    onClick={()=>void refresh().catch(e=>setError(inventoryErrorMessage(e)))}><RefreshCw size={15}/></button>
  </div>
  <p className="nx-party-chat-hint">Only current party members and campaign GMs can view this conversation. Messages are retained after members leave, but access is revoked.</p>
  <div className="nx-party-chat-feed" role="log" aria-label="Recent party messages" aria-live="polite">
   {loading?<p>Loading messages…</p>:messages.length===0?<p>No messages yet. Start the conversation.</p>:
    messages.map(m=><article key={m.id} className={'nx-party-chat-message'+(m.is_mine?' nx-party-chat-mine':'')}>
     <div className="nx-party-chat-meta"><strong>{m.sender}{m.is_gm?' · GM':''}</strong>
      <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time></div>
     <p>{m.body}</p>
    </article>)}
  </div>
  <form onSubmit={e=>{e.preventDefault();void send()}} className="nx-party-chat-compose">
   <label htmlFor={'nx-party-chat-'+party+(character??'-gm')}>Message your party</label>
   <textarea id={'nx-party-chat-'+party+(character??'-gm')} value={draft} maxLength={2000}
    rows={2} disabled={busy} placeholder="Write a message…" onChange={e=>setDraft(e.target.value)}/>
   <div className="nx-party-chat-send"><small>{draft.length}/2000</small>
    <button type="submit" disabled={busy||!draft.trim()}><Send size={15}/> Send</button></div>
  </form>
  {notice&&<p role="status" className="nx-party-chat-success">{notice}</p>}
  {error&&<p role="alert" className="nx-party-chat-error">{error}</p>}
 </section>
}
