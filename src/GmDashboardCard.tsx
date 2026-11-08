import React,{useId,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import './gm-dashboard-card.css';
export default function GmDashboardCard({title,children,initiallyOpen=false}:{title:string;children:React.ReactNode;initiallyOpen?:boolean}){
 const [open,setOpen]=useState(initiallyOpen);
 const contentId=useId();
 return <section className="nx-gm-collapsible" aria-label={title}>
  <button type="button" className="nx-gm-collapsible-toggle" aria-expanded={open} aria-controls={contentId} onClick={()=>setOpen(v=>!v)}>
   <span>{title}</span><ChevronDown size={19} aria-hidden="true"/>
  </button>
  <div id={contentId} className="nx-gm-collapsible-content" hidden={!open}>{children}</div>
 </section>;
}
