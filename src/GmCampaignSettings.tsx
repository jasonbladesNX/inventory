import React,{useCallback,useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryErrorMessage} from './inventoryErrors';
type Options={allow_trades:boolean;allow_shops:boolean;approval_required:boolean;enforce_capacity:boolean};
const labels:{key:keyof Options;label:string;description:string}[]=[
 {key:'allow_trades',label:'Player trading',description:'Allow players to propose and settle trades.'},
 {key:'allow_shops',label:'Campaign shops',description:'Allow player purchases and sales at campaign merchants.'},
 {key:'approval_required',label:'GM approval required',description:'Require GM approval for protected gameplay actions, including trades.'},
 {key:'enforce_capacity',label:'Carry capacity enforcement',description:'Apply campaign carrying-capacity restrictions.'}
];
export default function GmCampaignSettings({db,campaign}:{db:SupabaseClient;campaign:string}){
 const [values,setValues]=useState<Options>({allow_trades:false,allow_shops:false,approval_required:false,enforce_capacity:false});
 const [status,setStatus]=useState('active');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const refresh=useCallback(async()=>{const {data,error:e}=await db.rpc('get_campaign_admin_settings',{p_campaign:campaign});if(e)throw e;
  setValues(data.settings as Options);setStatus(data.status)},[db,campaign]);
 useEffect(()=>{void refresh().catch(e=>setError(inventoryErrorMessage(e)))},[refresh]);
 async function change(key:keyof Options,checked:boolean){
  if(busy||status!=='active')return;
  setBusy(true);setError('');setMessage('');
  try{const {error:e}=await db.rpc('update_campaign_admin_settings',{p_campaign:campaign,p_changes:{[key]:checked}});
   if(e)throw e;await refresh();setMessage('Campaign setting saved.');
  }catch(e){setError(inventoryErrorMessage(e))}finally{setBusy(false)}
 }
 return <section style={{display:'grid',gap:10}}>
  <p>Changes are applied to the active campaign and recorded in the administrative audit history.</p>
  {labels.map(field=><label key={field.key} style={{display:'flex',alignItems:'start',gap:11,padding:10,border:'1px solid #356779',borderRadius:9}}>
   <input type="checkbox" style={{width:20,height:20,flexShrink:0}} checked={values[field.key]} disabled={busy||status!=='active'}
    onChange={e=>void change(field.key,e.target.checked)}/>
   <span style={{display:'grid',gap:3}}><strong>{field.label}</strong><small>{field.description}</small></span>
  </label>)}
  {status==='archived'&&<p>Restore the archived campaign before modifying settings.</p>}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
