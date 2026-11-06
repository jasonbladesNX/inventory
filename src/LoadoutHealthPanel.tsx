import React,{useEffect,useMemo,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AlertTriangle,CheckCircle2,ChevronDown,ChevronUp,ClipboardCopy,RefreshCw,ShieldAlert,ShieldCheck,Unlink} from 'lucide-react';
import {inventoryErrorMessage} from './inventoryErrors';
import './loadout-health.css';

type AuditRow={
  assignment_id:string;item_id:string;item_name:string;slot_name:string;
  issue_type:'none'|'minimum_attribute'|'forbidden_category'|'invalid_configuration';
  attribute_code:string|null;required_score:number|null;current_score:number|string|null;
  conflicting_item:string|null;is_met:boolean;explanation:string;
};
type DependencyRow={
  source_assignment_id:string;source_item:string;dependent_item:string;
  attribute_code:string;required_score:number;current_score:number|string;projected_score:number|string;
};
type Props={
  db:SupabaseClient;character:string;inventoryVersion:number;
  busy:boolean;onReviewRemoval:(assignmentId:string)=>void;
};
function numberLabel(value:number|string|null):string{
  if(value===null)return 'unset';
  const number=Number(value);
  return Number.isFinite(number)?number.toLocaleString(undefined,{maximumFractionDigits:2}):String(value);
}
export default function LoadoutHealthPanel({db,character,inventoryVersion,busy,onReviewRemoval}:Props){
  const [audit,setAudit]=useState<AuditRow[]>([]);
  const [dependencies,setDependencies]=useState<DependencyRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const [showAll,setShowAll]=useState(false);
  const [repair,setRepair]=useState<AuditRow|null>(null);
  const [copyStatus,setCopyStatus]=useState('');
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);setError('');setRepair(null);setCopyStatus('');
      try{
        const [checks,links]=await Promise.all([
          db.rpc('list_character_loadout_audit',{p_character:character}),
          db.rpc('list_character_equipment_dependency_map',{p_character:character})
        ]);
        if(checks.error)throw checks.error;
        if(links.error)throw links.error;
        if(!cancelled){setAudit(Array.isArray(checks.data)?checks.data as AuditRow[]:[]);setDependencies(Array.isArray(links.data)?links.data as DependencyRow[]:[])}
      }catch(e){if(!cancelled){setAudit([]);setDependencies([]);setError(inventoryErrorMessage(e))}}
      finally{if(!cancelled)setLoading(false)}
    }
    void load();
    return()=>{cancelled=true};
  },[db,character,inventoryVersion,revision]);
  const items=useMemo(()=>{
    const map=new Map<string,AuditRow[]>();
    for(const row of audit)map.set(row.assignment_id,[...(map.get(row.assignment_id)||[]),row]);
    return [...map.values()].sort((a,b)=>a[0].item_name.localeCompare(b[0].item_name));
  },[audit]);
  const issues=audit.filter(row=>!row.is_met);
  const invalidItems=new Set(issues.map(row=>row.assignment_id));
  const visible=items.filter(rows=>showAll||invalidItems.has(rows[0].assignment_id));
  const dependencySourceIds=new Set(dependencies.map(row=>row.source_assignment_id));
  function reportText(){
    const lines=['Nexus Multiverse — Equipment Loadout Health','Character: '+character,'Status: '+(invalidItems.size?'Review required':'All recorded requirements met'),''];
    for(const rows of items){
      const first=rows[0];
      lines.push(first.item_name+' ('+first.slot_name+')');
      for(const row of rows)lines.push('  '+(row.is_met?'PASS':'FAIL')+' — '+row.explanation);
      const outgoing=dependencies.filter(row=>row.source_assignment_id===first.assignment_id);
      for(const row of outgoing)lines.push('  DEPENDENCY — '+row.dependent_item+' needs '+row.attribute_code+' '+row.required_score+'; removal projects '+numberLabel(row.projected_score));
    }
    lines.push('','Report is a snapshot of the current loadout. No items were changed.');
    return lines.join('\n');
  }
  async function copyReport(){
    setCopyStatus('');
    try{
      await navigator.clipboard.writeText(reportText());
      setCopyStatus('Loadout report copied.');
    }catch{setCopyStatus('Clipboard unavailable in this browser.')}
  }
  return <section className="mv-panel nx-loadout-health" aria-labelledby="nx-loadout-health-title">
    <div className="nx-loadout-heading">
      <h3 id="nx-loadout-health-title"><ShieldCheck size={20}/> Loadout Health</h3>
      <button type="button" disabled={loading||busy} onClick={()=>setRevision(n=>n+1)} aria-label="Refresh loadout health"><RefreshCw size={16}/> Refresh</button>
    </div>
    {loading?<p className="mv-empty">Checking equipped item requirements and dependencies…</p>:
      error?<p role="alert" className="mv-storage-error">Unable to load loadout health: {error}</p>:
      <>
        <div className="nx-loadout-metrics">
          <div><strong>{items.length}</strong><span>Equipped items</span></div>
          <div className={invalidItems.size?'nx-loadout-flagged':''}><strong>{invalidItems.size}</strong><span>Items needing attention</span></div>
          <div><strong>{dependencies.length}</strong><span>Active dependencies</span></div>
        </div>
        {invalidItems.size>0?<p className="nx-loadout-warning"><AlertTriangle size={18}/> {invalidItems.size} {invalidItems.size===1?'equipped item does':'equipped items do'} not meet current requirements. No equipment will be removed automatically.</p>:
          <p className="nx-loadout-healthy"><CheckCircle2 size={18}/> All configured equipped-item requirements are satisfied.</p>}
        <div className="nx-loadout-controls">
          <button type="button" className={showAll?'nx-loadout-active':''} onClick={()=>setShowAll(v=>!v)}>
            {showAll?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
            {showAll?'Show issues only':'Show all equipped items'}
          </button>
          <button type="button" onClick={()=>{void copyReport()}}><ClipboardCopy size={16}/> Copy report</button>
        </div>
        {copyStatus&&<p className="nx-loadout-copy" role="status">{copyStatus}</p>}
        {visible.length===0?<p className="nx-loadout-empty">{showAll?'No equipped items found.':'No unmet requirements. Select “Show all equipped items” to review the complete audit.'}</p>:
          <div className="nx-loadout-list">{visible.map(rows=>{
            const first=rows[0], invalid=rows.filter(row=>!row.is_met), sourceLinks=dependencies.filter(row=>row.source_assignment_id===first.assignment_id);
            return <div key={first.assignment_id} className={'nx-loadout-entry'+(invalid.length?' nx-loadout-entry-invalid':'')}>
              <div className="nx-loadout-item-heading">
                <strong>{first.item_name}</strong>
                <span>{first.slot_name}</span>
                {invalid.length?<span className="nx-loadout-status-invalid"><ShieldAlert size={14}/> Needs attention</span>:
                  <span className="nx-loadout-status-valid"><CheckCircle2 size={14}/> Valid</span>}
              </div>
              {rows.filter(row=>row.issue_type!=='none').map((row,i)=><p key={i} className={row.is_met?'nx-loadout-detail-ok':'nx-loadout-detail-bad'}>
                {row.is_met?<CheckCircle2 size={15}/>:<AlertTriangle size={15}/>}
                {row.explanation}
              </p>)}
              {rows.every(row=>row.issue_type==='none')&&<p className="nx-loadout-minor">No special requirements configured.</p>}
              {sourceLinks.map((link,i)=><p key={i} className="nx-loadout-link">
                <Unlink size={15}/> Supports {link.dependent_item}: {link.attribute_code} {numberLabel(link.current_score)} → {numberLabel(link.projected_score)} if removed (requires {link.required_score})
              </p>)}
              {invalid.length>0&&<button type="button" className="nx-loadout-repair" disabled={busy} onClick={()=>setRepair(first)}>Review unequip to resolve</button>}
            </div>;
          })}</div>}
        {dependencies.length>0&&<details className="nx-loadout-dependencies">
          <summary>Equipment dependency map ({dependencies.length})</summary>
          {dependencies.map((link,i)=><p key={i}><strong>{link.source_item}</strong> supports <strong>{link.dependent_item}</strong> — {link.attribute_code} {numberLabel(link.current_score)} → {numberLabel(link.projected_score)} if removed; requires {link.required_score}</p>)}
        </details>}
        {repair&&<div className="nx-loadout-repair-confirm" role="group" aria-label="Guided loadout repair">
          <strong>Review proposed repair</strong>
          <p>Unequip <b>{repair.item_name}</b>? This removes only that item. Any additional dependencies will be checked before removal. No other equipment will be changed automatically.</p>
          <div>
            <button type="button" onClick={()=>setRepair(null)}>Cancel</button>
            <button type="button" disabled={busy} onClick={()=>{
              const assignment=repair.assignment_id;
              setRepair(null);
              onReviewRemoval(assignment);
            }}>Continue to unequip</button>
          </div>
        </div>}
      </>}
  </section>;
}
