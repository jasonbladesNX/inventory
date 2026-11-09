import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,Search,Scale,ShieldAlert,X,Printer,Layers} from 'lucide-react';
import './inventory-workbench.css';

export type WorkbenchItem={item_id:string;display_name:string;quantity:number|string;eligible:boolean};
export type WorkbenchStorage={item_id:string;container_item_id:string|null;is_container:boolean;location_name:string};
export type WorkbenchUsage={container_item_id:string;used_weight_lb:number|string;capacity_weight_lb:number|string|null;item_count:number;unknown_weight_count:number};
export type WorkbenchIndicator={item_id:string;condition_code:string;identified:boolean;unit_weight_lb:number|string|null};
type Props={
  characterName:string;items:WorkbenchItem[];
  categories:Record<string,string>;categoryNames?:Record<string,string>;storage:Record<string,WorkbenchStorage>;
  usage:Record<string,WorkbenchUsage>;indicators:Record<string,WorkbenchIndicator>;
  equippedIds:Set<string>;favoriteIds:Set<string>;busy:boolean;
  renderItem:(item:WorkbenchItem,onBrowseContainer:(id:string)=>void)=>React.ReactNode;
};
const categoryLabels:Record<string,string>={
 weapon:'Weapons',shield:'Shields',armor:'Armor',clothing:'Clothing',headgear:'Headgear',
 jewelry:'Jewelry',ring:'Rings',footwear:'Footwear',focus:'Focus items',tool:'Tools',
 wondrous:'Wondrous items',gear:'General gear',ingredient:'Ingredients',container:'Containers',recipe:'Recipes',unknown:'Other'
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
export default function InventoryWorkbench({characterName,items,categories,categoryNames={},storage,usage,indicators,equippedIds,favoriteIds,busy,renderItem}:Props){
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('all');
  const [location,setLocation]=useState('all');
  const [status,setStatus]=useState('all');
  const [sort,setSort]=useState('name_asc');
  const [exportMessage,setExportMessage]=useState('');
  const [viewMode,setViewMode]=useState<'location'|'category'|'flat'>('location');
  const [reportOpen,setReportOpen]=useState(false);
  const reportCloseRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!reportOpen)return;
    const frame=window.requestAnimationFrame(()=>reportCloseRef.current?.focus());
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setReportOpen(false)}
      if(event.key==='Tab'){
        const buttons=reportCloseRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        if(!buttons?.length)return;
        if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons[buttons.length-1].focus()}
        else if(!event.shiftKey&&document.activeElement===buttons[buttons.length-1]){event.preventDefault();buttons[0].focus()}
      }
    };
    document.addEventListener('keydown',onKey);
    return()=>{window.cancelAnimationFrame(frame);document.removeEventListener('keydown',onKey)};
  },[reportOpen]);
  useEffect(()=>{if(location!=='all'&&location!=='carried'&&!items.some(item=>item.item_id===location&&storage[item.item_id]?.is_container))setLocation('all')},[items,storage,location]);
  const availableCategories=[...new Set(items.map(item=>categories[item.item_id]??'unknown'))].sort((a,b)=>
    (categoryNames[a]??categoryLabels[a]??a).localeCompare(categoryNames[b]??categoryLabels[b]??b));
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
      case 'weight_desc':return (weight(b)==null?Number.NEGATIVE_INFINITY:num(weight(b)))-(weight(a)==null?Number.NEGATIVE_INFINITY:num(weight(a)))||a.display_name.localeCompare(b.display_name);
      case 'weight_asc':return aw-bw||a.display_name.localeCompare(b.display_name);
      default:return a.display_name.localeCompare(b.display_name);
    }
  }),[items,categories,storage,indicators,equippedIds,favoriteIds,search,category,location,status,sort]);
  const filteredUnits=matches.reduce((sum,item)=>sum+num(item.quantity),0);
  const knownFilteredWeight=matches.reduce((sum,item)=>{
    const unit=indicators[item.item_id]?.unit_weight_lb;
    return sum+(unit==null?0:num(unit)*num(item.quantity));
  },0);
  const filteredUnknownWeight=matches.filter(item=>indicators[item.item_id]?.unit_weight_lb==null).length;
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
  const clear=()=>{setSearch('');setCategory('all');setLocation('all');setStatus('all');setSort('name_asc');setViewMode('location')};
  const printableSummary=[
    'Nexus Multiverse Inventory Report',
    'Character: '+characterName,
    'Visible entries: '+matches.length+'; units: '+filteredUnits,
    'Known weight: '+knownFilteredWeight.toFixed(2)+' lb'+(filteredUnknownWeight?' (incomplete: '+filteredUnknownWeight+' entries have unknown unit weight)':''),
    '',
    ...matches.map(item=>{
      const id=item.item_id;
      const loc=equippedIds.has(id)?'Equipped':storage[id]?.container_item_id?'Stored in '+storage[id].location_name:'Carried';
      return item.display_name+' | '+(categories[id]??'unknown')+' | Qty '+item.quantity+' | '+loc;
    })
  ].join('\n');
  const showList=(list:WorkbenchItem[],label:string)=>{
    if(!list.length)return null;
    return <section className="mv-inventory-group" aria-label={label} key={label}>
      <div className="mv-inventory-group-heading"><h4>{label}</h4><span>{list.length} items</span></div>
      <div className="mv-inventory-items">{list.map(item=><div className="nx-workbench-row" key={item.item_id}>
        {renderItem(item,setLocation)}
      </div>)}</div>
    </section>;
  };
  return <div className="nx-inventory-workbench">
    <div className="nx-inventory-filters">
      <label>Item type
        <select value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="all">All item types ({items.length})</option>
          {availableCategories.map(c=><option key={c} value={c}>{categoryNames[c]??categoryLabels[c]??c} ({items.filter(item=>(categories[item.item_id]??'unknown')===c).length})</option>)}
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
          <option value="unequipped">Loose, not equipped</option>
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
    <div className="nx-inventory-top-controls">
    <div className="nx-inventory-search">
      <label htmlFor="nx-inventory-search">Search inventory</label>
      <div><Search size={17} aria-hidden="true"/><input id="nx-inventory-search" type="search" value={search}
        onChange={e=>setSearch(e.target.value)} placeholder="Item name…"/></div>
    </div>
    <div className="nx-inventory-group-toolbar">
      <label htmlFor="nx-workbench-grouping"><Layers size={16} aria-hidden="true"/> Group results</label>
      <select id="nx-workbench-grouping" value={viewMode} onChange={e=>setViewMode(e.target.value as 'location'|'category'|'flat')}>
        <option value="location">By storage location</option>
        <option value="category">By item type</option>
        <option value="flat">One list</option>
      </select>
    </div>
    </div>
    <div className="nx-inventory-weight-overview" role="status">
      <Scale size={17} aria-hidden="true"/>
      <span>{filteredUnits.toLocaleString()} visible units · At least {knownFilteredWeight.toFixed(2)} lb</span>
      {filteredUnknownWeight>0&&<span className="nx-inventory-weight-warning">{filteredUnknownWeight} entries with unknown weight</span>}
    </div>
    <div className="nx-inventory-toolbar">
      <span>{matches.length} of {items.length} item entries shown</span>
      <button type="button" onClick={clear}><X size={15}/> Reset filters</button>
      <button type="button" onClick={()=>setReportOpen(v=>!v)}><Printer size={15}/> {reportOpen?'Close report':'Report'}</button>
    </div>
    {reportOpen&&createPortal(<div className="mv-modal-backdrop">
      <section className="mv-item-modal nx-inventory-report-dialog" role="dialog" aria-modal="true" aria-labelledby="nx-inventory-report-heading">
        <div className="mv-modal-header">
          <div className="mv-modal-heading"><Printer size={24} aria-hidden="true"/><div>
            <span className="mv-modal-eyebrow">Character inventory</span>
            <h3 id="nx-inventory-report-heading">Inventory report</h3>
          </div></div>
          <button type="button" className="mv-modal-close" ref={reportCloseRef} aria-label="Close inventory report" onClick={()=>setReportOpen(false)}><X size={21}/></button>
        </div>
        <div className="nx-inventory-report-dialog-body">
          <div className="nx-inventory-print-report" aria-label="Inventory report">
            <div className="nx-inventory-report-header">
              <strong>{characterName}</strong>
              <div className="nx-inventory-report-actions">
                <button type="button" onClick={downloadCsv} disabled={busy||matches.length===0}><Download size={15}/> Export CSV</button>
                <button type="button" onClick={()=>window.print()}><Printer size={15}/> Print report</button>
              </div>
            </div>
            <pre>{printableSummary}</pre>
            <p>Snapshot of currently visible items. Unknown weights are excluded from the known-weight subtotal.</p>
            {exportMessage&&<p className="nx-inventory-feedback" role="status">{exportMessage}</p>}
          </div>
        </div>
      </section>
    </div>,document.body)}
    {matches.length===0?<p className="mv-empty nx-inventory-no-match">No items match these filters.</p>:
      viewMode==='flat'?showList(matches,'All matching items'):
      viewMode==='category'?availableCategories.map(code=>
        showList(matches.filter(item=>(categories[item.item_id]??'unknown')===code),categoryNames[code]??categoryLabels[code]??code)
      ):
      location==='all'?<>
        {showList(matches.filter(item=>!storage[item.item_id]?.container_item_id),'Carried & Equipped')}
        {containers.map(container=>showList(matches.filter(item=>storage[item.item_id]?.container_item_id===container.item_id),'Inside '+container.display_name))}
      </>:showList(matches,location==='carried'?'Carried & Equipped':'Container contents')}
  </div>;
}
