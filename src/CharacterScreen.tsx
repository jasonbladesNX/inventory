import React, {useEffect, useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Backpack, Coins, Crown, FlaskConical, Gem, PackageOpen, ScrollText, Shield, ShoppingBag, Sparkles, Sword, UserRound, Wrench} from 'lucide-react';
import './character-screen.css';

export type InventoryTab = 'character' | 'inventory' | 'shop' | 'craft';
type Slot = {id:string; label:string; code?:string};
type Effect = {attribute_code:string; total_bonus:number|string};
type Equipped = {id:string; itemId:string; slot:string; name:string};
type Money = {currency_id:string; code:string; name:string; available:number|string; precision_digits:number};
type InventoryItem = {item_id:string; display_name:string; quantity:number|string; eligible:boolean};
type ItemDetails = {item_id:string; category:string; description:string; condition:string; identified:boolean; properties:Record<string,unknown>; effects:{attribute:string;operation:string;value:unknown}[]};
type Props = {
  db:SupabaseClient;
  campaign:string;
  campaignName:string;
  character:string;
  characterName:string;
  slots:Slot[];
  effects:Effect[];
  inventoryVersion:number;
  items:InventoryItem[];
  busy:boolean;
  onEquip:(itemId:string,slotId:string)=>void;
  onUnequip:(assignmentId:string)=>void;
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

export default function CharacterScreen({db,campaign,campaignName,character,characterName,slots,effects,inventoryVersion,items,busy,onEquip,onUnequip,tab,onTabChange}:Props){
  const [equipped,setEquipped]=useState<Equipped[]>([]);
  const [wallet,setWallet]=useState<Money[]>([]);
  const [validSlots,setValidSlots]=useState<Record<string,string[]>>({});
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [expandedItem,setExpandedItem]=useState<string|null>(null);
  const [itemDetails,setItemDetails]=useState<ItemDetails|null>(null);
  const [detailsError,setDetailsError]=useState('');
  const [detailsLoading,setDetailsLoading]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);setError('');setEquipped([]);setWallet([]);setValidSlots({});
      try{
        const [assignments,currency,compatibility]=await Promise.all([
          db.rpc('list_character_equipped_instances',{p_character:character}),
          db.rpc('list_my_trade_currency',{p_character:character}),
          db.rpc('list_character_valid_equipment_slots',{p_character:character}),
        ]);
        if(assignments.error)throw assignments.error;
        if(currency.error)throw currency.error;
        if(compatibility.error)throw compatibility.error;
        if(cancelled)return;
        const slotLookup=new Map(slots.map(s=>[s.id,s.label]));
        setEquipped((assignments.data||[]).map(row=>({
          id:row.assignment_id,
          itemId:row.item_id,
          slot:slotLookup.get(row.slot_id)||'Equipment',
          name:row.item_name,
        })));
        setWallet((currency.data||[]) as Money[]);
        const allowed:Record<string,string[]>={};
        for(const row of compatibility.data||[]){
          (allowed[row.item_id]??=[]).push(row.slot_id);
        }
        setValidSlots(allowed);
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:String(e))}
      finally{if(!cancelled)setLoading(false)}
    }
    void load();
    return()=>{cancelled=true};
  },[db,campaign,character,inventoryVersion,slots]);

  useEffect(()=>{
    let cancelled=false;
    setItemDetails(null);setDetailsError('');
    if(!expandedItem){setDetailsLoading(false);return;}
    setDetailsLoading(true);
    async function loadDetails(itemId:string){
      try{
        const {data,error}=await db.rpc('get_character_item_details',{p_character:character,p_item:itemId});
        if(error)throw error;
        if(!cancelled)setItemDetails(data as ItemDetails);
      }catch(e){
        if(!cancelled)setDetailsError(e instanceof Error?e.message:String(e));
      }finally{
        if(!cancelled)setDetailsLoading(false);
      }
    }
    void loadDetails(expandedItem);
    return()=>{cancelled=true};
  },[db,character,inventoryVersion,expandedItem]);

  const equippedByItem=new Map(equipped.map(row=>[row.itemId,row]));
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
          <div className="mv-rows">{equipped.map(row=><div className="mv-equipment-row" key={row.id}><Shield size={18}/><span>{row.slot}</span><strong>{row.name}</strong><button type="button" className="mv-unequip-button" disabled={busy||loading} onClick={()=>onUnequip(row.id)} aria-label={`Unequip ${row.name} from ${row.slot}`}>Unequip</button></div>)}</div>}
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
    {tab==='inventory'&&<div className="mv-inventory-view">
      <section className="mv-panel" aria-labelledby="mv-inventory-title">
        <h3 id="mv-inventory-title"><Backpack size={20}/> Backpack <span className="mv-item-count">{items.length} {items.length===1?'item':'items'}</span></h3>
        {items.length===0?<p className="mv-empty">Your backpack is empty. Add an item using the campaign tools above.</p>:
          <div className="mv-inventory-items">{items.map(item=><article className={'mv-inventory-item'+(equippedByItem.has(item.item_id)?' is-equipped':'')} key={item.item_id}>
            <div className="mv-item-icon" aria-hidden="true"><Sword size={25}/></div>
            <div className="mv-item-info">
              <strong>{item.display_name}</strong>
              {equippedByItem.has(item.item_id)&&<span className="mv-equipped-indicator"><Shield size={13} aria-hidden="true"/> Equipped · {equippedByItem.get(item.item_id)?.slot}</span>}
              <span>Quantity: {numberText(item.quantity)}</span>
              {!item.eligible&&<small>{equippedByItem.has(item.item_id)?'Unavailable for trade while equipped':'Stored · unavailable for trade'}</small>}
              <button type="button" className="mv-details-toggle" aria-expanded={expandedItem===item.item_id} aria-controls={'mv-details-'+item.item_id} onClick={()=>setExpandedItem(current=>current===item.item_id?null:item.item_id)}>{expandedItem===item.item_id?'Hide details':'View details'}</button>
            </div>
            {item.eligible&&!loading&&(validSlots[item.item_id]||[]).length>0&&<select className="mv-equip-select" aria-label={`Equip ${item.display_name}`} value="" disabled={busy} onChange={event=>{const slotId=event.target.value;if(slotId)onEquip(item.item_id,slotId)}}>
              <option value="">Equip…</option>
              {slots.filter(slot=>(validSlots[item.item_id]||[]).includes(slot.id)).map(slot=><option key={slot.id} value={slot.id}>{slot.label}</option>)}
            </select>}
            {item.eligible&&!loading&&(validSlots[item.item_id]||[]).length===0&&<small>No compatible equipment slots</small>}
            {expandedItem===item.item_id&&<div className="mv-item-details" id={'mv-details-'+item.item_id}>
              {detailsLoading?<p>Loading item details…</p>:detailsError?<p className="mv-error" role="alert">Unable to load item details: {detailsError}</p>:itemDetails&&itemDetails.item_id===item.item_id?<>
                <div className="mv-detail-grid"><span>Category</span><strong>{titleCase(itemDetails.category)}</strong><span>Condition</span><strong>{itemDetails.condition?titleCase(itemDetails.condition):'Not specified'}</strong><span>Quantity</span><strong>{numberText(item.quantity)}</strong></div>
                {!itemDetails.identified?<p>This item has not been identified. Additional information is hidden.</p>:<>
                  <p className="mv-detail-description">{itemDetails.description||'No description available.'}</p>
                  {Object.keys(itemDetails.properties||{}).length>0&&<div className="mv-detail-section"><h4>Properties</h4><div className="mv-detail-grid">{Object.entries(itemDetails.properties).map(([key,value])=><React.Fragment key={key}><span>{titleCase(key)}</span><strong>{typeof value==='boolean'?(value?'Yes':'No'):Array.isArray(value)?value.map(String).join(', '):typeof value==='object'?JSON.stringify(value):String(value)}</strong></React.Fragment>)}</div></div>}
                  {itemDetails.effects.length>0&&<div className="mv-detail-section"><h4>Item effects</h4><div className="mv-detail-grid">{itemDetails.effects.map((effect,index)=><React.Fragment key={index}><span>{titleCase(effect.attribute)}</span><strong>{titleCase(effect.operation)} {typeof effect.value==='object'?JSON.stringify(effect.value):String(effect.value)}</strong></React.Fragment>)}</div></div>}
                </>}
              </>:<p>Details are unavailable.</p>}
            </div>}
          </article>)}</div>}
        {slots.length===0&&<p className="mv-empty">No equipment slots have been configured for this campaign yet.</p>}
      </section>
      <p className="mv-inventory-hint">Trading and connection diagnostics remain available below the inventory panel during testing.</p>
    </div>}
    {tab==='shop'&&<section className="mv-panel mv-placeholder"><ShoppingBag size={30}/><h3>Campaign Shops</h3><p>Shop browsing and purchases are not enabled yet. Merchant transactions will be connected after security testing.</p></section>}
    {tab==='craft'&&<section className="mv-panel mv-placeholder"><FlaskConical size={30}/><h3>Crafting</h3><p>Recipes, materials and crafting actions are planned. No materials can be consumed from this preview.</p></section>}
    <nav className="mv-tabs" aria-label="Character inventory navigation">
      {navigation.map(({id,label,Icon})=><button key={id} type="button" onClick={()=>onTabChange(id)} aria-current={tab===id?'page':undefined} className={'mv-tab '+(tab===id?'is-active':'')}><Icon size={21}/><span>{label}</span></button>)}
    </nav>
  </div>;
}
