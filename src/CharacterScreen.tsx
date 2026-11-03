import React, {useEffect, useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Backpack, Coins, Crown, FlaskConical, Gem, PackageOpen, ScrollText, Shield, ShoppingBag, Sparkles, Sword, UserRound, Wrench} from 'lucide-react';
import './character-screen.css';

export type InventoryTab = 'character' | 'inventory' | 'shop' | 'craft';
type Slot = {id:string; label:string; code?:string};
type Effect = {attribute_code:string; total_bonus:number|string};
type Equipped = {id:string; slot:string; name:string};
type Money = {currency_id:string; code:string; name:string; available:number|string; precision_digits:number};
type Props = {
  db:SupabaseClient;
  campaign:string;
  campaignName:string;
  character:string;
  characterName:string;
  slots:Slot[];
  effects:Effect[];
  inventoryVersion:number;
  tab:InventoryTab;
  onTabChange:(tab:InventoryTab)=>void;
};

const navigation: {id:InventoryTab; label:string; Icon:typeof UserRound}[] = [
  {id:'character',label:'Character',Icon:UserRound},
  {id:'inventory',label:'Inventory',Icon:Backpack},
  {id:'shop',label:'Shop',Icon:ShoppingBag},
  {id:'craft',label:'Craft',Icon:Wrench},
];

function numberText(value:number|string, digits=0):string {
  const amount=Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return amount.toLocaleString(undefined,{maximumFractionDigits:Math.max(0,Math.min(6,digits))});
}
function titleCase(code:string):string {return code.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}

export default function CharacterScreen({db,campaign,campaignName,character,characterName,slots,effects,inventoryVersion,tab,onTabChange}:Props){
  const [equipped,setEquipped]=useState<Equipped[]>([]);
  const [wallet,setWallet]=useState<Money[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);setError('');setEquipped([]);setWallet([]);
      try{
        const [assignments,currency]=await Promise.all([
          db.from('equipment_assignments').select('id,slot_id,item_instance_id').eq('campaign_id',campaign).eq('character_id',character),
          db.rpc('list_my_trade_currency',{p_character:character}),
        ]);
        if(assignments.error)throw assignments.error;
        if(currency.error)throw currency.error;
        const rows=assignments.data||[];
        const ids=rows.map(a=>a.item_instance_id);
        let items:{id:string;custom_name:string|null;definition_id:string}[]=[];
        if(ids.length){
          const result=await db.from('item_instances').select('id,custom_name,definition_id').eq('campaign_id',campaign).in('id',ids);
          if(result.error)throw result.error;
          items=result.data||[];
        }
        const defIds=[...new Set(items.map(item=>item.definition_id))];
        let definitions:{id:string;name:string}[]=[];
        if(defIds.length){
          const result=await db.from('item_definitions').select('id,name').in('id',defIds);
          if(result.error)throw result.error;
          definitions=result.data||[];
        }
        if(cancelled)return;
        const itemLookup=new Map(items.map(i=>[i.id,i]));
        const defLookup=new Map(definitions.map(i=>[i.id,i.name]));
        const slotLookup=new Map(slots.map(s=>[s.id,s.label]));
        setEquipped(rows.map(row=>{
          const item=itemLookup.get(row.item_instance_id);
          return {
            id:row.id,
            slot:slotLookup.get(row.slot_id)||'Equipment',
            name:item ? item.custom_name||defLookup.get(item.definition_id)||'Unnamed item' : 'Equipment details unavailable'
          };
        }));
        setWallet((currency.data||[]) as Money[]);
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:String(e))}
      finally{if(!cancelled)setLoading(false)}
    }
    void load();
    return()=>{cancelled=true};
  },[db,campaign,character,inventoryVersion,slots]);

  const walletOrder=(code:string)=>({PP:0,GP:1,EP:2,SP:3,CP:4}[code.toUpperCase()]??5);
  return <div className="multiverse">
    <div className="mv-hero">
      <div className="mv-eyebrow">NEXUS MULTIVERSE</div>
      <div className="mv-campaign">{campaignName}</div>
      <h2>{characterName}</h2>
      <div className="mv-ornament" aria-hidden="true">✦</div>
    </div>
    {tab==='character'&&<div className="mv-panels">
      <section className="mv-panel" aria-labelledby="mv-equipped-title">
        <h3 id="mv-equipped-title"><Sword size={20}/> Equipped Items</h3>
        {loading?<p className="mv-empty">Loading equipment…</p>:equipped.length===0?<p className="mv-empty">No equipped items yet. Equip an item from Inventory to see it here.</p>:
          <div className="mv-rows">{equipped.map(row=><div className="mv-equipment-row" key={row.id}><Shield size={18}/><span>{row.slot}</span><strong>{row.name}</strong></div>)}</div>}
      </section>
      <section className="mv-panel" aria-labelledby="mv-bonuses-title">
        <h3 id="mv-bonuses-title"><Sparkles size={20}/> Equipment Bonuses</h3>
        {effects.length===0?<p className="mv-empty">No active equipment bonuses.</p>:<div className="mv-rows">{effects.filter(e=>Number(e.total_bonus)!==0).map(e=><div key={e.attribute_code} className="mv-bonus-row"><Gem size={17}/><span>{titleCase(e.attribute_code)}</span><strong>{Number(e.total_bonus)>0?'+':''}{numberText(e.total_bonus,2)}</strong></div>)}</div>}
      </section>
      <div className="mv-bottom-panels">
        <section className="mv-panel" aria-labelledby="mv-currency-title">
          <h3 id="mv-currency-title"><Coins size={20}/> Currency</h3>
          {loading?<p className="mv-empty">Loading wallet…</p>:wallet.length===0?<p className="mv-empty">No currency balances yet.</p>:
            <div className="mv-rows">{[...wallet].sort((a,b)=>walletOrder(a.code)-walletOrder(b.code)).map(c=><div className="mv-currency-row" key={c.currency_id}><span className="mv-coin" aria-hidden="true">●</span><span>{c.name||c.code}</span><strong>{numberText(c.available,c.precision_digits)}</strong></div>)}</div>}
        </section>
        <div className="mv-loot-panel"><PackageOpen size={29}/><strong>Claim Loot</strong><small>Coming in a later test build</small></div>
      </div>
      {error&&<p className="mv-error" role="alert">Unable to load equipment or wallet: {error}</p>}
    </div>}
    {tab==='inventory'&&<div className="mv-tab-intro"><Backpack size={21}/><div><strong>Inventory & Trading</strong><small>Manage equipment, items and authorized trade offers below.</small></div></div>}
    {tab==='shop'&&<section className="mv-panel mv-placeholder"><ShoppingBag size={30}/><h3>Campaign Shops</h3><p>Shop browsing and purchases are not enabled yet. Merchant transactions will be connected after security testing.</p></section>}
    {tab==='craft'&&<section className="mv-panel mv-placeholder"><FlaskConical size={30}/><h3>Crafting</h3><p>Recipes, materials and crafting actions are planned. No materials can be consumed from this preview.</p></section>}
    <nav className="mv-tabs" aria-label="Character inventory navigation">
      {navigation.map(({id,label,Icon})=><button key={id} type="button" onClick={()=>onTabChange(id)} aria-current={tab===id?'page':undefined} className={'mv-tab '+(tab===id?'is-active':'')}><Icon size={21}/><span>{label}</span></button>)}
    </nav>
  </div>;
}
