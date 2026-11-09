import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Backpack, CircleDot, Coins, Crown, FlaskConical, Footprints, Gem, Hand, HeartPulse, PackageOpen, ScrollText, Shield, ShieldCheck, Shirt, ShoppingBag, Sparkles, Sword, Trash2, UserRound, WandSparkles, Wrench, X} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import LoadoutHealthPanel from './LoadoutHealthPanel';
import CombatStatusPanel from './CombatStatusPanel';
import CharacterRestPanel from './CharacterRestPanel';
import CharacterCurrencyPanel from './CharacterCurrencyPanel';
import CampaignShop from './CampaignShop';
import ClaimLootPanel from './ClaimLootPanel';
import CharacterCraftingPanel from './CharacterCraftingPanel';
import InventoryWorkbench,{type WorkbenchIndicator} from './InventoryWorkbench';
import StackManagement from './StackManagement';
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
type EffectSource = {attribute_code:string;item_id:string;item_name:string;effect_id:string;operation:string;effect_value:number|string|null;stacking_group:string|null;effect_status:'applied'|'suppressed'|'condition_unmet'|'unsupported';status_reason:string};
type EquipRequirement = {attribute_code:string;required_score:number;current_score:number|string|null;projected_score:number|string|null;slot_label:string;is_met:boolean};
type EquipPreview = {slot_id:string;slot_label:string;can_equip:boolean;reason:string;replaced_items:string[]};
type UnequipDependency = {dependent_item:string;attribute_code:string;required_score:number;current_score:number|string;projected_score:number|string};
type InvalidEquipment = {assignment_id:string;item_name:string;attribute_code:string;required_score:number;current_score:number|string|null};
type PotionHotbarSlot = {slot:number;definition_id:string|null;name:string|null};
type PotionHotbarOption = {definition_id:string;name:string;quantity:number;item_id:string};
type PotionHotbar = {slots:PotionHotbarSlot[];options:PotionHotbarOption[]};
type ItemDetails = {item_id:string; category:string; description:string; condition:string; identified:boolean; can_consume:boolean; properties:Record<string,unknown>; effects:{attribute:string;operation:string;value:unknown}[]};
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
  onInventoryChanged:()=>Promise<void>;
  onSaveAttributes:(scores:Record<string,number>,size:string)=>Promise<void>;
  tab:InventoryTab;
  onTabChange:(tab:InventoryTab)=>void;
};

// Presentation only: categories come from the secured character-scoped RPC, never from item names.
const categoryIcons:Record<string,typeof Sword> = {
  weapon:Sword, shield:Shield, armor:ShieldCheck, clothing:Shirt,
  headgear:Crown, jewelry:Gem, ring:CircleDot, footwear:Footprints,
  focus:WandSparkles, tool:Wrench, wondrous:Sparkles,
  gear:Backpack,ingredient:PackageOpen,container:Backpack,recipe:ScrollText,unknown:PackageOpen,
};

// Slot identity drives the equipment-row icon. Item categories use the
// corresponding icon so a ring, weapon or armor looks consistent in Inventory.
const slotIcons:Record<string,typeof Sword>={
  main_hand:Sword,off_hand:Hand,armor:ShieldCheck,body:Shirt,head:Crown,
  neck:Gem,ring:CircleDot,feet:Footprints,back:Backpack,backpack:Backpack,
  hands:Hand,waist:CircleDot,shield:Shield,focus:WandSparkles,tool:Wrench,
  weapon:Sword,clothing:Shirt,jewelry:Gem,headgear:Crown,footwear:Footprints,
  wondrous:Sparkles,container:Backpack,gear:PackageOpen
};
function normalizeSlot(value:string):string{
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}
function equipmentSlotIcon(label:string){
  const raw=normalizeSlot(label);
  if(raw.includes('backpack')||raw.startsWith('back'))return Backpack;
  if(raw.includes('main_hand'))return Sword;
  if(raw.includes('off_hand'))return Hand;
  if(raw.includes('armor'))return ShieldCheck;
  if(raw.includes('ring'))return CircleDot;
  if(raw.includes('head'))return Crown;
  if(raw.includes('neck'))return Gem;
  if(raw.includes('foot'))return Footprints;
  return slotIcons[raw]??PackageOpen;
}
const categoryFilterLabels:Record<string,string>={
 weapon:'Weapons',shield:'Shields',armor:'Armor',clothing:'Clothing',headgear:'Headgear',
 jewelry:'Jewelry',ring:'Rings',footwear:'Footwear',focus:'Focus items',tool:'Tools',
 wondrous:'Wondrous items',gear:'General gear',container:'Containers',recipe:'Recipes',unknown:'Other'
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

export default function CharacterScreen({db,campaign,campaignName,character,characterName,slots,effects,inventoryVersion,items,busy,onEquip,onUnequip,onMoveStorage,onInventoryChanged,onSaveAttributes,tab,onTabChange}:Props){
  const [equipped,setEquipped]=useState<Equipped[]>([]);
  const [wallet,setWallet]=useState<Money[]>([]);
  const [potionHotbar,setPotionHotbar]=useState<PotionHotbar>({slots:[],options:[]});
  const [potionSlotBusy,setPotionSlotBusy]=useState<number|null>(null);
  const [potionUseBusy,setPotionUseBusy]=useState<number|null>(null);
  const [potionError,setPotionError]=useState('');
  const [useSuccess,setUseSuccess]=useState('');
  const [activeTimedEffects,setActiveTimedEffects]=useState<{code:string;value:number;unit:string;remaining:number|null;source?:string}[]>([]);
  const [potionEditorOpen,setPotionEditorOpen]=useState(false);
  const potionEditorTriggerRef=useRef<HTMLButtonElement>(null);
  const potionEditorCloseRef=useRef<HTMLButtonElement>(null);
  const [validSlots,setValidSlots]=useState<Record<string,string[]>>({});
  const [itemCategories,setItemCategories]=useState<Record<string,string>>({});
  const [inventoryIndicators,setInventoryIndicators]=useState<Record<string,WorkbenchIndicator>>({});
  const [favoriteIds,setFavoriteIds]=useState<Set<string>>(new Set());
  const [favoriteBusy,setFavoriteBusy]=useState<string|null>(null);
  const [favoriteError,setFavoriteError]=useState('');
  const [storage,setStorage]=useState<Record<string,StorageEntry>>({});
  const [inventoryLocation,setInventoryLocation]=useState<string>('all');
  const [inventorySlotFilter,setInventorySlotFilter]=useState('all');
  const [loadoutOpen,setLoadoutOpen]=useState(false);
  const loadoutTriggerRef=useRef<HTMLButtonElement>(null);
  const loadoutCloseRef=useRef<HTMLButtonElement>(null);
  const [containerUsage,setContainerUsage]=useState<Record<string,ContainerUsage>>({});
  const [weightSummary,setWeightSummary]=useState<WeightSummary|null>(null);
  const [carryProfile,setCarryProfile]=useState<CarryProfile|null>(null);
  const [attributes,setAttributes]=useState<CharacterAttribute[]>([]);
  const [derivedAttributes,setDerivedAttributes]=useState<Record<string,DerivedAttribute>>({});
  const [effectSources,setEffectSources]=useState<EffectSource[]>([]);
  const [effectSourcesError,setEffectSourcesError]=useState('');
  const [draftScores,setDraftScores]=useState<Record<string,string>>({});
  const [draftSize,setDraftSize]=useState('');
  const [hitPoints,setHitPoints]=useState<{configured:boolean;current?:number;max?:number}|null>(null);
  const [hpCurrent,setHpCurrent]=useState('');
  const [hpMax,setHpMax]=useState('');
  const [hpEditing,setHpEditing]=useState(false);
  const [hpSaving,setHpSaving]=useState(false);
  const [hpError,setHpError]=useState('');
  const [hpAdjustAmount,setHpAdjustAmount]=useState('1');
  const [hpAdjustBusy,setHpAdjustBusy]=useState(false);
  const [tempHpValue,setTempHpValue]=useState(0);
  const [tempHpOpen,setTempHpOpen]=useState(false);
  const [tempHpClearing,setTempHpClearing]=useState(false);
  const [hpAdjustFeedback,setHpAdjustFeedback]=useState('');
  const [carryError,setCarryError]=useState('');
  const [attributesSaving,setAttributesSaving]=useState(false);
  const [attributeEditorOpen,setAttributeEditorOpen]=useState(false);
  const [attributeDetailsCode,setAttributeDetailsCode]=useState<string|null>(null);
  const attributeDetailsCloseRef=useRef<HTMLButtonElement>(null);
  const attributeDetailsTriggerRef=useRef<HTMLButtonElement|null>(null);
  const attributeCloseRef=useRef<HTMLButtonElement>(null);
  const attributeTriggerRef=useRef<HTMLButtonElement>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [expandedItem,setExpandedItem]=useState<string|null>(null);
  const [itemDetails,setItemDetails]=useState<ItemDetails|null>(null);
  const [detailsError,setDetailsError]=useState('');
  const [equipRequirements,setEquipRequirements]=useState<EquipRequirement[]>([]);
  const [requirementsError,setRequirementsError]=useState('');
  const [equipPreview,setEquipPreview]=useState<EquipPreview[]>([]);
  const [equipPreviewError,setEquipPreviewError]=useState('');
  const [unequipCheckPending,setUnequipCheckPending]=useState(false);
  const [unequipWarning,setUnequipWarning]=useState<{assignmentId:string;itemName:string;dependencies:UnequipDependency[]}|null>(null);
  const [unequipCheckError,setUnequipCheckError]=useState('');
  const [invalidEquipment,setInvalidEquipment]=useState<InvalidEquipment[]>([]);
  const [invalidEquipmentError,setInvalidEquipmentError]=useState('');
  const unequipCancelRef=useRef<HTMLButtonElement>(null);
  const [storageActionError,setStorageActionError]=useState('');
  const [pendingStorageMove,setPendingStorageMove]=useState<{itemId:string;destination:string|null}|null>(null);
  const [storageMoveQuantity,setStorageMoveQuantity]=useState('1');
  const [storageMoveBusy,setStorageMoveBusy]=useState(false);
  const [splitItemId,setSplitItemId]=useState<string|null>(null);
  const [splitQuantity,setSplitQuantity]=useState('1');
  const [splitBusy,setSplitBusy]=useState(false);
  const [splitError,setSplitError]=useState('');
  const [trashItemId,setTrashItemId]=useState<string|null>(null);
  const [trashQuantity,setTrashQuantity]=useState('1');
  const [trashBusy,setTrashBusy]=useState(false);
  const [trashError,setTrashError]=useState('');
  const [useItemId,setUseItemId]=useState<string|null>(null);
  const [useQuantity,setUseQuantity]=useState('1');
  const [useBusy,setUseBusy]=useState(false);
  const [useError,setUseError]=useState('');
  const [usableItemIds,setUsableItemIds]=useState<Set<string>>(new Set());
  const [learnableRecipeItemIds,setLearnableRecipeItemIds]=useState<Set<string>>(new Set());
  const [quickUseBusy,setQuickUseBusy]=useState<string|null>(null);
  const [quickUseError,setQuickUseError]=useState('');
  const [detailsLoading,setDetailsLoading]=useState(false);
  const modalCloseRef=useRef<HTMLButtonElement>(null);
  const previousFocusRef=useRef<HTMLElement|null>(null);
  async function requestUnequip(row:Equipped){
    if(busy||loading||unequipCheckPending)return;
    setUnequipCheckPending(true);setUnequipCheckError('');setUnequipWarning(null);
    try{
      const {data,error:rpcError}=await db.rpc('preview_character_unequip_dependencies',{
        p_character:character,p_assignment:row.id
      });
      if(rpcError)throw rpcError;
      const dependencies=(data||[]) as UnequipDependency[];
      if(dependencies.length)setUnequipWarning({assignmentId:row.id,itemName:row.name,dependencies});
      else onUnequip(row.id);
    }catch(e){setUnequipCheckError(inventoryErrorMessage(e))}
    finally{setUnequipCheckPending(false)}
  }
  useEffect(()=>{setUnequipWarning(null);setUnequipCheckError('')},[character,inventoryVersion]);
  useEffect(()=>{
    if(!unequipWarning)return;
    const focusRequest=window.requestAnimationFrame(()=>unequipCancelRef.current?.focus());
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setUnequipWarning(null)}
      if(event.key==='Tab'){
        const parent=unequipCancelRef.current?.closest('.mv-unequip-modal');
        const buttons=parent?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        if(!buttons?.length)return;
        const first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    document.addEventListener('keydown',keydown);
    return()=>{window.cancelAnimationFrame(focusRequest);document.removeEventListener('keydown',keydown)};
  },[unequipWarning]);
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);setError('');setEquipped([]);setWallet([]);setValidSlots({});setItemCategories({});setInventoryIndicators({});setUsableItemIds(new Set());setLearnableRecipeItemIds(new Set());setFavoriteIds(new Set());setStorage({});setContainerUsage({});setWeightSummary(null);setCarryProfile(null);setHitPoints(null);setPotionHotbar({slots:[],options:[]});setPotionError('');setActiveTimedEffects([]);setAttributes([]);setDerivedAttributes({});setEffectSources([]);setEffectSourcesError('');setInvalidEquipment([]);setInvalidEquipmentError('');
      try{
        const [assignments,currency,compatibility,categories,storageRows,usageRows,weightRows,carryRows,attributeRows,derivedRows,sourceRows,invalidRows,favoriteRows,indicatorRows,usableRows,hpRows,potionRows,recipeItemRows]=await Promise.all([
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
          db.rpc('list_character_effect_sources',{p_character:character}),
          db.rpc('list_character_invalid_equipment',{p_character:character}),
          db.rpc('list_my_character_item_favorites',{p_character:character}),
          db.rpc('list_character_inventory_indicators',{p_character:character}),
          db.rpc('list_character_usable_items',{p_character:character}),
          db.rpc('get_character_hit_points',{p_character:character}),
           db.rpc('get_character_potion_hotbar',{p_character:character}),
           db.rpc('list_character_recipe_items',{p_character:character}),
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
        if(favoriteRows.error)throw favoriteRows.error;
        if(indicatorRows.error)throw indicatorRows.error;
        if(usableRows.error)throw usableRows.error;
        if(hpRows.error)throw hpRows.error;
         if(potionRows.error)throw potionRows.error;
         if(recipeItemRows.error)throw recipeItemRows.error;
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
        setFavoriteIds(new Set((favoriteRows.data||[]).map((row:{item_id:string})=>row.item_id)));
        const indicators:Record<string,WorkbenchIndicator>={};
        for(const row of indicatorRows.data||[])indicators[row.item_id]=row as WorkbenchIndicator;
        setInventoryIndicators(indicators);
        setUsableItemIds(new Set((usableRows.data||[]).map((row:{item_id:string})=>row.item_id)));
        setLearnableRecipeItemIds(new Set((recipeItemRows.data||[]).map((row:{item_id:string})=>row.item_id)));
         setPotionHotbar((potionRows.data??{slots:[],options:[]}) as PotionHotbar);
        const hp=(hpRows.data??{configured:false}) as {configured:boolean;current?:number;max?:number};
        setHitPoints(hp);
        if(!hpEditing){
          setHpCurrent(hp.configured?String(hp.current):'');
          setHpMax(hp.configured?String(hp.max):'');
        }
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
        if(invalidRows.error){setInvalidEquipmentError(inventoryErrorMessage(invalidRows.error));setInvalidEquipment([])}
        else{setInvalidEquipment((invalidRows.data||[]) as InvalidEquipment[]);setInvalidEquipmentError('')}
        if(sourceRows.error){setEffectSources([]);setEffectSourcesError(inventoryErrorMessage(sourceRows.error))}
        else{setEffectSources((sourceRows.data||[]) as EffectSource[]);setEffectSourcesError('')}
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
    setItemDetails(null);setDetailsError('');setEquipRequirements([]);setRequirementsError('');setEquipPreview([]);setEquipPreviewError('');
    if(!expandedItem){setDetailsLoading(false);return;}
    setDetailsLoading(true);
    async function loadDetails(itemId:string){
      try{
        const [details,preview]=await Promise.all([
          db.rpc('get_character_item_details',{p_character:character,p_item:itemId}),
          db.rpc('preview_character_item_equip',{p_character:character,p_item:itemId})
        ]);
        if(details.error)throw details.error;
        if(cancelled)return;
        setItemDetails(details.data as ItemDetails);
        if(preview.error){setEquipPreviewError(inventoryErrorMessage(preview.error));return;}
        const options=(preview.data||[]) as EquipPreview[];
        setEquipPreview(options);
        const candidates=options.filter(o=>!o.reason.toLowerCase().includes('category')&&!o.reason.toLowerCase().includes('incompatible'));
        const chosen=[...candidates].sort((a,b)=>
          Number(b.can_equip)-Number(a.can_equip) ||
          Number(b.slot_label==='Main Hand')-Number(a.slot_label==='Main Hand')
        )[0];
        if(chosen){
          const requirements=await db.rpc('preview_character_item_attribute_requirements',{
            p_character:character,p_item:itemId,p_slot:chosen.slot_id
          });
          if(cancelled)return;
          if(requirements.error)setRequirementsError(inventoryErrorMessage(requirements.error));
          else setEquipRequirements((requirements.data||[]) as EquipRequirement[]);
        }
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
  useEffect(()=>{setInventorySlotFilter('all');setLoadoutOpen(false)},[character,campaign]);
  useEffect(()=>{
    if(!loadoutOpen)return;
    const frame=window.requestAnimationFrame(()=>loadoutCloseRef.current?.focus());
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();setLoadoutOpen(false);loadoutTriggerRef.current?.focus();
      }
      if(event.key==='Tab'){
        const modal=loadoutCloseRef.current?.closest('[role="dialog"]');
        const controls=modal?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)');
        if(!controls?.length)return;
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    document.addEventListener('keydown',onKey);
    return()=>{window.cancelAnimationFrame(frame);document.removeEventListener('keydown',onKey)};
  },[loadoutOpen]);
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
  const chooseStorageMove=(itemId:string,destination:string|null)=>{
    setStorageActionError('');setTrashItemId(null);setSplitItemId(null);
    const item=items.find(row=>row.item_id===itemId);
    if(!item)return;
    if(Number(item.quantity)>1){
      setPendingStorageMove({itemId,destination});setStorageMoveQuantity(String(item.quantity));
    }else{setPendingStorageMove(null);void moveStorage(itemId,destination);}
  };
  const confirmStorageMove=async()=>{
    if(!pendingStorageMove||storageMoveBusy||busy)return;
    const item=items.find(row=>row.item_id===pendingStorageMove.itemId);
    const quantity=Number(storageMoveQuantity);
    if(!item||!Number.isSafeInteger(quantity)||quantity<1||quantity>Number(item.quantity))return;
    setStorageMoveBusy(true);setStorageActionError('');
    try{
      if(quantity===Number(item.quantity)){
        await onMoveStorage(item.item_id,pendingStorageMove.destination);
      }else{
        const {error:rpcError}=await db.rpc('manage_character_item_stack',{
          p_character:character,p_item:item.item_id,p_action:'move_quantity',p_quantity:quantity,
          p_target_item:null,p_container_item:pendingStorageMove.destination
        });
        if(rpcError)throw rpcError;
        await onInventoryChanged();
      }
      setPendingStorageMove(null);closeDetails();
    }catch(e){setStorageActionError(inventoryErrorMessage(e))}
    finally{setStorageMoveBusy(false)}
  };
  const closeDetails=()=>{
    setSplitItemId(null);setSplitError('');setSplitQuantity('1');
    setTrashItemId(null);setTrashError('');setTrashQuantity('1');
    setUseItemId(null);setUseQuantity('1');setUseError('');
    setPendingStorageMove(null);setStorageActionError('');setStorageMoveQuantity('1');
    setExpandedItem(null);
    previousFocusRef.current?.focus();
  };
  const openDetails=(itemId:string,event:React.MouseEvent<HTMLButtonElement>)=>{
    setSplitItemId(null);setSplitError('');setSplitQuantity('1');
    setTrashItemId(null);setTrashError('');setTrashQuantity('1');
    setUseItemId(null);setUseQuantity('1');setUseError('');
    setPendingStorageMove(null);setStorageActionError('');setStorageMoveQuantity('1');
    previousFocusRef.current=event.currentTarget;
    setExpandedItem(itemId);
  };
  const splitSelectedStack=async()=>{
    const item=items.find(row=>row.item_id===splitItemId);
    const qty=Number(splitQuantity);
    if(!item||busy||splitBusy||!Number.isSafeInteger(qty)||qty<1||qty>=Number(item.quantity))return;
    setSplitBusy(true);setSplitError('');
    try{
      const {error:rpcError}=await db.rpc('manage_character_item_stack',{
        p_character:character,p_item:item.item_id,p_action:'split',p_quantity:qty,
        p_target_item:null,p_container_item:null
      });
      if(rpcError)throw rpcError;
      closeDetails();await onInventoryChanged();setUseSuccess(`Split ${qty} × ${item.display_name} into a separate stack.`);
    }catch(e){setSplitError(inventoryErrorMessage(e))}
    finally{setSplitBusy(false)}
  };
  const confirmItemUse=async()=>{
    const item=items.find(row=>row.item_id===useItemId);
    const amount=Number(useQuantity);
    if(!item||useBusy||busy||!itemDetails?.can_consume||itemDetails.item_id!==item.item_id||
       !Number.isSafeInteger(amount)||amount<1||amount>Number(item.quantity))return;
    setUseBusy(true);setUseError('');
    try{
      const {error:rpcError}=await db.rpc('use_character_inventory_item',{
        p_character:character,p_item:item.item_id,p_quantity:amount
      });
      if(rpcError)throw rpcError;
      closeDetails();await onInventoryChanged();
    }catch(e){setUseError(inventoryErrorMessage(e))}
    finally{setUseBusy(false)}
  };
  const confirmItemTrash=async()=>{
    const item=items.find(row=>row.item_id===trashItemId);
    const amount=Number(trashQuantity);
    if(!item||busy||trashBusy||storage[item.item_id]?.is_container||equipped.some(row=>row.itemId===item.item_id)||
       !Number.isSafeInteger(amount)||amount<1||amount>Number(item.quantity))return;
    setTrashBusy(true);setTrashError('');
    try{
      const {error:rpcError}=await db.rpc('manage_character_item_stack',{
        p_character:character,p_item:item.item_id,p_action:'discard',p_quantity:amount,
        p_target_item:null,p_container_item:null
      });
      if(rpcError)throw rpcError;
      closeDetails();
      await onInventoryChanged();
    }catch(e){setTrashError(inventoryErrorMessage(e))}
    finally{setTrashBusy(false)}
  };
  const renderItemIcon=(itemId:string,size:number)=>{
    const category=itemCategories[itemId]??'unknown';
    const Icon=slotIcons[category]??categoryIcons[category]??PackageOpen;
    return <Icon size={size} aria-hidden="true"/>;
  };
  const storageContainers=items.filter(item=>storage[item.item_id]?.is_container && !storage[item.item_id]?.container_item_id);
  const selectedItem=items.find(item=>item.item_id===expandedItem);
  const selectedUsage=expandedItem?containerUsage[expandedItem]:undefined;
  const containedItems=expandedItem?items.filter(item=>storage[item.item_id]?.container_item_id===expandedItem):[];
  const equippedByItem=new Map(equipped.map(row=>[row.itemId,row]));
  const categoryMatches=(item:InventoryItem)=>inventorySlotFilter==='all'||(itemCategories[item.item_id]??'unknown')===inventorySlotFilter;
  const categoryOptions=[...new Set(items.map(item=>itemCategories[item.item_id]??'unknown'))]
    .sort((a,b)=>(categoryFilterLabels[a]??titleCase(a)).localeCompare(categoryFilterLabels[b]??titleCase(b)));
  const carriedItems=items.filter(item=>!storage[item.item_id]?.container_item_id);
  const storedItems=items.filter(item=>Boolean(storage[item.item_id]?.container_item_id));
  const visibleCarried=carriedItems.filter(categoryMatches);
  const visibleStored=storedItems.filter(categoryMatches);
  const containerGroups=storageContainers.map(container=>({
    container, contents:visibleStored.filter(item=>storage[item.item_id]?.container_item_id===container.item_id)
  }));
  const locationExists=inventoryLocation==='all'||inventoryLocation==='carried'||storageContainers.some(item=>item.item_id===inventoryLocation);
  const currentLocation=locationExists?inventoryLocation:'all';
  const toggleFavorite=async(itemId:string)=>{
    if(favoriteBusy||busy)return;
    const next=!favoriteIds.has(itemId);
    setFavoriteBusy(itemId);setFavoriteError('');
    try{
      const {error:rpcError}=await db.rpc('set_my_character_item_favorite',{
        p_character:character,p_item:itemId,p_favorite:next
      });
      if(rpcError)throw rpcError;
      setFavoriteIds(prev=>{const value=new Set(prev);if(next)value.add(itemId);else value.delete(itemId);return value});
    }catch(e){setFavoriteError(inventoryErrorMessage(e))}
    finally{setFavoriteBusy(null)}
  };
  useEffect(()=>{setPotionEditorOpen(false)},[character,tab]);
  useEffect(()=>{
    if(!potionEditorOpen)return;
    potionEditorCloseRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&potionSlotBusy===null){
        setPotionEditorOpen(false);
        potionEditorTriggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[potionEditorOpen,potionSlotBusy]);
  const assignPotionSlot=async(slot:number,definitionId:string)=>{
    if(busy||loading||potionSlotBusy!==null||potionUseBusy!==null)return;
    setPotionSlotBusy(slot);setPotionError('');
    try{
      const {data,error:rpcError}=await db.rpc('set_character_potion_hotbar_slot',{
        p_character:character,p_slot:slot,p_definition:definitionId||null
      });
      if(rpcError)throw rpcError;
      setPotionHotbar(data as PotionHotbar);
    }catch(e){setPotionError(inventoryErrorMessage(e))}
    finally{setPotionSlotBusy(null)}
  };
  const usePotionSlot=async(slot:number)=>{
    const assignment=potionHotbar.slots.find(row=>row.slot===slot);
    const option=potionHotbar.options.find(row=>row.definition_id===assignment?.definition_id);
    if(!option||Number(option.quantity)<1||busy||loading||potionSlotBusy!==null||potionUseBusy!==null)return;
    setPotionUseBusy(slot);setPotionError('');
    try{
      const {error:rpcError}=await db.rpc('use_character_inventory_item',{
        p_character:character,p_item:option.item_id,p_quantity:1
      });
      if(rpcError)throw rpcError;
      await onInventoryChanged();
      setUseSuccess(`${option.name} used. Its configured effect has been applied.`);
    }catch(e){setPotionError(inventoryErrorMessage(e))}
    finally{setPotionUseBusy(null)}
  };
  const quickUseItem=async(itemId:string)=>{
    if(busy||loading||quickUseBusy||!(usableItemIds.has(itemId)||learnableRecipeItemIds.has(itemId)))return;
    setQuickUseBusy(itemId);setQuickUseError('');
    try{
      if(learnableRecipeItemIds.has(itemId)){
        const {data,error:learnError}=await db.rpc('learn_character_crafting_recipe',{p_character:character,p_item:itemId});
        if(learnError)throw learnError;
        await onInventoryChanged();
        setUseSuccess(data.success?
          'Learned '+data.recipe_name+'! Study check '+data.roll+' + '+data.modifier+' = '+data.total+' vs DC '+data.dc+'.':
          'Study check failed: '+data.total+' vs DC '+data.dc+'. Recipe item retained.');
      }else{
        const {error:rpcError}=await db.rpc('use_character_inventory_item',{
          p_character:character,p_item:itemId,p_quantity:1
        });
        if(rpcError)throw rpcError;
        await onInventoryChanged();
        setUseSuccess(`Item used. Check Combat Status for any active effects.`);
      }
    }catch(e){setQuickUseError(inventoryErrorMessage(e))}
    finally{setQuickUseBusy(null)}
  };
  const renderInventoryCard=(item:InventoryItem,onBrowseContainer:(id:string)=>void)=>{
    const equippedRow=equippedByItem.get(item.item_id);
    const storedIn=storage[item.item_id]?.container_item_id;
    const isContainer=Boolean(storage[item.item_id]?.is_container);
    const allowed=validSlots[item.item_id]??[];
    const quickAction=(event:React.MouseEvent<HTMLButtonElement>)=>{
      if(equippedRow){void requestUnequip(equippedRow);return;}
      if(!storedIn&&item.eligible&&allowed.length===1){
        onEquip(item.item_id,allowed[0]);return;
      }
      // Multiple slots or blocked prerequisites require the full authoritative
      // slot/requirement explanation. Stored items must be taken out first.
      openDetails(item.item_id,event);
    };
    return <article className={'mv-inventory-item'+(equippedRow?' is-equipped':'')} key={item.item_id}>
      <button type="button" className="mv-item-icon mv-item-icon-button" aria-label={`View details for ${item.display_name}`} aria-haspopup="dialog" onClick={event=>openDetails(item.item_id,event)}>{renderItemIcon(item.item_id,25)}</button>
      <div className="mv-item-info">
        <strong>{item.display_name}</strong>
        <div className="nx-inventory-inline-meta">
          {equippedRow&&<span className="mv-equipped-indicator"><Shield size={13} aria-hidden="true"/> Equipped · {equippedRow.slot}</span>}
          <span className="nx-inventory-quantity">Qty {numberText(item.quantity)}</span>
          {inventoryIndicators[item.item_id]&&<span className="nx-inventory-condition">Condition: {titleCase(inventoryIndicators[item.item_id].condition_code||'unknown')}</span>}
          {inventoryIndicators[item.item_id]?.unit_weight_lb!=null&&<span className="nx-inventory-unit-weight">{numberText(inventoryIndicators[item.item_id].unit_weight_lb??0,2)} lb each</span>}
          {inventoryIndicators[item.item_id]&&!inventoryIndicators[item.item_id].identified&&<span className="nx-inventory-unidentified">Unidentified</span>}
        </div>
        {isContainer&&containerUsage[item.item_id]&&<div className="nx-card-container-usage">
          <span className="mv-container-card-summary"><Backpack size={13} aria-hidden="true"/> {containerUsage[item.item_id].item_count} {Number(containerUsage[item.item_id].item_count)===1?'item':'items'} · {numberText(containerUsage[item.item_id].used_weight_lb,2)} / {containerUsage[item.item_id].capacity_weight_lb===null?'unknown':numberText(containerUsage[item.item_id].capacity_weight_lb,2)} lb</span>
          {containerUsage[item.item_id].capacity_weight_lb!==null&&Number(containerUsage[item.item_id].capacity_weight_lb)>0&&
            <div className="nx-card-container-meter" role="progressbar" aria-label={`Capacity used in ${item.display_name}`}
              aria-valuemin={0} aria-valuemax={Number(containerUsage[item.item_id].capacity_weight_lb)}
              aria-valuenow={Math.min(Number(containerUsage[item.item_id].used_weight_lb),Number(containerUsage[item.item_id].capacity_weight_lb))}>
              <span style={{width:`${Math.min(100,100*Number(containerUsage[item.item_id].used_weight_lb)/Number(containerUsage[item.item_id].capacity_weight_lb))}%`}}/>
            </div>}
          {(Number(containerUsage[item.item_id].unknown_weight_count)>0||(
            containerUsage[item.item_id].capacity_weight_lb!==null&&Number(containerUsage[item.item_id].capacity_weight_lb)>0&&
            Number(containerUsage[item.item_id].used_weight_lb)/Number(containerUsage[item.item_id].capacity_weight_lb)>=0.9))&&
            <span className="nx-card-container-warning">{Number(containerUsage[item.item_id].unknown_weight_count)>0?'Includes items of unknown weight':'Container at least 90% full'}</span>}
        </div>}
        {storedIn&&<span className="mv-storage-status mv-stored-tag"><Backpack size={13} aria-hidden="true"/> Stored in {storage[item.item_id].location_name}</span>}
      </div>
      <button type="button" className={'nx-favorite-button'+(favoriteIds.has(item.item_id)?' is-favorite':'')}
        aria-label={(favoriteIds.has(item.item_id)?'Remove favorite ':'Save favorite ')+item.display_name}
        aria-pressed={favoriteIds.has(item.item_id)} title={favoriteIds.has(item.item_id)?'Remove favorite':'Add to favorites'}
        disabled={busy||favoriteBusy!==null} onClick={()=>{void toggleFavorite(item.item_id)}}>
        <span aria-hidden="true">{favoriteIds.has(item.item_id)?'★':'☆'}</span>
      </button>
      {(learnableRecipeItemIds.has(item.item_id)||(usableItemIds.has(item.item_id)&&itemCategories[item.item_id]!=='recipe'))&&!equippedRow&&<button type="button" className="mv-inventory-quick-action nx-inventory-use-button"
        disabled={busy||loading||quickUseBusy!==null}
        aria-label={learnableRecipeItemIds.has(item.item_id)?`Study ${item.display_name} to learn recipe`:`Use one ${item.display_name}`}
        onClick={()=>void quickUseItem(item.item_id)}>{quickUseBusy===item.item_id?'Using…':learnableRecipeItemIds.has(item.item_id)?'Learn':'Use'}</button>}
      {isContainer?
        <button type="button" className="mv-browse-container" onClick={()=>onBrowseContainer(item.item_id)} aria-label={`View contents of ${item.display_name}`}>View contents</button>:
        <button type="button" className="mv-inventory-quick-action"
          disabled={busy||loading||unequipCheckPending}
          aria-haspopup={!equippedRow&&(storedIn||allowed.length!==1)?'dialog':undefined}
          onClick={quickAction}>{equippedRow?'Unequip':'Equip'}</button>}
    </article>;
  };
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
  const closeAttributeDetails=()=>{
    setAttributeDetailsCode(null);
    attributeDetailsTriggerRef.current?.focus();
  };
  useEffect(()=>{setAttributeDetailsCode(null)},[character,tab]);
  useEffect(()=>{
    if(!attributeDetailsCode)return;
    attributeDetailsCloseRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();closeAttributeDetails()}
      if(event.key==='Tab'){
        const dialog=attributeDetailsCloseRef.current?.closest('.mv-attribute-details-modal');
        const focusables=dialog?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        if(!focusables?.length)return;
        const first=focusables[0],last=focusables[focusables.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[attributeDetailsCode]);
  const closeAttributeEditor=()=>{
    setAttributeEditorOpen(false);
    setCarryError('');
    setDraftScores(Object.fromEntries(attributes.map(a=>[a.attribute_code,a.score==null?'':String(a.score)])));
    setDraftSize(carryProfile?.creature_size??'');
    attributeTriggerRef.current?.focus();
  };
  const saveHitPoints=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const current=Number(hpCurrent),max=Number(hpMax);
    if(!Number.isSafeInteger(current)||!Number.isSafeInteger(max)||max<1||max>100000||current<0||current>max){
      setHpError('Enter whole-number HP between 0 and the maximum, with a maximum of at least 1.');return;
    }
    setHpSaving(true);setHpError('');
    try{
      const {data,error:rpcError}=await db.rpc('set_character_hit_points',{
        p_character:character,p_current:current,p_max:max
      });
      if(rpcError)throw rpcError;
      setHitPoints(data);setHpEditing(false);
    }catch(e){setHpError(inventoryErrorMessage(e))}
    finally{setHpSaving(false)}
  };
  const adjustHitPoints=async(operation:'damage'|'heal')=>{
    const amount=Number(hpAdjustAmount);
    if(!hitPoints?.configured||busy||hpAdjustBusy||!Number.isSafeInteger(amount)||amount<1||amount>100000)return;
    setHpAdjustBusy(true);setHpError('');setHpAdjustFeedback('');
    try{
      const {data,error:rpcError}=await db.rpc('adjust_character_hit_points',{
        p_character:character,p_operation:operation,p_amount:amount
      });
      if(rpcError)throw rpcError;
      setHitPoints(data as {configured:boolean;current:number;max:number});
      setHpAdjustFeedback(`${operation==='damage'?'Damage':'Healing'} applied: ${data.applied} HP`);
      await onInventoryChanged();
    }catch(e){setHpError(inventoryErrorMessage(e))}
    finally{setHpAdjustBusy(false)}
  };
  const clearTemporaryHitPoints=async()=>{
    if(busy||loading||tempHpClearing)return;
    setTempHpClearing(true);setHpError('');
    try{
      const {error:rpcError}=await db.rpc('update_character_combat_state',{p_character:character,p_action:'temp_hp',p_payload:{amount:0}});
      if(rpcError)throw rpcError;
      setTempHpValue(0);
      await onInventoryChanged();
    }catch(e){setHpError(inventoryErrorMessage(e))}
    finally{setTempHpClearing(false)}
  };
  const hitPointPanel=<section className="mv-panel mv-hp-panel" aria-labelledby="mv-hp-heading">
    <div className="mv-equipped-heading">
      <h3 id="mv-hp-heading"><HeartPulse size={20}/> Hit Points</h3>
      <div className="mv-hp-title-actions">
        {!hpEditing&&<button type="button" className="mv-attributes-edit-trigger" disabled={busy||loading}
          onClick={()=>{setHpCurrent(hitPoints?.configured?String(hitPoints.current):'');setHpMax(hitPoints?.configured?String(hitPoints.max):'');setHpError('');setHpEditing(true)}}>{hitPoints?.configured?'Edit HP':'Set HP'}</button>}
        <button type="button" className="mv-attributes-edit-trigger" disabled={busy||loading||tempHpClearing}
          onClick={()=>{if(tempHpValue>0)void clearTemporaryHitPoints();else setTempHpOpen(true)}}>
          {tempHpValue>0?'Clear temp HP':'Temp HP'}
        </button>
      </div>
    </div>
    {!hpEditing&&<div className="mv-hp-summary">
      {hitPoints?.configured?<><strong>{hitPoints.current} / {hitPoints.max} HP</strong>
        <div className="mv-container-meter" role="progressbar" aria-label="Current hit points"
          aria-valuemin={0} aria-valuemax={hitPoints.max??1} aria-valuenow={hitPoints.current??0}>
          <span style={{width:`${Math.max(0,Math.min(100,100*(hitPoints.current??0)/(hitPoints.max??1)))}%`}}/>
        </div>
        <div className="mv-hp-quick-adjust" aria-label="Quick hit point adjustment">
          <button type="button" className="mv-hp-damage-button" disabled={busy||loading||hpAdjustBusy||!Number.isSafeInteger(Number(hpAdjustAmount))||Number(hpAdjustAmount)<1||Number(hpAdjustAmount)>100000}
            onClick={()=>void adjustHitPoints('damage')}>Damage</button>
          <label htmlFor="mv-hp-adjust-amount">Amount
            <input id="mv-hp-adjust-amount" type="number" min="1" max="100000" step="1" inputMode="numeric"
              value={hpAdjustAmount} disabled={busy||hpAdjustBusy} onChange={e=>{setHpAdjustAmount(e.target.value);setHpAdjustFeedback('')}}/>
          </label>
          <button type="button" className="mv-hp-heal-button" disabled={busy||loading||hpAdjustBusy||!Number.isSafeInteger(Number(hpAdjustAmount))||Number(hpAdjustAmount)<1||Number(hpAdjustAmount)>100000||hitPoints.current===hitPoints.max}
            onClick={()=>void adjustHitPoints('heal')}>Heal HP</button>
        </div>
        {hpAdjustFeedback&&<p className="mv-hp-feedback" role="status">{hpAdjustFeedback}</p>}
        {hpError&&<p className="mv-storage-error" role="alert">{hpError}</p>}
        </>:<p>Hit points not configured. Set current and maximum HP before using a healing potion.</p>}
    </div>}
    {hpEditing&&<form className="mv-hp-form" onSubmit={event=>{void saveHitPoints(event)}}>
      <label>Current HP <input type="number" min="0" max="100000" step="1" required
        value={hpCurrent} onChange={event=>setHpCurrent(event.target.value)}/></label>
      <label>Maximum HP <input type="number" min="1" max="100000" step="1" required
        value={hpMax} onChange={event=>setHpMax(event.target.value)}/></label>
      {hpError&&<p className="mv-storage-error" role="alert">{hpError}</p>}
      <div className="mv-trash-confirm-actions">
        <button type="button" disabled={hpSaving} onClick={()=>{setHpEditing(false);setHpError('')}}>Cancel</button>
        <button type="submit" disabled={hpSaving||busy}>{hpSaving?'Saving…':'Save HP'}</button>
      </div>
    </form>}
  </section>;
  const attributePanel=attributes.length>0&&<section className="mv-panel mv-attributes-panel" aria-labelledby="mv-attributes-title">
    <div className="mv-attributes-summary-heading">
      <h3 id="mv-attributes-title"><UserRound size={20}/> Character Attributes</h3>
      {attributes.every(a=>a.is_editable)&&<button type="button" ref={attributeTriggerRef} className="mv-attributes-edit-trigger" disabled={loading||busy} onClick={()=>{setCarryError('');setAttributeEditorOpen(true)}}>Edit Attributes</button>}
    </div>
    <div className="mv-attributes-summary" aria-label="Saved character ability scores">
      {attributes.map(row=>{
        const derived=derivedAttributes[row.attribute_code];
        const effective=derived?.effective_score??row.score;
        const modifier=derived?.effective_modifier??row.modifier;
        const code=row.attribute_code.toUpperCase();
        const hasBonus=Number(derived?.equipment_bonus??0)!==0||activeTimedEffects.some(effect=>effect.code.toUpperCase()===code);
        return <button type="button" key={row.attribute_code} className="mv-attribute-summary-item mv-attribute-summary-button"
          aria-label={`View ${row.attribute_label} bonuses and modifiers`} aria-haspopup="dialog"
          onClick={event=>{attributeDetailsTriggerRef.current=event.currentTarget;setAttributeDetailsCode(code)}}>
          <span>{row.attribute_code}:</span>
          <strong>{effective===null?'—':numberText(effective,2)}</strong>
          {modifier!==null&&<span className="mv-attribute-summary-mod">({modifier>=0?'+':''}{modifier})</span>}
          {hasBonus&&<span className="mv-attribute-bonus-indicator" aria-label="Active bonuses">✦</span>}
        </button>;
      })}
    </div>
    <p className="mv-attributes-summary-note">Tap an attribute to view its base score, equipment adjustments, active timed bonuses, and modifier.</p>
    {!attributes.every(a=>a.is_editable)&&<p className="mv-attributes-note">Attribute editing is not configured for this ruleset yet.</p>}
  </section>;
  const selectedAttribute=attributes.find(a=>a.attribute_code.toUpperCase()===attributeDetailsCode);
  const selectedDerived=selectedAttribute?derivedAttributes[selectedAttribute.attribute_code]:null;
  const selectedTimedBonuses=activeTimedEffects.filter(effect=>effect.code.toUpperCase()===attributeDetailsCode);
  const selectedEquipmentSources=effectSources.filter(effect=>effect.attribute_code.toUpperCase()===attributeDetailsCode);
  const attributeDetailsModal=attributeDetailsCode&&selectedAttribute&&createPortal(
    <div className="mv-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeAttributeDetails()}}>
      <section role="dialog" aria-modal="true" aria-labelledby="mv-attribute-details-title"
        className="mv-item-modal mv-attribute-details-modal">
        <div className="mv-modal-header">
          <div className="mv-modal-heading"><UserRound size={23} aria-hidden="true"/><div>
            <span className="mv-modal-eyebrow">Attribute breakdown</span>
            <h3 id="mv-attribute-details-title">{selectedAttribute.attribute_label} ({selectedAttribute.attribute_code})</h3>
          </div></div>
          <button type="button" ref={attributeDetailsCloseRef} className="mv-modal-close"
            aria-label="Close attribute details" onClick={closeAttributeDetails}><X size={22}/></button>
        </div>
        <div className="mv-modal-body mv-attribute-details-body">
          <div className="mv-attribute-details-summary">
            <span>Base score <strong>{selectedAttribute.score??'—'}</strong></span>
            <span>Equipment adjustment <strong>{Number(selectedDerived?.equipment_bonus??0)>=0?'+':''}{numberText(Number(selectedDerived?.equipment_bonus??0),2)}</strong></span>
            <span>Timed bonuses <strong>{selectedTimedBonuses.reduce((sum,effect)=>sum+effect.value,0)>=0?'+':''}{numberText(selectedTimedBonuses.reduce((sum,effect)=>sum+effect.value,0),2)}</strong></span>
            <span>Effective score <strong>{selectedDerived?.effective_score??selectedAttribute.score??'—'}</strong></span>
            <span>Effective modifier <strong>{selectedDerived?.effective_modifier==null?'—':`${selectedDerived.effective_modifier>=0?'+':''}${selectedDerived.effective_modifier}`}</strong></span>
          </div>
          <h4>Active timed bonuses</h4>
          {selectedTimedBonuses.length?selectedTimedBonuses.map((effect,index)=><div className="mv-attribute-effect-row" key={index}>
            <strong>{effect.value>=0?'+':''}{numberText(effect.value,2)} {selectedAttribute.attribute_code}</strong>
            <span>{effect.source??'Timed effect'} · {effect.remaining===null?'Until removed':`${effect.remaining} ${effect.unit}${effect.remaining===1?'':'s'} remaining`}</span>
          </div>):<p className="mv-attributes-note">No active timed bonuses.</p>}
          <h4>Equipment effects</h4>
          {selectedEquipmentSources.length?selectedEquipmentSources.map(effect=><div className="mv-attribute-effect-row" key={effect.effect_id+':'+effect.item_id}>
            <strong>{effect.item_name} · {effect.operation} {effect.effect_value==null?'—':String(effect.effect_value)}</strong>
            <span>{effect.effect_status==='applied'?'Applied':effect.effect_status==='suppressed'?'Suppressed':effect.effect_status==='condition_unmet'?'Requirement not met':'Unsupported'}{effect.status_reason?` · ${effect.status_reason}`:''}</span>
          </div>):<p className="mv-attributes-note">No equipment effect sources found.</p>}
          {effectSourcesError&&<p className="mv-storage-error" role="alert">Equipment effect details unavailable: {effectSourcesError}</p>}
          <p className="mv-attributes-note">Equipment adjustments follow the ruleset's stacking and operation rules. Timed bonuses are included in the effective score separately.</p>
        </div>
      </section>
    </div>,document.body);
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
    {canShowCarryCapacity&&<div className="mv-carry-capacity">
      <div className="mv-carry-capacity-heading"><strong>D&amp;D 5e Carrying Capacity</strong>{carryLimit!==null&&<span>{numberText(weightSummary.known_weight_lb,2)} / {numberText(carryLimit,2)} lb</span>}</div>
      {carryLimit!==null&&carryLimit>0&&<div className="mv-container-meter" role="progressbar" aria-label="Known weight against carrying capacity" aria-valuemin={0} aria-valuemax={carryLimit} aria-valuenow={Math.min(knownTotal,carryLimit)}>
        <span style={{width:`${carryPercent}%`}}/>
      </div>}
    </div>}
    <details className="mv-carry-capacity-help">
      <summary>Carrying capacity details</summary>
      <div className="mv-weight-breakdown">
        <div><span>Total</span><strong>{numberText(weightSummary.known_weight_lb,2)} lb</strong></div>
        <div><span>Loose &amp; equipped</span><strong>{numberText(weightSummary.carried_weight_lb,2)} lb</strong></div>
        <div><span>Inside containers</span><strong>{numberText(weightSummary.stored_weight_lb,2)} lb</strong></div>
      </div>
      {canShowCarryCapacity&&carryLimit!==null&&<p className="mv-carry-capacity-note">Push, drag, or lift: up to {numberText(carryProfile.drag_lift_push_lb??0,2)} lb.</p>}
      {canShowCarryCapacity&&carryLimit===null&&<p className="mv-carry-capacity-note">Set Strength and creature size to calculate capacity. No score has been assumed.</p>}
      {canShowCarryCapacity&&<p className="mv-carry-capacity-note">Edit Strength and creature size in Character Attributes to change this capacity.</p>}
      {!canShowCarryCapacity&&carryProfile&&<p className="mv-weight-note">This campaign's ruleset has no carrying-capacity formula configured yet.</p>}
      {Number(weightSummary.unknown_item_count)>0&&<p className="mv-weight-unknown"><PackageOpen size={15} aria-hidden="true"/> {weightSummary.unknown_item_count} {Number(weightSummary.unknown_item_count)===1?'item has':'items have'} no recorded weight. The actual total may be higher.</p>}
      <p className="mv-weight-note">Stored items count toward total carried weight while you carry their containers. Missing weights make the remaining-capacity estimate incomplete.</p>
    </details>
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
      {useSuccess&&<p className="mv-use-success" role="status">{useSuccess}</p>}
      <CombatStatusPanel db={db} character={character} inventoryVersion={inventoryVersion}
        busy={busy||loading} hpCurrent={hitPoints?.configured?(hitPoints.current??null):null}
        tempOpen={tempHpOpen} onCloseTemp={()=>setTempHpOpen(false)}
        onChanged={onInventoryChanged} onCombatLoaded={state=>{setTempHpValue(state.temporary_hp);setActiveTimedEffects(state.effects.filter(effect=>effect.kind==='bonus').map(effect=>({code:effect.code,value:Number(effect.value??0),unit:effect.unit,remaining:effect.remaining,source:effect.source})))}}/>
      <CharacterRestPanel db={db} character={character} inventoryVersion={inventoryVersion} busy={busy||loading} onChanged={onInventoryChanged}/>
      {hitPointPanel}
      {attributePanel}
      {attributeDetailsModal}
      {attributeModal}
    {unequipWarning&&createPortal(
      <div className="mv-modal-backdrop">
        <section className="mv-item-modal mv-unequip-modal" role="alertdialog" aria-modal="true"
          aria-labelledby="mv-unequip-title" aria-describedby="mv-unequip-warning-desc">
          <div className="mv-modal-header">
            <div className="mv-modal-heading"><Shield size={24} aria-hidden="true"/><div>
              <span className="mv-modal-eyebrow">Equipment</span>
              <h3 id="mv-unequip-title">Equipment Dependency Warning</h3>
            </div></div>
          </div>
          <div className="mv-modal-body">
            <p id="mv-unequip-warning-desc">Removing <strong>{unequipWarning.itemName}</strong> would leave these equipped items below their requirements:</p>
            {unequipWarning.dependencies.map((dep,i)=><div className="mv-unequip-dependency" key={i}>
              <strong>{dep.dependent_item}</strong>
              <span>{dep.attribute_code}: {numberText(dep.current_score,2)} → {numberText(dep.projected_score,2)} (requires {dep.required_score})</span>
            </div>)}
            <p>Only {unequipWarning.itemName} will be removed. Other items will stay equipped but will not meet their requirements.</p>
          </div>
          <div className="mv-unequip-warning-actions mv-unequip-modal-actions">
            <button ref={unequipCancelRef} type="button" disabled={busy} onClick={()=>setUnequipWarning(null)}>Cancel</button>
            <button type="button" className="mv-unequip-warning-confirm" disabled={busy}
              onClick={()=>{
                const pending=unequipWarning;
                setUnequipWarning(null);
                if(pending&&equipped.some(item=>item.id===pending.assignmentId))onUnequip(pending.assignmentId);
              }}>Unequip Anyway</button>
          </div>
        </section>
      </div>,document.body)}
      {inventoryWeightPanel}
      <section className="mv-panel" aria-labelledby="mv-equipped-title">
        <div className="mv-equipped-heading">
          <h3 id="mv-equipped-title"><Sword size={20}/> Equipped Items</h3>
          <button type="button" className="mv-loadout-launch" ref={loadoutTriggerRef}
            aria-label="Open loadout health" aria-haspopup="dialog" onClick={()=>setLoadoutOpen(true)}>
            <HeartPulse size={21} aria-hidden="true"/><span>Loadout Health</span>
          </button>
        </div>
        {loading?<p className="mv-empty">Loading equipment…</p>:equipped.length===0?<p className="mv-empty">No equipped items yet. Equip an item from Inventory to see it here.</p>:
          <div className="mv-rows">{equipped.map(row=>{const SlotIcon=equipmentSlotIcon(row.slot);return <div className="mv-equipment-row" key={row.id}><SlotIcon size={18} aria-hidden="true"/><span>{row.slot}</span><strong>{row.name}</strong><button type="button" className="mv-unequip-button" disabled={busy||loading||unequipCheckPending} onClick={()=>{void requestUnequip(row)}} aria-label={`Unequip ${row.name} from ${row.slot}`}>{unequipCheckPending?'Checking…':'Unequip'}</button></div>;})}</div>}
        {unequipCheckError&&<p className="mv-storage-error" role="alert">Unable to check equipment dependencies: {unequipCheckError}. No equipment was changed.</p>}
        {invalidEquipmentError&&<p className="mv-storage-error" role="alert">Unable to check equipment requirements: {invalidEquipmentError}</p>}
        {invalidEquipment.length>0&&<div className="mv-invalid-loadout" role="status">
          <h4>Equipment Requirements Not Met</h4>
          {invalidEquipment.map(row=><p key={row.assignment_id+':'+row.attribute_code}>
            <strong>{row.item_name}</strong> requires {row.attribute_code} {row.required_score}; current {row.attribute_code} {row.current_score??'unset'}.
          </p>)}
          <small>These items remain equipped until you change equipment or attributes.</small>
        </div>}
      </section>
      <section className="mv-panel mv-potions-panel" aria-labelledby="mv-potions-title">
        <div className="mv-potions-heading">
          <h3 id="mv-potions-title"><FlaskConical size={20}/> Potions</h3>
          <button ref={potionEditorTriggerRef} type="button" className="mv-potions-edit-launch"
            aria-label="Edit potion assignments" aria-haspopup="dialog"
            disabled={loading||busy||potionSlotBusy!==null||potionUseBusy!==null}
            onClick={()=>{setPotionError('');setPotionEditorOpen(true)}}>Edit</button>
        </div>
        <div className="mv-potion-slots">
          {[1,2,3,4].map(slot=>{
            const assignment=potionHotbar.slots.find(row=>row.slot===slot);
            const option=potionHotbar.options.find(row=>row.definition_id===assignment?.definition_id);
            const count=option?.quantity??0;
            const potionName=option?.name??assignment?.name??'Unavailable potion';
            return <div className="mv-potion-slot" key={slot}>
              <button type="button" className="mv-potion-use"
                disabled={!option||Number(count)<1||loading||busy||potionSlotBusy!==null||potionUseBusy!==null}
                aria-label={assignment?.definition_id?`Use one ${potionName} (${count} remaining)`:`Empty potion slot ${slot}`}
                onClick={()=>void usePotionSlot(slot)}>
                {potionUseBusy===slot?'Using…':assignment?.definition_id?`${potionName} (${count})`:'Empty'}
              </button>
            </div>;
          })}
        </div>
        {!loading&&potionHotbar.options.length===0&&<p className="mv-empty">No usable potions in inventory. Use Edit to assign a potion when one is available.</p>}
        {potionError&&!potionEditorOpen&&<p className="mv-storage-error" role="alert">Potion action failed: {potionError}</p>}
      </section>
      <div className="mv-bottom-panels">
        <section className="mv-panel" aria-labelledby="mv-currency-title">
          <CharacterCurrencyPanel db={db} campaign={campaign} character={character} inventoryVersion={inventoryVersion}
            wallet={wallet} busy={busy||loading} onChanged={onInventoryChanged}/>
        </section>
        <ClaimLootPanel db={db} character={character} busy={busy||loading} onChanged={onInventoryChanged}/>
      </div>
      {error&&<p className="mv-error" role="alert">Unable to load equipment or wallet: {error}</p>}
    </div>}
    {tab==='inventory'&&<div className="mv-inventory-view">
      {useSuccess&&<p className="mv-use-success" role="status">{useSuccess}</p>}
      <section className="mv-panel" aria-labelledby="mv-inventory-title">
        <h3 id="mv-inventory-title"><Backpack size={20}/> Inventory <span className="mv-item-count">{items.length} {items.length===1?'item':'items'}</span></h3>
        {inventoryWeightPanel}
        {favoriteError&&<p className="mv-error" role="alert">Unable to save favorite: {favoriteError}</p>}
        {items.length===0?<p className="mv-empty">Your inventory is empty. Add an item using the campaign tools above.</p>:
          <InventoryWorkbench characterName={characterName} items={items} categories={itemCategories}
            storage={storage} usage={containerUsage} indicators={inventoryIndicators}
            equippedIds={new Set(equipped.map(row=>row.itemId))} favoriteIds={favoriteIds}
            busy={busy||loading||favoriteBusy!==null} renderItem={renderInventoryCard}
            />}
        {slots.length===0&&<p className="mv-empty">No equipment slots have been configured for this campaign yet.</p>}
      </section>
      {quickUseError&&<p className="mv-storage-error" role="alert">Unable to use item: {quickUseError}</p>}
      <StackManagement db={db} character={character} inventoryVersion={inventoryVersion} items={items} storage={storage} categories={itemCategories}
        equippedIds={new Set(equipped.map(row=>row.itemId))} busy={busy||loading} onChanged={onInventoryChanged}/>
      <p className="mv-inventory-hint">Trading and connection diagnostics remain available below the inventory panel during testing.</p>
    </div>}
    {tab==='shop'&&<CampaignShop db={db} campaign={campaign} character={character} inventoryVersion={inventoryVersion} busy={busy||loading} onChanged={onInventoryChanged}/>}
    {tab==='craft'&&<CharacterCraftingPanel db={db} campaign={campaign} character={character} inventoryVersion={inventoryVersion} busy={busy||loading} onChanged={onInventoryChanged}/>}
    {loadoutOpen&&tab==='character'&&createPortal(
      <div className="mv-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget){setLoadoutOpen(false);loadoutTriggerRef.current?.focus()}}}>
        <section className="mv-item-modal mv-loadout-dialog" role="dialog" aria-modal="true" aria-labelledby="mv-loadout-dialog-title">
          <div className="mv-modal-header">
            <div className="mv-modal-heading"><HeartPulse size={24} aria-hidden="true"/><div>
              <span className="mv-modal-eyebrow">Character equipment</span>
              <h3 id="mv-loadout-dialog-title">Loadout Health</h3>
            </div></div>
            <button type="button" ref={loadoutCloseRef} className="mv-modal-close"
              aria-label="Close loadout health" onClick={()=>{setLoadoutOpen(false);loadoutTriggerRef.current?.focus()}}><X size={22}/></button>
          </div>
          <div className="mv-loadout-dialog-body">
            <LoadoutHealthPanel db={db} character={character} characterName={characterName}
              inventoryVersion={inventoryVersion} busy={busy||loading||unequipCheckPending}
              onReviewRemoval={assignmentId=>{
                const row=equipped.find(candidate=>candidate.id===assignmentId);
                setLoadoutOpen(false);
                if(row)void requestUnequip(row);
              }}/>
          </div>
        </section>
      </div>,document.body)}
    {tab==='character'&&potionEditorOpen&&createPortal(
      <div className="mv-modal-backdrop" onMouseDown={event=>{
        if(event.target===event.currentTarget&&potionSlotBusy===null){
          setPotionEditorOpen(false);potionEditorTriggerRef.current?.focus();
        }
      }}>
        <section className="mv-item-modal mv-potion-dialog" role="dialog" aria-modal="true"
          aria-labelledby="mv-potion-dialog-title">
          <div className="mv-modal-header">
            <div className="mv-modal-heading"><FlaskConical size={24} aria-hidden="true"/><div>
              <span className="mv-modal-eyebrow">Character quick access</span>
              <h3 id="mv-potion-dialog-title">Edit Potions</h3>
            </div></div>
            <button type="button" ref={potionEditorCloseRef} className="mv-modal-close"
              aria-label="Close potion editor" disabled={potionSlotBusy!==null}
              onClick={()=>{setPotionEditorOpen(false);potionEditorTriggerRef.current?.focus()}}><X size={22}/></button>
          </div>
          <div className="mv-modal-body mv-potion-dialog-body">
            <p>Choose which potion type belongs in each quick-access slot. Assigning or clearing a slot does not consume a potion.</p>
            {[1,2,3,4].map(slot=>{
              const assignment=potionHotbar.slots.find(row=>row.slot===slot);
              const assignedOption=potionHotbar.options.find(row=>row.definition_id===assignment?.definition_id);
              return <label key={slot} htmlFor={`mv-potion-slot-${slot}`} className="mv-potion-dialog-field">
                <span>Slot {slot}</span>
                <select id={`mv-potion-slot-${slot}`} value={assignment?.definition_id??''}
                  disabled={loading||busy||potionSlotBusy!==null||potionUseBusy!==null}
                  onChange={event=>void assignPotionSlot(slot,event.target.value)}>
                  <option value="">Empty slot</option>
                  {assignment?.definition_id&&!assignedOption&&
                    <option value={assignment.definition_id}>{assignment.name??'Unavailable potion'} (0)</option>}
                  {potionHotbar.options.map(candidate=><option key={candidate.definition_id} value={candidate.definition_id}>
                    {candidate.name} ({candidate.quantity})
                  </option>)}
                </select>
              </label>;
            })}
            {potionError&&<p className="mv-storage-error" role="alert">Unable to save potion assignment: {potionError}</p>}
          </div>
          <div className="mv-modal-footer">
            <button type="button" disabled={potionSlotBusy!==null}
              onClick={()=>{setPotionEditorOpen(false);potionEditorTriggerRef.current?.focus()}}>Done</button>
          </div>
        </section>
      </div>,document.body)}
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
            {equippedByItem.has(selectedItem.item_id)?<button type="button" className="mv-modal-action-button" disabled={busy||loading} onClick={()=>{const row=equippedByItem.get(selectedItem.item_id);if(row){closeDetails();void requestUnequip(row)}}}>Unequip</button>:
              selectedItem.eligible&&!loading&&(validSlots[selectedItem.item_id]||[]).length>0?
                <div className="mv-modal-action-field">
                  <label htmlFor="mv-detail-equip">Equip to slot</label>
                  <select id="mv-detail-equip" aria-label={`Equip ${selectedItem.display_name}`} value="" disabled={busy} onChange={event=>{const slotId=event.target.value;if(slotId)onEquip(selectedItem.item_id,slotId)}}>
                    <option value="">Choose equipment slot…</option>
                    {slots.filter(slot=>(validSlots[selectedItem.item_id]||[]).includes(slot.id)).map(slot=><option key={slot.id} value={slot.id}>{slot.label}</option>)}
                  </select>
                </div>:null}
            {!detailsLoading&&itemDetails?.item_id===selectedItem.item_id&&itemDetails.can_consume&&!equippedByItem.has(selectedItem.item_id)&&
              <div className="mv-modal-action-field">
                <button type="button" className="mv-modal-action-button" disabled={busy||useBusy}
                  onClick={()=>{setUseItemId(selectedItem.item_id);setUseQuantity('1');setUseError('');setTrashItemId(null);setPendingStorageMove(null)}}>Use / Consume…</button>
                {useItemId===selectedItem.item_id&&<div className="mv-trash-confirm" role="group" aria-label="Confirm item use">
                  <strong>Use {selectedItem.display_name}</strong>
                  <p>Deducts the selected quantity from inventory and records it in activity. In-game effects are not automatically applied.</p>
                  <label htmlFor="mv-use-quantity">Quantity to use (of {numberText(selectedItem.quantity)})</label>
                  <input id="mv-use-quantity" type="number" min="1" max={Number(selectedItem.quantity)} step="1"
                    value={useQuantity} disabled={useBusy} onChange={e=>setUseQuantity(e.target.value)}/>
                  {useError&&<p className="mv-storage-error" role="alert">{useError}</p>}
                  <div className="mv-trash-confirm-actions">
                    <button type="button" disabled={useBusy} onClick={()=>{setUseItemId(null);setUseError('')}}>Cancel</button>
                    <button type="button" disabled={busy||useBusy||!Number.isSafeInteger(Number(useQuantity))||Number(useQuantity)<1||Number(useQuantity)>Number(selectedItem.quantity)}
                      onClick={()=>void confirmItemUse()}>{useBusy?'Using…':`Confirm use · ${useQuantity}`}</button>
                  </div>
                </div>}
              </div>}
            {!loading&&!equippedByItem.has(selectedItem.item_id)&&storage[selectedItem.item_id]&&!storage[selectedItem.item_id].is_container&&
              ['gear','consumable','ammunition','material','component','misc','supplies'].includes(itemCategories[selectedItem.item_id]??'')&&
              Number(selectedItem.quantity)>1&&<div className="mv-modal-action-field">
                <button type="button" className="mv-modal-action-button" disabled={busy||splitBusy}
                  onClick={()=>{setSplitItemId(selectedItem.item_id);setSplitQuantity('1');setSplitError('')}}>Split stack…</button>
                {splitItemId===selectedItem.item_id&&<div className="mv-stack-split-confirm">
                  <label htmlFor="mv-detail-split-quantity">Quantity to split</label>
                  <input id="mv-detail-split-quantity" type="number" min="1" max={Number(selectedItem.quantity)-1}
                    step="1" value={splitQuantity} onChange={e=>setSplitQuantity(e.target.value)}/>
                  <p>Creates a separate stack. Compatible stacks combine automatically when items are acquired or moved into the same location.</p>
                  {splitError&&<p className="mv-storage-error" role="alert">{splitError}</p>}
                  <div className="mv-trash-confirm-actions">
                    <button type="button" onClick={()=>setSplitItemId(null)}>Cancel</button>
                    <button type="button" disabled={splitBusy||!Number.isSafeInteger(Number(splitQuantity))||
                      Number(splitQuantity)<1||Number(splitQuantity)>=Number(selectedItem.quantity)}
                      onClick={()=>void splitSelectedStack()}>{splitBusy?'Splitting…':'Confirm split'}</button>
                  </div>
                </div>}
              </div>}
            {!loading&&!equippedByItem.has(selectedItem.item_id)&&storage[selectedItem.item_id]&&!storage[selectedItem.item_id].is_container&&<>
              {storage[selectedItem.item_id].container_item_id&&
                <button type="button" className="mv-modal-action-button" disabled={busy} onClick={()=>chooseStorageMove(selectedItem.item_id,null)}>Take out</button>}
              <div className="mv-modal-action-field">
                <label htmlFor="mv-detail-storage">{storage[selectedItem.item_id]?.container_item_id?'Move to…':'Put in…'}</label>
                <select id="mv-detail-storage" aria-label={`Move or discard ${selectedItem.display_name}`} value=""
                  disabled={busy||trashBusy}
                  onChange={event=>{
                    const target=event.target.value;
                    if(target==='__trash__'){
                      setPendingStorageMove(null);setTrashItemId(selectedItem.item_id);setTrashQuantity(String(selectedItem.quantity));setTrashError('');
                    }else if(target)chooseStorageMove(selectedItem.item_id,target);
                  }}>
                  <option value="">Choose destination…</option>
                  {storageContainers.filter(container=>container.item_id!==selectedItem.item_id&&container.item_id!==storage[selectedItem.item_id]?.container_item_id).map(container=><option key={container.item_id} value={container.item_id}>{container.display_name}</option>)}
                  <option value="__trash__">Trash / Discard…</option>
                </select>
                {pendingStorageMove?.itemId===selectedItem.item_id&&<div className="mv-trash-confirm" role="group" aria-label="Choose quantity to move">
                  <strong>Move {selectedItem.display_name} {pendingStorageMove.destination?'into '+(storageContainers.find(c=>c.item_id===pendingStorageMove.destination)?.display_name??'container'):'to carried inventory'}</strong>
                  <label htmlFor="mv-storage-move-quantity">Quantity to move (of {numberText(selectedItem.quantity)})</label>
                  <input id="mv-storage-move-quantity" type="number" min="1" max={Number(selectedItem.quantity)} step="1"
                    value={storageMoveQuantity} disabled={storageMoveBusy} onChange={e=>setStorageMoveQuantity(e.target.value)}/>
                  {storageActionError&&<p className="mv-storage-error" role="alert">{storageActionError}</p>}
                  <div className="mv-trash-confirm-actions">
                    <button type="button" disabled={storageMoveBusy} onClick={()=>{setPendingStorageMove(null);setStorageActionError('')}}>Cancel</button>
                    <button type="button" disabled={busy||storageMoveBusy||!Number.isSafeInteger(Number(storageMoveQuantity))||Number(storageMoveQuantity)<1||Number(storageMoveQuantity)>Number(selectedItem.quantity)}
                      onClick={()=>void confirmStorageMove()}>{storageMoveBusy?'Moving…':`Move ${storageMoveQuantity}`}</button>
                  </div>
                </div>}
                {trashItemId===selectedItem.item_id&&<div className="mv-trash-confirm" role="group" aria-label="Confirm item disposal">
                  <div className="mv-trash-confirm-heading"><Trash2 size={17} aria-hidden="true"/><strong>Discard {selectedItem.display_name}?</strong></div>
                  <p>This permanently removes the selected quantity. It cannot be undone.</p>
                  <label htmlFor="mv-trash-quantity">Quantity to discard</label>
                  <input id="mv-trash-quantity" type="number" min="1" step="1" max={Number(selectedItem.quantity)}
                    value={trashQuantity} disabled={trashBusy} onChange={event=>setTrashQuantity(event.target.value)}/>
                  {trashError&&<p className="mv-storage-error" role="alert">{trashError}</p>}
                  <div className="mv-trash-confirm-actions">
                    <button type="button" disabled={trashBusy} onClick={()=>{setTrashItemId(null);setTrashError('')}}>Cancel</button>
                    <button type="button" className="mv-trash-confirm-button"
                      disabled={busy||trashBusy||!Number.isSafeInteger(Number(trashQuantity))||Number(trashQuantity)<1||Number(trashQuantity)>Number(selectedItem.quantity)}
                      onClick={()=>void confirmItemTrash()}>{trashBusy?'Discarding…':`Confirm trash · ${trashQuantity}`}</button>
                  </div>
                </div>}
              </div>
            </>}
            {!detailsLoading&&equipRequirements.length>0&&<div className="mv-item-requirements">
              <h4>Equipment Requirements</h4>
              {equipRequirements.map(rule=><div className="mv-item-requirement-row" key={rule.attribute_code}>
                <span>{rule.attribute_code}: Projected {rule.projected_score??'unset'} / Required {rule.required_score}</span>
                <strong className={rule.is_met?'mv-requirement-met':'mv-requirement-unmet'}>{rule.is_met?'Met':'Not met'}</strong>
              </div>)}
              <small>For {equipRequirements[0]?.slot_label}: currently {equipRequirements.map(rule=>`${rule.attribute_code} ${rule.current_score??'unset'}`).join(', ')}. Projected scores remove bonuses from items that would be replaced.</small>
            </div>}
            {requirementsError&&<p className="mv-storage-error" role="alert">Cannot load equipment requirements: {requirementsError}</p>}
            {!detailsLoading&&equipPreview.length>0&&!equippedByItem.has(selectedItem.item_id)&&<details className="mv-equip-preview">
              <summary>Equip Preview <small>Check slots and replacements</small></summary>
              <p className="mv-equip-preview-note">Read-only preview. No equipment will be changed until you select an eligible slot above.</p>
              {equipPreview.map(option=><div key={option.slot_id} className="mv-equip-preview-option">
                <div className="mv-equip-preview-heading">
                  <strong>{option.slot_label}</strong>
                  <span className={option.can_equip?'mv-equip-preview-yes':'mv-equip-preview-no'}>{option.can_equip?'Eligible':'Blocked'}</span>
                </div>
                <p>{option.reason}</p>
                {option.can_equip&&option.replaced_items.length>0&&<p className="mv-equip-preview-replace">Would unequip: {option.replaced_items.join(', ')}</p>}
              </div>)}
            </details>}
            {equipPreviewError&&<p className="mv-storage-error" role="alert">Equip preview unavailable: {equipPreviewError}</p>}

            {!loading&&!equippedByItem.has(selectedItem.item_id)&&selectedItem.eligible&&(validSlots[selectedItem.item_id]||[]).length===0&&
              !equipRequirements.some(rule=>!rule.is_met)&&
              <div className="mv-modal-action-note">
                <strong>Cannot equip this item.</strong>
                <p>No eligible equipment slot. Check slot compatibility and conflicts with currently equipped items.</p>
              </div>}
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
