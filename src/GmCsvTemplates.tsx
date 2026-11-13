import React from 'react';
import {Download,FileSpreadsheet,Info} from 'lucide-react';
import {downloadGmTemplateCsv,gmCsvTemplates} from './gmCsvTemplateSpecs';
import './gm-csv-templates.css';

/** Milestone 8.1: download-only GM templates; no upload or mutation operations. */
export default function GmCsvTemplates(){
  return <section className="nx-page-card nx-gm-tools nx-gm-csv-templates" aria-label="GM CSV templates">
    <h2><FileSpreadsheet size={20} aria-hidden="true"/> GM CSV Templates</h2>
    <p>Download a blank CSV or a filled example for each type of campaign inventory data. Files use stable, machine-readable column names so that future GM import tools can validate them.</p>
    <p className="nx-csv-scope-note"><Info size={16} aria-hidden="true"/>
      Milestone 8.1 provides downloads only. For Item Catalog and Character Inventory uploads, open GM CSV Imports (Milestone 8.2). Shop Inventory uploads are now available in Milestone 8.3; Treasure/QR Loot uploads remain planned for Milestone 8.4.
    </p>
    <div className="nx-gm-csv-grid">
      {gmCsvTemplates.map(template=><article key={template.id} className="nx-gm-csv-card">
        <div className="nx-gm-csv-card-heading">
          <h3>{template.title}</h3>
          <p>{template.summary}</p>
        </div>
        <div className="nx-gm-csv-buttons">
          <button type="button" onClick={()=>downloadGmTemplateCsv(template,false)}
            aria-label={`Download blank ${template.title} CSV template`}>
            <Download size={16} aria-hidden="true"/> Blank CSV
          </button>
          <button type="button" className="nx-gm-csv-example-button" onClick={()=>downloadGmTemplateCsv(template,true)}
            aria-label={`Download example ${template.title} CSV template`}>
            <Download size={16} aria-hidden="true"/> Example CSV
          </button>
        </div>
        <details className="nx-gm-csv-guide">
          <summary>View columns and instructions ({template.columns.length})</summary>
          <div className="nx-gm-csv-table-wrap">
            <table>
              <thead><tr><th scope="col">Column</th><th scope="col">Required</th><th scope="col">Purpose</th></tr></thead>
              <tbody>{template.columns.map(col=><tr key={col.key}>
                <th scope="row"><code>{col.key}</code></th>
                <td>{col.required?'Yes':'Conditional / optional'}</td>
                <td>{col.description}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="nx-gm-csv-notes">
            {template.notes.map(note=><p key={note}>{note}</p>)}
          </div>
        </details>
      </article>)}
    </div>
    <p className="nx-small-note">CSV guidelines: UTF-8 with a header row; one entry per row; keep column names unchanged; use true/false for checkboxes and plain numeric values for quantities and prices. Excel and similar programs can open these files. Sample merchant, character and item names are illustrative and may not exist in your campaign.</p>
  </section>;
}
