import React,{useState} from 'react';
type Check={name:string;passed:boolean;detail:string};
export default function ConnectionChecks({db,campaign,character}:{db:any;campaign:string;character:string}){
 const[checks,setChecks]=useState<Check[]>([]);
 const[busy,setBusy]=useState(false);
 async function check(){
  setBusy(true);const results:Check[]=[];
  const verify=async(name:string,fn:()=>Promise<any>)=>{
   try{const result=await fn();results.push({name,passed:true,detail:result});}
   catch(e:any){results.push({name,passed:false,detail:e?.message||String(e)});}
  };
  await verify('Authenticated session',async()=>{const {data,error}=await db.auth.getUser();if(error)throw error;if(!data.user)throw Error('Sign in first');return 'Valid signed-in account'});
  await verify('Campaign access',async()=>{const{data,error}=await db.from('campaigns').select('id').eq('id',campaign).single();if(error)throw error;if(!data)throw Error('Campaign not accessible');return 'Campaign visible'});
  await verify('Trade inventory read',async()=>{const{data,error}=await db.rpc('list_character_inventory_for_trade',{p_character:character});if(error)throw error;return `${(data||[]).length} item rows returned`});
  await verify('Trade currency read',async()=>{const{data,error}=await db.rpc('list_my_trade_currency',{p_character:character});if(error)throw error;return `${(data||[]).length} currency rows returned`});
  await verify('Trade inbox read',async()=>{const{data,error}=await db.rpc('list_my_trades',{p_campaign:campaign});if(error)throw error;return `${(data||[]).length} trade rows returned`});
  setChecks(results);setBusy(false);
 }
 return <section className="panel"><h3>Connection checks <small>read-only</small></h3><p className="muted">Tests the signed-in account and four database read paths. Does not create, approve, or settle trades.</p><button className="secondary" disabled={busy||!campaign||!character} onClick={check}>{busy?'Checking…':'Run safe connection checks'}</button>
 {checks.length>0&&<div className="list" aria-live="polite">{checks.map(x=><div className="listrow" key={x.name}><span>{x.passed?'✓':'✗'} {x.name}</span><small>{x.detail}</small></div>)}</div>}</section>
}
