import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Backpack, CircleDot, Coins, Crown, FlaskConical, Footprints, Gem, PackageOpen, ScrollText, Shield, ShieldCheck, Shirt, ShoppingBag, Sparkles, Sword, UserRound, WandSparkles, Wrench, X} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './character-screen.css';

export type InventoryTab = 'character' | 'inventory' | 'shop' | 'craft';
type Slot = {id:string; label:string; code?:string};
type Effect = {attribute_code:string; total_bonus:number|string};
type Equipped = {id:string; itemId:string; slot:string; name:string};
type Money = {currency_id:string; code:string; name:string; available:number|string; precision_digits:number};
type InventoryItem = {item_id:string; display_name:string; quantity:number|string; eligible:boolean};
type StorageEntry = {item_id:string;container_item_id:string|null;is_container:boolean;location_name:string};
type ContainerUsage = {container_item_id:string;used_weight_lb:number|string;capacity_weight_lb:number|string|null;item_count:number;unknown_weight_count:number};
type WeightSummary = {known_weight_lb:number|string;carried_weight_lb:number|string;stored_weight_lb:number|string;unknown_item_count:number;item_count:number};
type CarryProfile = {ruleset_code:string;capacity_mode:string;strength:number|null;creature_size:string|null;capacity_lb:number|string|null;drag_lift_push_lb:number|string|null};
type CharacterAttribute = {attribute_code:string;attribute_label:string;score:number|null;modifier:number|null;is_editable:boolean};
type DerivedAttribute = {attribute_code:string;attribute_label:string;base_score:number|null;equipment_bonus:number|string;effective_score:number|string|null;effective_modifier:number|null};
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
  onMoveStorage:(itemId:string,containerItemId:string|null)=>Promise<void>;
  onSaveAttributes:(scores:Record<string,number>,size:string)=>Promise<void>;
  tab:InventoryTab;
  onTabChange:(tab:InventoryTab)=>void;
};

// Presentation only: categories come from the secured character-scoped RPC, never from item names.
const categoryIcons:Record<string,typeof Sword> = {
  weapon:Sword, shield:Shield, armor:ShieldCheck, clothing:Shirt,
  headgear:Crown, jewelry:Gem, ring:CircleDot, footwear:Footprints,
  focus:WandSparkles, tool:Wrench, wondrous:Sparkles,
  gear:Backpack, container:Backpack, unknown:PackageOpen,
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

export default function CharacterScreen({db,campaign,campaignName,character,characterName,slots,effects,inventoryVersion,items,busy,onEquip,onUnequip,onMoveStorage,onSaveAttributes,tab,onTabChange}:Props){
  const [equipped,setEquipped]=useState<Equipped[]>([]);
  const [wallet,setWallet]=useState<Money[]>([]);
  const [validSlots,setValidSlots]=useState<Record<string,string[]>>({});
  const [itemCategories,setItemCategories]=useState<Record<string,string>>({});
  const [storage,setStorage]=useState<Record<string,StorageEntry>>({});
  const [inventoryLocation,setInventoryLocation]=useState<string>('all');
  const [containerUsage,setContainerUsage]=useState<Record<string,ContainerUsage>>({});
  const [weightSummary,setWeightSummary]=useState<WeightSummary|null>(null);
  const [carryProfile,setCarryProfile]=useState<CarryProfile|null>(null);
  const [attributes,setAttributes]=useState<CharacterAttribute[]>([]);
  const [derivedAttributes,setDerivedAttributes]=useState<Record<string,DerivedAttribute>>({});
  const [draftScores,setDraftScores]=useState<Record<string,string>>({});
  const [draftSize,setDraftSize]=useState('');
  const [carryError,setCarryError]=useState('');
  const [attributesSaving,setAttributesSaving]=useState(false);
  const [attributeEditorOpen,setAttributeEditorOpen]=useState(false);
  const attributeCloseRef=useRef<HTMLButtonElement>(null);
  const attributeTriggerRef=useRef<HTMLButtonElement>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [expandedItem,setExpandedItem]=useState<string|null>(null);
  const [itemDetails,setItemDetails]=useState<ItemDetails|null>(null);
  const [detailsError,setDetailsError]=useState('');
  const [storageActionError,setStorageActionError]=useState('');
  const [detailsLoading,setDetailsLoading]=useState(false);
  const modalCloseRef=useRef<HTMLButtonElement>(null);
  const previousFocusRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);setError('');setEquipped([]);setWallet([]);setValidSlots({});setItemCategories({});setStorage({});setContainerUsage({});setWeightSummary(null);setCarryProfile(null);setAttributes([]);setDerivedAttributes({});
      try{
        const [assignments,currency,compatibility,categories,storageRows,usageRows,weightRows,carryRows,attributeRows,derivedRows]=await Promise.all([
          db.rpc('list_character_equipped_instances',{p_character:character}),
          db.rpc('list_my_trade_currency',{p_character:character}),
          db.rpc('list_character_valid_equipment_slots',{p_character:character}),
          db.rpc('list_character_item_categories',{p_character:character}),
          db.rpc('list_character_storage',{p_character:character}),
          db.rpc('list_character_container_usage',{p_character:character}),
          db.rpc('get_character_inventory_weight',{p_character:character}),
          db.rpc('get_character_carry_capacity',{p_character:character}),
          db.rpc('list_character_attributes',{p_character:character}),
          db.rpc('list_character_derived_attributes',{p_character:character}),
        ]);
        if(assignments.error)throw assignments.error;
        if(currency.error)throw currency.error;
        if(compatibility.error)throw compatibility.error;
        if(categories.error)throw categories.error;
        if(storageRows.error)throw storageRows.error;
        if(usageRows.error)throw usageRows.error;
        if(weightRows.error)throw weightRows.error;
        if(carryRows.error)throw carryRows.error;
        if(attributeRows.error)throw attributeRows.error;
        if(derivedRows.error)throw derivedRows.error;
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
        const iconsByItem:Record<string,string>={};
        for(const row of categories.data||[]){
          iconsByItem[row.item_id]=row.category;
        }
        setItemCategories(iconsByItem);
        const storageByItem:Record<string,StorageEntry>={};
        for(const row of storageRows.data||[])storageByItem[row.item_id]=row as StorageEntry;
        setStorage(storageByItem);
        const usageByItem:Record<string,ContainerUsage>={};
        for(const row of usageRows.data||[])usageByItem[row.container_item_id]=row as ContainerUsage;
        setContainerUsage(usageByItem);
        setWeightSummary((weightRows.data?.[0]??null) as WeightSummary|null);
        const profile=(carryRows.data?.[0]??null) as CarryProfile|null;
        setCarryProfile(profile);
        const newAttrs=(attributeRows.data||[]) as CharacterAttribute[];
        setAttributes(newAttrs);
        setDerivedAttributes(Object.fromEntries(((derivedRows.data||[]) as DerivedAttribute[]).map(row=>[row.attribute_code,row])));
        setDraftScores(Object.fromEntries(newAttrs.map(a=>[a.attribute_code,a.score==null?'':String(a.score)])));
        setDraftSize(profile?.creature_size??'');
        setCarryError('');
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

  useEffect(()=>{
    if(!expandedItem)return;
    modalCloseRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        setExpandedItem(null);
      }
      if(event.key==='Tab'){
        const dialog=modalCloseRef.current?.closest('[role="dialog"]');
        const focusables=dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])');
        if(!focusables?.length)return;
        const first=focusables[0];
        const last=focusables[focusables.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[expandedItem]);

  useEffect(()=>{setStorageActionError('')},[expandedItem,inventoryVersion]);
  useEffect(()=>{setInventoryLocation('all')},[character,campaign]);
  useEffect(()=>{setAttributeEditorOpen(false)},[character,campaign]);
  useEffect(()=>{
    if(!attributeEditorOpen)return;
    attributeCloseRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        setAttributeEditorOpen(false);
        attributeTriggerRef.current?.focus();
      }
      if(event.key==='Tab'){
        const dialog=attributeCloseRef.current?.closest('[role="dialog"]');
        const focusables=dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])');
        if(!focusables?.length)return;
        const first=focusables[0],last=focusables[focusables.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[attributeEditorOpen]);
  const moveStorage=async(itemId:string,destination:string|null)=>{
    setStorageActionError('');
    // Friendly early feedback; the server remains the authoritative capacity validator.
    if(destination&&itemDetails?.item_id===itemId){
      const usage=containerUsage[destination];
      const item=items.find(row=>row.item_id===itemId);
      const unitWeight=Number(itemDetails.properties?.weight);
      const quantity=Number(item?.quantity);
      const capacity=Number(usage?.capacity_weight_lb);
      const used=Number(usage?.used_weight_lb);
      if(usage&&item&&Number.isFinite(unitWeight)&&Number.isFinite(quantity)&&Number.isFinite(capacity)&&Number.isFinite(used)&&
        unitWeight>=0&&quantity>0&&capacity>0&&Number(usage.unknown_weight_count)===0&&used+unitWeight*quantity>capacity){
        setStorageActionError(`Not enough room in this container. The item weighs ${unitWeight*quantity} lb, the container holds ${capacity} lb, and ${used} lb is already inside.`);
        return;
      }
    }
    try{await onMoveStorage(itemId,destination)}catch(e){setStorageActionError(inventoryErrorMessage(e))}
  };
  const closeDetails=()=>{
    setExpandedItem(null);
    previousFocusRef.current?.focus();
  };
  const openDetails=(itemId:string,event:React.MouseEvent<HTMLButtonElement>)=>{
    previousFocusRef.current=event.currentTarget;
    setExpandedItem(itemId);
  };
  const renderItemIcon=(itemId:string,size:number)=>{
    const Icon=categoryIcons[itemCategories[itemId]??'unknown']??PackageOpen;
    return <Icon size={size} aria-hidden="true"/>;
  };
  const storageContainers=items.filter(item=>storage[item.item_id]?.is_container && !storage[item.item_id]?.container_item_id);
  const selectedItem=items.find(item=>item.item_id===expandedItem);
  const selectedUsage=expandedItem?containerUsage[expandedItem]:undefined;
  const containedItems=expandedItem?items.filter(item=>storage[item.item_id]?.container_item_id===expandedItem):[];
  const equippedByItem=new Map(equipped.map(row=>[row.itemId,row]));
  const carriedItems=items.filter(item=>!storage[item.item_id]?.container_item_id);
  const storedItems=items.filter(item=>Boolean(storage[item.item_id]?.container_item_id));
  const containerGroups=storageContainers.map(container=>({
    container, contents:storedItems.filter(item=>storage[item.item_id]?.container_item_id===container.item_id)
  }));
  const locationExists=inventoryLocation==='all'||inventoryLocation==='carried'||storageContainers.some(item=>item.item_id===inventoryLocation);
  const currentLocation=locationExists?inventoryLocation:'all';
  const renderInventoryCard=(item:InventoryItem)=>(
    <article className={'mv-inventory-item'+(equippedByItem.has(item.item_id)?' is-equipped':'')} key={item.item_id}>
      <button type="button" className="mv-item-icon mv-item-icon-button" aria-label={`View details for ${item.display_name}`} aria-haspopup="dialog" onClick={event=>openDetails(item.item_id,event)}>{renderItemIcon(item.item_id,25)}</button>
      <div className="mv-item-info">
        <strong>{item.display_name}</strong>
        {equippedByItem.has(item.item_id)&&<span className="mv-equipped-indicator"><Shield size={13} aria-hidden="true"/> Equipped · {equippedByItem.get(item.item_id)?.slot}</span>}
        <span>Quantity: {numberText(item.quantity)}</span>
        {containerUsage[item.item_id]&&<span className="mv-container-card-summary"><Backpack size={13} aria-hidden="true"/> {containerUsage[item.item_id].item_count} {Number(containerUsage[item.item_id].item_count)===1?'item':'items'} · {numberText(containerUsage[item.item_id].used_weight_lb,2)} / {containerUsage[item.item_id].capacity_weight_lb===null?'?':numberText(containerUsage[item.item_id].capacity_weight_lb,2)} lb</span>}
        {storage[item.item_id]?.container_item_id&&<span className="mv-storage-status"><Backpack size={13} aria-hidden="true"/> Inside {storage[item.item_id].location_name}</span>}
      </div>
      {storage[item.item_id]?.is_container&&<button type="button" className="mv-browse-container" onClick={()=>setInventoryLocation(item.item_id)} aria-label={`Browse contents of ${item.display_name}`}>View contents</button>}
    </article>
  );
  const canShowCarryCapacity=carryProfile?.ruleset_code==='dnd5e'&&carryProfile.capacity_mode==='weight';
  const carryLimit=carryProfile?.capacity_lb==null?null:Number(carryProfile.capacity_lb);
  const knownTotal=weightSummary?Number(weightSummary.known_weight_lb):0;
  const carryPercent=carryLimit!==null&&carryLimit>0?Math.min(100,Math.max(0,knownTotal/carryLimit*100)):0;
  const saveAttributes=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const scores:Record<string,number>={};
    for(const row of attributes){
      const text=draftScores[row.attribute_code]?.trim()??'';
      const value=Number(text);
      if(!text||!Number.isInteger(value)||value<1||value>30){
        setCarryError(`Enter a score from 1 to 30 for ${row.attribute_label}.`);return;
      }
      scores[row.attribute_code]=value;
    }
    if(!['Tiny','Small','Medium','Large','Huge','Gargantuan'].includes(draftSize)){setCarryError('Choose a valid creature size.');return;}
    setAttributesSaving(true);setCarryError('');
    try{await onSaveAttributes(scores,draftSize);setAttributeEditorOpen(false);attributeTriggerRef.current?.focus()}
    catch(e){setCarryError(inventoryErrorMessage(e))}
    finally{setAttributesSaving(false)}
  };
  const closeAttributeEditor=()=>{
    setAttributeEditorOpen(false);
    setCarryError('');
    setDraftScores(Object.fromEntries(attributes.map(a=>[a.attribute_code,a.score==null?'':String(a.score)])));
    setDraftSize(carryProfile?.creature_size??'');
    attributeTriggerRef.current?.focus();
  };
  const attributePanel=attributes.length>0&&<section className="mv-panel mv-attributes-panel" aria-labelledby="mv-attributes-title">
    <div className="mv-attributes-summary-heading">
      <h3 id="mv-attributes-title"><UserRound size={20}/> Character Attributes</h3>
      {attributes.every(a=>a.is_editable)&&<button type="button" ref={attributeTriggerRef} className="mv-attributes-edit-trigger" disabled={loading||busy} onClick={()=>{setCarryError('');setAttributeEditorOpen(true)}}>Edit Attributes</button>}
    </div>
    <div className="mv-attributes-summary" aria-label="Saved character ability scores">
      {attributes.map(row=>{
        const derived=derivedAttributes[row.attribute_code];
        const bonus=Number(derived?.equipment_bonus??0);
        const effective=derived?.effective_score??row.score;
        const modifier=derived?.effective_modifier??row.modifier;
        return <div key={row.attribute_code} className={'mv-attribute-summary-item'+(bonus!==0?' has-equipment-bonus':'')}
          title={bonus!==0?`Base ${row.score??'not set'}; equipment ${bonus>0?'+':''}${numberText(bonus,2)}`:`Base ${row.score??'not set'}`}>
          <span>{row.attribute_code}:</span>
          <strong>{effective===null?'—':numberText(effective,2)}</strong>
          {modifier!==null&&<span className="mv-attribute-summary-mod">({modifier>=0?'+':''}{modifier})</span>}
          {bonus!==0&&<small className="mv-attribute-equipment-label">Gear net {bonus>0?'+':''}{numberText(bonus,2)}</small>}
        </div>
      })}
    </div>
    <p className="mv-attributes-summary-note">Effective scores are resolved from base attributes plus eligible equipment effects. Same-group bonuses do not stack, and the strongest score-setting effect takes precedence. Edit Attributes changes base scores only.</p>
    {!attributes.every(a=>a.is_editable)&&<p className="mv-attributes-note">Attribute editing is not configured for this ruleset yet.</p>}
  </section>;
  const attributeModal=attributeEditorOpen&&attributes.length>0&&attributes.every(a=>a.is_editable)&&createPortal(
    <div className="mv-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeAttributeEditor()}}>
      <section role="dialog" aria-modal="true" aria-labelledby="mv-attributes-modal-title" className="mv-item-modal mv-attributes-modal">
        <div className="mv-modal-header">
          <div className="mv-modal-heading"><UserRound size={24} aria-hidden="true"/><div><span className="mv-modal-eyebrow">Character</span><h3 id="mv-attributes-modal-title">Edit Attributes</h3></div></div>
          <button ref={attributeCloseRef} type="button" className="mv-modal-close" aria-label="Close attribute editor" onClick={closeAttributeEditor} disabled={attributesSaving}><X size={22}/></button>
        </div>
        <form className="mv-attributes-form mv-attributes-modal-form" onSubmit={event=>{void saveAttributes(event)}}>
          <div className="mv-modal-body">
            <p className="mv-attributes-note">Edit base ability scores and creature size. Equipment bonuses are applied separately and are not changed by this editor.</p>
            <div className="mv-attributes-grid">
              {attributes.map(row=><label key={row.attribute_code} className="mv-attribute-card">
                <span className="mv-attribute-label">{row.attribute_label} <small>{row.attribute_code}</small></span>
                <input type="number" min={1} max={30} step={1} required aria-label={row.attribute_label}
                  value={draftScores[row.attribute_code]??''} onChange={event=>setDraftScores(prev=>({...prev,[row.attribute_code]:event.target.value}))}/>
                <span className="mv-attribute-modifier">{draftScores[row.attribute_code]&&Number.isInteger(Number(draftScores[row.attribute_code]))&&Number(draftScores[row.attribute_code])>=1&&Number(draftScores[row.attribute_code])<=30?
                  `Modifier ${Math.floor((Number(draftScores[row.attribute_code])-10)/2)>=0?'+':''}${Math.floor((Number(draftScores[row.attribute_code])-10)/2)}`:'Not set'}</span>
              </label>)}
            </div>
            <div className="mv-attributes-footer">
              <label htmlFor="mv-character-size">Creature size
                <select id="mv-character-size" required value={draftSize} onChange={event=>setDraftSize(event.target.value)}>
                  <option value="">Select size…</option>
                  {['Tiny','Small','Medium','Large','Huge','Gargantuan'].map(size=><option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>
            {carryError&&<p className="mv-storage-error" role="alert">{carryError}</p>}
          </div>
          <div className="mv-modal-footer mv-attributes-modal-footer">
            <button type="button" className="mv-attributes-cancel" onClick={closeAttributeEditor} disabled={attributesSaving}>Cancel</button>
            <button type="submit" className="mv-modal-done" disabled={busy||loading||attributesSaving}>{attributesSaving?'Saving…':'Save Attributes'}</button>
          </div>
        </form>
      </section>
    </div>,document.body
  );
  const inventoryWeightPanel=weightSummary&&<section className="mv-weight-summary" aria-label="Inventory weight overview">
    <div className="mv-weight-summary-heading"><Backpack size={17} aria-hidden="true"/><strong>Inventory Weight</strong><span>Known weights only</span></div>
    <div className="mv-weight-breakdown">
      <div><span>Total</span><strong>{numberText(weightSummary.known_weight_lb,2)} lb</strong></div>
      <div><span>Loose &amp; equipped</span><strong>{numberText(weightSummary.carried_weight_lb,2)} lb</strong></div>
      <div><span>Inside containers</span><strong>{numberText(weightSummary.stored_weight_lb,2)} lb</strong></div>
    </div>
    {canShowCarryCapacity&&<div className="mv-carry-capacity">
      <div className="mv-carry-capacity-heading"><strong>D&amp;D 5e Carrying Capacity</strong>{carryLimit!==null&&<span>{numberText(weightSummary.known_weight_lb,2)} / {numberText(carryLimit,2)} lb</span>}</div>
      {carryLimit!==null&&carryLimit>0&&<>
        <div className="mv-container-meter" role="progressbar" aria-label="Known weight against carrying capacity" aria-valuemin={0} aria-valuemax={carryLimit} aria-valuenow={Math.min(knownTotal,carryLimit)}>
          <span style={{width:`${carryPercent}%`}}/>
        </div>
        <p className="mv-carry-capacity-status">{knownTotal>carryLimit?'Known weight exceeds carrying capacity.':`At least ${numberText(Math.max(0,carryLimit-knownTotal),2)} lb of capacity remains based on known weights.`}</p>
        <p className="mv-carry-capacity-note">Push, drag, or lift: up to {numberText(carryProfile.drag_lift_push_lb??0,2)} lb.</p>
      </>}
      {carryLimit===null&&<p className="mv-carry-capacity-note">Set Strength and creature size to calculate capacity. No score has been assumed.</p>}
      <p className="mv-carry-capacity-note">Edit Strength and creature size in Character Attributes to change this capacity.</p>
    </div>}
    {!canShowCarryCapacity&&carryProfile&&<p className="mv-weight-note">This campaign's ruleset has no carrying-capacity formula configured yet.</p>}
    {Number(weightSummary.unknown_item_count)>0&&<p className="mv-weight-unknown"><PackageOpen size={15} aria-hidden="true"/> {weightSummary.unknown_item_count} {Number(weightSummary.unknown_item_count)===1?'item has':'items have'} no recorded weight. The actual total may be higher.</p>}
    <p className="mv-weight-note">Stored items count toward total carried weight while you carry their containers. Missing weights make the remaining-capacity estimate incomplete.</p>
  </section>;
  const walletOrder=(code:string)=>({PP:0,GP:1,EP:2,SP:3,CP:4}[code.toUpperCase()]??5);
  return <div className="multiverse">
    <div className="mv-hero">
      <div className="mv-eyebrow">NEXUS MULTIVERSE</div>
      <div className="mv-campaign">{campaignName}</div>
      <h2>{characterName}</h2>
      <div className="mv-ornament" aria-hidden="true">✦</div>
    </div>
    {tab==='character'&&<div className="mv-panels">
      {attributePanel}
      {attributeModal}
      {inventoryWeightPanel}
      <section className="mv-panel" aria-labelledby="mv-equipped-title">
        <h3 id="mv-equipped-title"><Sword size={20}/> Equipped Items</h3>
        {loading?<p className="mv-empty">Loading equipment…</p>:equipped.length===0?<p className="mv-empty">No equipped items yet. Equip an item from Inventory to see it here.</p>:
          <div className="mv-rows">{equipped.map(row=><div className="mv-equipment-row" key={row.id}><Shield size={18}/><span>{row.slot}</span><strong>{row.name}</strong><button type="button" className="mv-unequip-button" disabled={busy||loading} onClick={()=>onUnequip(row.id)} aria-label={`Unequip ${row.name} from ${row.slot}`}>Unequip</button></div>)}</div>}
      </section>
      <section className="mv-panel" aria-labelledby="mv-bonuses-title">
        <h3 id="mv-bonuses-title"><Sparkles size={20}/> Equipment Bonuses</h3>
        {Object.values(derivedAttributes).filter(a=>Number(a.equipment_bonus)!==0).length===0?
          <p className="mv-empty">No active resolved equipment adjustments to ability scores.</p>:
          <div className="mv-rows">{Object.values(derivedAttributes).filter(a=>Number(a.equipment_bonus)!==0).map(a=><div key={a.attribute_code} className="mv-bonus-row"><Gem size={17}/><span>{a.attribute_label}</span><strong>{Number(a.equipment_bonus)>0?'+':''}{numberText(a.equipment_bonus,2)}</strong></div>)}</div>}
        <p className="mv-weight-note">Only identified, unconditional add/set ability effects are resolved here. Conditional and other effect operations await ruleset handlers.</p>
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
        <h3 id="mv-inventory-title"><Backpack size={20}/> Inventory <span className="mv-item-count">{items.length} {items.length===1?'item':'items'}</span></h3>
        {inventoryWeightPanel}
        {items.length===0?<p className="mv-empty">Your inventory is empty. Add an item using the campaign tools above.</p>:<>
          <nav className="mv-inventory-locations" aria-label="Inventory locations">
            <button type="button" className={'mv-location-tab'+(currentLocation==='all'?' is-active':'')} aria-current={currentLocation==='all'?'page':undefined} onClick={()=>setInventoryLocation('all')}>All <span>{items.length}</span></button>
            <button type="button" className={'mv-location-tab'+(currentLocation==='carried'?' is-active':'')} aria-current={currentLocation==='carried'?'page':undefined} onClick={()=>setInventoryLocation('carried')}>Carried <span>{carriedItems.length}</span></button>
            {containerGroups.map(({container,contents})=><button key={container.item_id} type="button" className={'mv-location-tab'+(currentLocation===container.item_id?' is-active':'')} aria-current={currentLocation===container.item_id?'page':undefined} onClick={()=>setInventoryLocation(container.item_id)}>
              <Backpack size={15} aria-hidden="true"/> {container.display_name} <span>{contents.length}</span>
            </button>)}
          </nav>
          {currentLocation==='all'?<>
            <section className="mv-inventory-group" aria-label="Carried items">
              <div className="mv-inventory-group-heading"><h4>Carried &amp; Equipped</h4><span>{carriedItems.length} items</span></div>
              <div className="mv-inventory-items">{carriedItems.map(renderInventoryCard)}</div>
            </section>
            {containerGroups.filter(({contents})=>contents.length>0).map(({container,contents})=><section className="mv-inventory-group" key={container.item_id} aria-label={`Inside ${container.display_name}`}>
              <div className="mv-inventory-group-heading"><h4><Backpack size={16} aria-hidden="true"/> Inside {container.display_name}</h4><button type="button" className="mv-group-browse" onClick={()=>setInventoryLocation(container.item_id)}>Browse · {contents.length}</button></div>
              <div className="mv-inventory-items">{contents.map(renderInventoryCard)}</div>
            </section>)}
          </>:currentLocation==='carried'?<section className="mv-inventory-group">
            <div className="mv-inventory-group-heading"><h4>Carried &amp; Equipped</h4><span>{carriedItems.length} items</span></div>
            <div className="mv-inventory-items">{carriedItems.map(renderInventoryCard)}</div>
          </section>:containerGroups.filter(({container})=>container.item_id===currentLocation).map(({container,contents})=><section className="mv-inventory-group" key={container.item_id}>
            <div className="mv-inventory-group-heading"><h4><Backpack size={17} aria-hidden="true"/> {container.display_name} Contents</h4><button type="button" className="mv-group-browse" onClick={()=>setInventoryLocation('all')}>All items</button></div>
            {containerUsage[container.item_id]&&<div className="mv-location-capacity">{numberText(containerUsage[container.item_id].used_weight_lb,2)} / {containerUsage[container.item_id].capacity_weight_lb===null?'?':numberText(containerUsage[container.item_id].capacity_weight_lb,2)} lb used</div>}
            <button type="button" className="mv-container-detail-link" onClick={event=>openDetails(container.item_id,event)}>Open {container.display_name} details</button>
            {contents.length===0?<p className="mv-empty">This container is empty.</p>:<div className="mv-inventory-items">{contents.map(renderInventoryCard)}</div>}
          </section>)}
        </>}
        {slots.length===0&&<p className="mv-empty">No equipment slots have been configured for this campaign yet.</p>}
      </section>
      <p className="mv-inventory-hint">Trading and connection diagnostics remain available below the inventory panel during testing.</p>
    </div>}
    {tab==='shop'&&<section className="mv-panel mv-placeholder"><ShoppingBag size={30}/><h3>Campaign Shops</h3><p>Shop browsing and purchases are not enabled yet. Merchant transactions will be connected after security testing.</p></section>}
    {tab==='craft'&&<section className="mv-panel mv-placeholder"><FlaskConical size={30}/><h3>Crafting</h3><p>Recipes, materials and crafting actions are planned. No materials can be consumed from this preview.</p></section>}
    {tab==='inventory'&&expandedItem&&selectedItem&&createPortal(
      <div className="mv-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeDetails()}}>
        <section role="dialog" aria-modal="true" aria-labelledby="mv-modal-title" aria-describedby="mv-modal-description" className="mv-item-modal">
          <div className="mv-modal-header">
            <div className="mv-modal-heading">{renderItemIcon(selectedItem.item_id,24)}<div><span className="mv-modal-eyebrow">Item details</span><h3 id="mv-modal-title">{selectedItem.display_name}</h3></div></div>
            <button ref={modalCloseRef} type="button" className="mv-modal-close" aria-label="Close item details" onClick={closeDetails}><X size={22}/></button>
          </div>
          <div className="mv-modal-body" id="mv-modal-description">
            {equippedByItem.has(selectedItem.item_id)&&<span className="mv-equipped-indicator"><Shield size={13} aria-hidden="true"/> Equipped · {equippedByItem.get(selectedItem.item_id)?.slot}</span>}
            {storage[selectedItem.item_id]?.container_item_id&&<div className="mv-modal-storage-location"><span className="mv-storage-status"><Backpack size={13} aria-hidden="true"/> Inside {storage[selectedItem.item_id].location_name}</span><button type="button" onClick={()=>setExpandedItem(storage[selectedItem.item_id].container_item_id)}>View container</button></div>}
            {detailsLoading?<p>Loading item details…</p>:detailsError?<p className="mv-error" role="alert">Unable to load item details: {detailsError}</p>:itemDetails&&itemDetails.item_id===selectedItem.item_id?<>
              <div className="mv-detail-grid"><span>Category</span><strong>{titleCase(itemDetails.category)}</strong><span>Condition</span><strong>{itemDetails.condition?titleCase(itemDetails.condition):'Not specified'}</strong><span>Quantity</span><strong>{numberText(selectedItem.quantity)}</strong></div>
              {!itemDetails.identified?<p>This item has not been identified. Additional information is hidden.</p>:<>
                <p className="mv-detail-description">{itemDetails.description||'No description available.'}</p>
                {Object.keys(itemDetails.properties||{}).length>0&&<div className="mv-detail-section"><h4>Properties</h4><div className="mv-detail-grid">{Object.entries(itemDetails.properties).map(([key,value])=><React.Fragment key={key}><span>{titleCase(key)}</span><strong>{typeof value==='boolean'?(value?'Yes':'No'):Array.isArray(value)?value.map(String).join(', '):typeof value==='object'?JSON.stringify(value):String(value)}</strong></React.Fragment>)}</div></div>}
                {itemDetails.effects.length>0&&<div className="mv-detail-section"><h4>Item effects</h4><div className="mv-detail-grid">{itemDetails.effects.map((effect,index)=><React.Fragment key={index}><span>{titleCase(effect.attribute)}</span><strong>{titleCase(effect.operation)} {typeof effect.value==='object'?JSON.stringify(effect.value):String(effect.value)}</strong></React.Fragment>)}</div></div>}
              </>}
            </>:<p>Details are unavailable.</p>}
          </div>
          {selectedUsage&&<div className="mv-container-contents">
            <h4><Backpack size={18} aria-hidden="true"/> Contents</h4>
            <div className="mv-container-capacity" role="status">
              <span>{numberText(selectedUsage.used_weight_lb,2)} / {selectedUsage.capacity_weight_lb===null?'?':numberText(selectedUsage.capacity_weight_lb,2)} lb used</span>
              <span>{selectedUsage.item_count} {Number(selectedUsage.item_count)===1?'item':'items'}</span>
            </div>
            {selectedUsage.capacity_weight_lb!==null&&Number(selectedUsage.capacity_weight_lb)>0&&
              <div className="mv-container-meter" role="progressbar" aria-label="Container weight capacity" aria-valuemin={0} aria-valuemax={Number(selectedUsage.capacity_weight_lb)} aria-valuenow={Math.min(Number(selectedUsage.used_weight_lb),Number(selectedUsage.capacity_weight_lb))}>
                <span style={{width:`${Math.min(100,Math.max(0,100*Number(selectedUsage.used_weight_lb)/Number(selectedUsage.capacity_weight_lb)))}%`}}/>
              </div>}
            {Number(selectedUsage.unknown_weight_count)>0&&<p className="mv-container-warning">Some stored items have unknown weights. Additional storage is restricted until their weights are configured.</p>}
            {containedItems.length===0?<p className="mv-container-empty">This container is empty.</p>:
              <div className="mv-container-contents-list">
                {containedItems.map(item=><button key={item.item_id} className="mv-container-content-row" type="button" onClick={()=>setExpandedItem(item.item_id)}>
                  {renderItemIcon(item.item_id,18)}
                  <span>{item.display_name}</span>
                  <small>×{numberText(item.quantity)}</small>
                  <span className="mv-container-view">Details</span>
                </button>)}
              </div>}
          </div>}
          <div className="mv-modal-actions" aria-label="Item actions">
            <h4>Actions</h4>
            {equippedByItem.has(selectedItem.item_id)?<button type="button" className="mv-modal-action-button" disabled={busy||loading} onClick={()=>onUnequip(equippedByItem.get(selectedItem.item_id)!.id)}>Unequip</button>:
              selectedItem.eligible&&!loading&&(validSlots[selectedItem.item_id]||[]).length>0?
                <div className="mv-modal-action-field">
                  <label htmlFor="mv-detail-equip">Equip to slot</label>
                  <select id="mv-detail-equip" aria-label={`Equip ${selectedItem.display_name}`} value="" disabled={busy} onChange={event=>{const slotId=event.target.value;if(slotId)onEquip(selectedItem.item_id,slotId)}}>
                    <option value="">Choose equipment slot…</option>
                    {slots.filter(slot=>(validSlots[selectedItem.item_id]||[]).includes(slot.id)).map(slot=><option key={slot.id} value={slot.id}>{slot.label}</option>)}
                  </select>
                </div>:null}
            {!loading&&!equippedByItem.has(selectedItem.item_id)&&storage[selectedItem.item_id]&&!storage[selectedItem.item_id].is_container&&<>
              {storage[selectedItem.item_id].container_item_id&&
                <button type="button" className="mv-modal-action-button" disabled={busy} onClick={()=>{void moveStorage(selectedItem.item_id,null)}}>Take out</button>}
              {storageContainers.some(container=>container.item_id!==selectedItem.item_id&&container.item_id!==storage[selectedItem.item_id]?.container_item_id)&&
                <div className="mv-modal-action-field">
                  <label htmlFor="mv-detail-storage">{storage[selectedItem.item_id]?.container_item_id?'Move to…':'Put in…'}</label>
                  <select id="mv-detail-storage" aria-label={`Put ${selectedItem.display_name} in a container`} value="" disabled={busy}
                    onChange={event=>{if(event.target.value)void moveStorage(selectedItem.item_id,event.target.value)}}>
                    <option value="">Choose container…</option>
                    {storageContainers.filter(container=>container.item_id!==selectedItem.item_id&&container.item_id!==storage[selectedItem.item_id]?.container_item_id).map(container=><option key={container.item_id} value={container.item_id}>{container.display_name}</option>)}
                  </select>
                </div>}
            </>}
            {!loading&&!equippedByItem.has(selectedItem.item_id)&&selectedItem.eligible&&(validSlots[selectedItem.item_id]||[]).length===0&&<span className="mv-modal-action-note">No compatible equipment slots.</span>}
            {storageActionError&&<p className="mv-storage-error" role="alert">{storageActionError}</p>}
          </div>
          <div className="mv-modal-footer"><button type="button" className="mv-modal-done" onClick={closeDetails}>Close</button></div>
        </section>
      </div>,document.body)}
    <nav className="mv-tabs" aria-label="Character inventory navigation">
      {navigation.map(({id,label,Icon})=><button key={id} type="button" onClick={()=>onTabChange(id)} aria-current={tab===id?'page':undefined} className={'mv-tab '+(tab===id?'is-active':'')}><Icon size={21}/><span>{label}</span></button>)}
    </nav>
  </div>;
}
