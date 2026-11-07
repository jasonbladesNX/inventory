import React,{useEffect,useMemo,useState} from 'react';
import {ArrowDownAZ,ArrowDownWideNarrow,Backpack,Check,ClipboardList,Download,Heart,PackageOpen,Search,Scale,ShieldAlert,Star, X} from 'lucide-react';
import './inventory-workbench.css';

export type WorkbenchItem={item_id:string;display_name:string;quantity:number|string;eligible:boolean};
export type WorkbenchStorage={item_id:string;container_item_id:string|null;is_container:boolean;location_name:string};
export type WorkbenchUsage={container_item_id:string;used_weight_lb:number|string;capacity_weight_lb:number|string|null;item_count:number;unknown_weight_count:number};
export type WorkbenchIndicator={item_id:string;condition_code:string;identified:boolean;unit_weight_lb:number|string|null};
type Props={
  characterName:string;items:WorkbenchItem[];
  categories:Record<string,string>;storage:Record<string,WorkbenchStorage>;
  usage:Record<string,WorkbenchUsage>;indicators:Record<string,WorkbenchIndicator>;
  equippedIds:Set<string>;favoriteIds:Set<string>;busy:boolean;
  renderItem:(item:WorkbenchItem)=>React.ReactNode;
  onOpenDetails:(itemId:string,event:React.MouseEvent<HTMLButtonElement>)=>void;
};
const categoryLabels:Record<string,string>={
 weapon:'Weapons',shield:'Shields',armor:'Armor',clothing:'Clothing',headgear:'Headgear',
 jewelry:'Jewelry',ring:'Rings',footwear:'Footwear',focus:'Focus items',tool:'Tools',
 wondrous:'Wondrous items',gear:'General gear',container:'Containers',unknown:'Other'
};
function num(value:number|string|null|undefined):number{
  if(value===null||value===undefined)return 0;
  const n=Number(value);return Number.isFinite(n)?n:0;
}
function csvCell(value:unknown):string{
  let v=String(value??'');
  // Protect spreadsheet viewers from interpreting inventory names as formulas.
  if(/^[\s]*[=+@-]/.test(v))v="'"+v;
  return '"'+v.replace(/"/g,'""')+'"';
}
export default function InventoryWorkbench({characterName,items,categories,storage,usage,indicators,equippedIds,favoriteIds,busy,renderItem,onOpenDetails}:Props){
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('all');
  const [location,setLocation]=useState('all');
  const [status,setStatus]=useState('all');
  const [sort,setSort]=useState('name_asc');
  const [compare,setCompare]=useState<string[]>([]);
  const [exportMessage,setExportMessage]=useState('');
  useEffect(()=>{setCompare(old=>old.filter(id=>items.some(item=>item.item_id===id)))},[items]);
  useEffect(()=>{if(location!=='all'&&location!=='carried'&&!items.some(item=>item.item_id===location&&storage[item.item_id]?.is_container))setLocation('all')},[items,storage,location]);
  const availableCategories=[...new Set(items.map(item=>categories[item.item_id]??'unknown'))].sort((a,b)=>
    (categoryLabels[a]??a).localeCompare(categoryLabels[b]??b));
  const containers=items.filter(item=>storage[item.item_id]?.is_container&&!storage[item.item_id]?.container_item_id);
  const matches=useMemo(()=>items.filter(item=>{
    const id=item.item_id;
    const where=storage[id]?.container_item_id;
    const actualCategory=categories[id]??'unknown';
    if(search.trim()&&!item.display_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))return false;
    if(category!=='all'&&actualCategory!==category)return false;
    if(location==='carried'&&where)return false;
    if(location!=='all'&&location!=='carried'&&where!==location)return false;
    if(status==='favorites'&&!favoriteIds.has(id))return false;
    if(status==='equipped'&&!equippedIds.has(id))return false;
    if(status==='unequipped'&&(equippedIds.has(id)||where||storage[id]?.is_container))return false;
    if(status==='stored'&&!where)return false;
    if(status==='unknown_weight'&&indicators[id]?.unit_weight_lb!==null&&indicators[id]?.unit_weight_lb!==undefined)return false;
    return true;
  }).sort((a,b)=>{
    const weight=(item:WorkbenchItem)=>indicators[item.item_id]?.unit_weight_lb;
    const aw=weight(a)==null?Number.POSITIVE_INFINITY:num(weight(a)),bw=weight(b)==null?Number.POSITIVE_INFINITY:num(weight(b));
    switch(sort){
      case 'name_desc':return b.display_name.localeCompare(a.display_name);
      case 'quantity_desc':return num(b.quantity)-num(a.quantity)||a.display_name.localeCompare(b.display_name);
      case 'quantity_asc':return num(a.quantity)-num(b.quantity)||a.display_name.localeCompare(b.display_name);
      case 'weight_desc':return (weight(a)==null?Number.NEGATIVE_INFINITY:num(weight(a)))-(weight(b)==null?Number.NEGATIVE_INFINITY:num(weight(b)))||a.display_name.localeCompare(b.display_name);
      case 'weight_asc':return aw-bw||a.display_name.localeCompare(b.display_name);
      default:return a.display_name.localeCompare(b.display_name);
    }
  }),[items,categories,storage,indicators,equippedIds,favoriteIds,search,category,location,status,sort]);
  const storedCount=items.filter(item=>Boolean(storage[item.item_id]?.container_item_id)).length;
  const missingWeights=items.filter(item=>indicators[item.item_id]?.unit_weight_lb==null).length;
  const totalQuantity=items.reduce((sum,item)=>sum+num(item.quantity),0);
  const compareItems=compare.map(id=>items.find(item=>item.item_id===id)).filter((item):item is WorkbenchItem=>Boolean(item));
  const availableContainers=containers.map(item=>({item,info:usage[item.item_id]}));
  function toggleCompare(itemId:string,checked:boolean){
    setCompare(old=>checked?old.includes(itemId)?old:[...old.slice(-1),itemId]:old.filter(id=>id!==itemId));
  }
  function downloadCsv(){
    const columns=['Item','Category','Quantity','Status','Stored in','Condition','Identified','Unit weight (lb)','Favorite'];
    const rows=matches.map(item=>{
      const id=item.item_id;
      return [item.display_name,categories[id]??'unknown',item.quantity,
        equippedIds.has(id)?'Equipped':storage[id]?.container_item_id?'Stored':'Carried',
        storage[id]?.container_item_id?storage[id].location_name:'',indicators[id]?.condition_code??'',
        indicators[id]?.identified===false?'No':'Yes',indicators[id]?.unit_weight_lb??'',
        favoriteIds.has(id)?'Yes':'No'];
    });
    const csv=[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;
    anchor.download='nexus-'+characterName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-inventory.csv';
    document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
    setExportMessage('Exported '+rows.length+' visible items to CSV.');
  }
  const clear=()=>{setSearch('');setCategory('all');setLocation('all');setStatus('all');setSort('name_asc')};
  const showList=(list:WorkbenchItem[],label:string)=>{
    if(!list.length)return null;
    return <section className="mv-inventory-group" aria-label={label} key={label}>
      <div className="mv-inventory-group-heading"><h4>{label}</h4><span>{list.length} items</span></div>
      <div className="mv-inventory-items">{list.map(item=><div className="nx-workbench-row" key={item.item_id}>
        {renderItem(item)}
        <label className="nx-compare-label"><input type="checkbox" aria-label={'Compare '+item.display_name}
          checked={compare.includes(item.item_id)} onChange={e=>toggleCompare(item.item_id,e.target.checked)}/>
          Compare</label>
      </div>)}</div>
    </section>;
  };
  return <div className="nx-inventory-workbench">
    <div className="nx-inventory-metrics" aria-label="Inventory overview">
      <div><strong>{items.length}</strong><span>Item entries</span></div>
      <div><strong>{totalQuantity.toLocaleString()}</strong><span>Total units</span></div>
      <div><strong>{storedCount}</strong><span>Stored items</span></div>
      <div><strong>{favoriteIds.size}</strong><span>Favorites</span></div>
    </div>
    <div className="nx-inventory-search">
      <label htmlFor="nx-inventory-search">Search inventory</label>
      <div><Search size={18} aria-hidden="true"/><input id="nx-inventory-search" type="search" value={search}
        onChange={e=>setSearch(e.target.value)} placeholder="Search by item name…"/></div>
    </div>
    <div className="nx-inventory-filters">
      <label>Item type
        <select value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="all">All item types ({items.length})</option>
          {availableCategories.map(c=><option key={c} value={c}>{categoryLabels[c]??c} ({items.filter(item=>(categories[item.item_id]??'unknown')===c).length})</option>)}
        </select>
      </label>
      <label>Where
        <select value={location} onChange={e=>setLocation(e.target.value)}>
          <option value="all">All locations</option>
          <option value="carried">Carried &amp; equipped</option>
          {containers.map(item=><option key={item.item_id} value={item.item_id}>Inside {item.display_name}</option>)}
        </select>
      </label>
      <label>Show
        <select value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="equipped">Equipped only</option>
          <option value="unequipped">Available to equip</option>
          <option value="stored">Inside containers</option>
          <option value="favorites">Favorites only</option>
          <option value="unknown_weight">Missing weight</option>
        </select>
      </label>
      <label>Sort
        <select value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="name_asc">Name A → Z</option>
          <option value="name_desc">Name Z → A</option>
          <option value="quantity_desc">Quantity (most)</option>
          <option value="quantity_asc">Quantity (least)</option>
          <option value="weight_asc">Unit weight (lightest)</option>
          <option value="weight_desc">Unit weight (heaviest)</option>
        </select>
      </label>
    </div>
    <div className="nx-inventory-toolbar">
      <span>{matches.length} of {items.length} item entries shown</span>
      <button type="button" onClick={clear}><X size={15}/> Reset filters</button>
      <button type="button" onClick={downloadCsv} disabled={busy||matches.length===0}><Download size={15}/> Export visible CSV</button>
    </div>
    {exportMessage&&<p className="nx-inventory-feedback" role="status">{exportMessage}</p>}
    {availableContainers.length>0&&<details className="nx-container-utilization">
      <summary><Scale size={17}/> Container utilization ({availableContainers.length})</summary>
      {availableContainers.map(({item,info})=>{
        const used=num(info?.used_weight_lb),capacity=info?.capacity_weight_lb==null?null:num(info.capacity_weight_lb);
        const pct=capacity&&capacity>0?100*used/capacity:null;
        const caution=Number(info?.unknown_weight_count??0)>0||(pct!==null&&pct>=90);
        return <div key={item.item_id} className={'nx-container-health'+(caution?' is-warning':'')}>
          <div><strong>{item.display_name}</strong><span>{used.toLocaleString()} / {capacity===null?'unknown':capacity.toLocaleString()} lb</span></div>
          {pct!==null&&<div role="progressbar" aria-label={'Capacity used in '+item.display_name} aria-valuemin={0} aria-valuemax={capacity??0} aria-valuenow={Math.min(used,capacity??0)}><span style={{width:Math.min(pct,100)+'%'}}/></div>}
          {caution&&<small><ShieldAlert size={14}/> {Number(info?.unknown_weight_count??0)>0?'Contains items with unknown weight.':'Container is at least 90% full.'}</small>}
        </div>;
      })}
      {missingWeights>0&&<p className="nx-container-weight-note">{missingWeights} item entries lack a known unit weight. Weight-based sorting and estimates may be incomplete.</p>}
    </details>}
    {matches.length===0?<p className="mv-empty nx-inventory-no-match">No items match these filters.</p>:
      location==='all'?<>
        {showList(matches.filter(item=>!storage[item.item_id]?.container_item_id),'Carried & Equipped')}
        {containers.map(container=>showList(matches.filter(item=>storage[item.item_id]?.container_item_id===container.item_id),'Inside '+container.display_name))}
      </>:showList(matches,location==='carried'?'Carried & Equipped':'Container contents')}
    {compareItems.length>0&&<section className="nx-inventory-compare" aria-labelledby="nx-inventory-compare-title">
      <div className="nx-inventory-compare-head"><h4 id="nx-inventory-compare-title"><ClipboardList size={17}/> Item comparison ({compareItems.length}/2)</h4>
        <button type="button" onClick={()=>setCompare([])}>Clear selection</button></div>
      <div className="nx-inventory-compare-grid">{compareItems.map(item=>{
        const id=item.item_id,indicator=indicators[id],containerId=storage[id]?.container_item_id;
        return <div key={id}>
          <strong>{item.display_name}</strong>
          <dl><dt>Type</dt><dd>{categoryLabels[categories[id]??'unknown']??categories[id]??'Other'}</dd>
            <dt>Quantity</dt><dd>{item.quantity}</dd>
            <dt>Condition</dt><dd>{indicator?.condition_code??'Unknown'}</dd>
            <dt>Unit weight</dt><dd>{indicator?.unit_weight_lb==null?'Unknown':num(indicator.unit_weight_lb)+' lb'}</dd>
            <dt>Location</dt><dd>{equippedIds.has(id)?'Equipped':containerId?'Stored in '+storage[id].location_name:'Carried'}</dd>
          </dl>
          <button type="button" onClick={e=>onOpenDetails(id,e)}>Item details</button>
        </div>;
      })}</div>
      {compareItems.length===1&&<p>Select one more item to compare side by side.</p>}
    </section>}
  </div>;
}
