import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDown,ArrowUp,Download,Search,X,Printer,Layers,Star} from 'lucide-react';
import './inventory-workbench.css';

export type WorkbenchItem={item_id:string;display_name:string;quantity:number|string;eligible:boolean};
export type WorkbenchStorage={item_id:string;container_item_id:string|null;is_container:boolean;location_name:string};
export type WorkbenchUsage={container_item_id:string;used_weight_lb:number|string;capacity_weight_lb:number|string|null;item_count:number;unknown_weight_count:number};
export type WorkbenchIndicator={item_id:string;condition_code:string;identified:boolean;unit_weight_lb:number|string|null};
type Props={
  characterName:string;items:WorkbenchItem[];
  categories:Record<string,string>;categoryNames?:Record<string,string>;storage:Record<string,WorkbenchStorage>;
  usage:Record<string,WorkbenchUsage>;indicators:Record<string,WorkbenchIndicator>;
  sortMetadata:Record<string,{unit_value:string|null;stackable:boolean;definition_id:string}>;
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
// Sort common D&D denominations on a shared GP scale. Generic numeric values
// are supported; unspecified and unrecognized values always sort last.
function valueInGp(raw:string|null|undefined):number|null{
  if(!raw)return null;
  const m=raw.replace(/,/g,'').trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(pp|gp|ep|sp|cp)?$/i);
  if(!m)return null;
  const unit=(m[2]||'gp').toLowerCase();
  const factor:Record<string,number>={pp:10,gp:1,ep:.5,sp:.1,cp:.01};
  const n=Number(m[1])*factor[unit];
  return Number.isFinite(n)?n:null;
}
export default function InventoryWorkbench({characterName,items,categories,categoryNames={},storage,usage,indicators,sortMetadata,equippedIds,favoriteIds,busy,renderItem}:Props){
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('all');
  const [location,setLocation]=useState('all');
  const [favoritesOnly,setFavoritesOnly]=useState(false);
  const [sortField,setSortField]=useState<'name'|'value'|'weight'>('name');
  const [sortDirection,setSortDirection]=useState<'asc'|'desc'>('asc');
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
    if(favoritesOnly&&!favoriteIds.has(id))return false;
    if(location==='carried'&&where)return false;
    if(location!=='all'&&location!=='carried'&&where!==location)return false;
    return true;
  }).sort((a,b)=>{
    const direction=sortDirection==='asc'?1:-1;
    if(sortField==='name')return direction*a.display_name.localeCompare(b.display_name);
    const metric=(item:WorkbenchItem)=>{
      if(sortField==='value'){
        const value=valueInGp(sortMetadata[item.item_id]?.unit_value);
        return value===null?null:value*num(item.quantity);
      }
      const unit=indicators[item.item_id]?.unit_weight_lb;
      return unit==null?null:num(unit)*num(item.quantity);
    };
    const av=metric(a),bv=metric(b);
    if(av===null&&bv!==null)return 1;
    if(bv===null&&av!==null)return -1;
    if(av===null&&bv===null)return a.display_name.localeCompare(b.display_name);
    return direction*((av??0)-(bv??0))||a.display_name.localeCompare(b.display_name);
  }),[items,categories,storage,indicators,sortMetadata,search,category,location,sortField,sortDirection,favoritesOnly,favoriteIds]);
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
  const clear=()=>{setSearch('');setCategory('all');setLocation('all');setFavoritesOnly(false);setSortField('name');setSortDirection('asc');setViewMode('location')};
  const toggleSort=(field:'name'|'value'|'weight')=>{if(field===sortField)setSortDirection(v=>v==='asc'?'desc':'asc');else{setSortField(field);setSortDirection('asc')}};
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
  const showList=(list:WorkbenchItem[],label:string,showHeading=true)=>{
    if(!list.length)return null;
    return <section className="mv-inventory-group" aria-label={label} key={label}>
      {showHeading&&<div className="mv-inventory-group-heading nx-inventory-group-heading"><h4>{label}</h4></div>}
      <div className="mv-inventory-items">{list.map(item=><div className="nx-workbench-row" key={item.item_id}>
        {renderItem(item,setLocation)}
      </div>)}</div>
    </section>;
  };
  return <div className="nx-inventory-workbench">
    <div className="nx-inventory-filters">
      <div className="nx-inventory-search">
        <div><Search size={17} aria-hidden="true"/><input id="nx-inventory-search" type="search"
          aria-label="Search inventory" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search here..."/></div>
      </div>
      <label>Item type
        <select value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="all">All item types ({items.length})</option>
          {availableCategories.map(c=><option key={c} value={c}>{categoryNames[c]??categoryLabels[c]??c} ({items.filter(item=>(categories[item.item_id]??'unknown')===c).length})</option>)}
        </select>
      </label>
    </div>
    <div className="nx-inventory-toolbar">
      {location!=='all'&&<button type="button" onClick={()=>setLocation('all')}>All locations</button>}
      <button type="button" onClick={clear}><X size={15}/> Reset filters</button>
      <button type="button" className={'nx-favorites-only'+(favoritesOnly?' is-active':'')}
        aria-label={favoritesOnly?'Show all items':'Show favorites only'} title={favoritesOnly?'Show all items':'Favorites only'}
        aria-pressed={favoritesOnly} onClick={()=>setFavoritesOnly(value=>!value)}>
        <Star size={18} fill={favoritesOnly?'currentColor':'none'} aria-hidden="true"/>
      </button>
      <button type="button" aria-label={reportOpen?'Close inventory report':'Open inventory report'} title="Inventory report" onClick={()=>setReportOpen(v=>!v)}><Printer size={17} aria-hidden="true"/></button>
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
    <div className="nx-inventory-list-heading">
      <h4>ITEMS AND EQUIPMENT</h4>
      <div className="nx-inventory-list-controls">
        <div className="nx-inventory-group-toolbar">
          <label htmlFor="nx-workbench-grouping"><Layers size={15} aria-hidden="true"/> Group Results</label>
          <select id="nx-workbench-grouping" value={viewMode} onChange={e=>setViewMode(e.target.value as 'location'|'category'|'flat')}>
            <option value="location">By storage location</option>
            <option value="category">By item type</option>
            <option value="flat">One list</option>
          </select>
        </div>
        <div className="nx-inventory-sort-options" role="group" aria-label="Sort inventory items">
          {(['name','value','weight'] as const).map(field=><button type="button" key={field}
            className={sortField===field?'is-active':''} aria-pressed={sortField===field}
            aria-label={`Sort by ${field}, ${sortField===field?(sortDirection==='asc'?'descending':'ascending'):'ascending'}`}
            onClick={()=>toggleSort(field)}>
            {field.toUpperCase()}
            {sortField===field&&(sortDirection==='asc'?<ArrowUp size={14} aria-hidden="true"/>:<ArrowDown size={14} aria-hidden="true"/>)}
          </button>)}
        </div>
      </div>
    </div>
    {matches.length===0?<p className="mv-empty nx-inventory-no-match">{favoritesOnly?'No favorite items match these filters.':'No items match these filters.'}</p>:
      viewMode==='flat'?showList(matches,'Items and equipment',false):
      viewMode==='category'?availableCategories.map(code=>
        showList(matches.filter(item=>(categories[item.item_id]??'unknown')===code),categoryNames[code]??categoryLabels[code]??code)
      ):
      location==='all'?<>
        {showList(matches.filter(item=>!storage[item.item_id]?.container_item_id),'Items and equipment',false)}
        {containers.map(container=>showList(matches.filter(item=>storage[item.item_id]?.container_item_id===container.item_id),'Inside '+container.display_name))}
      </>:showList(matches,location==='carried'?'Items and equipment':'Container contents',false)}
  </div>;
}
