/**
 * Milestone 8.1 — GM CSV exchange contracts.
 *
 * These schemas are download-only. Import, duplicate resolution and writes
 * belong to milestones 8.2–8.5. Keep column names stable once importers ship.
 */
export type GmCsvColumn={
  key:string;
  required:boolean;
  description:string;
};
export type GmCsvTemplate={
  id:'catalog'|'character-inventory'|'shop-stock'|'loot-contents';
  title:string;
  summary:string;
  columns:readonly GmCsvColumn[];
  examples:readonly (readonly string[])[];
  notes:readonly string[];
};

export const gmCsvTemplates:readonly GmCsvTemplate[]=[
  {
    id:'catalog',
    title:'GM Item Catalog',
    summary:'Create campaign-specific homebrew item definitions. Does not duplicate the ruleset/SRD catalog.',
    columns:[
      {key:'item_name',required:true,description:'Name to display for the new campaign item.'},
      {key:'category',required:true,description:'Built-in category code (gear, ingredient, consumable, weapon, armor, ring, etc.) or an existing active custom category code.'},
      {key:'description',required:false,description:'Description displayed in item details. The future importer will need to support saving this field.'},
      {key:'stackable',required:true,description:'true or false. Consumables must be stackable; equippable/special items cannot be.'},
      {key:'consumable',required:true,description:'true or false; usable items deduct inventory on use.'},
      {key:'two_handed',required:false,description:'true or false; relevant to weapons only. Leave blank for false.'},
      {key:'bonus_attribute',required:false,description:'Attribute code, for example STR. Leave empty when no passive bonus applies.'},
      {key:'bonus_amount',required:false,description:'Numeric bonus corresponding to bonus_attribute; do not provide for a consumable.'}
    ],
    examples:[
      ['Field Rations','gear','A small ration pack, suitable for a long trek.','true','false','false','',''],
      ['Alchemist Draught','consumable','A simple usable potion; configure its effect separately.','true','true','false','',''],
      ['Ring of Might','ring','A ring that grants a modest bonus to strength.','false','false','false','STR','1']
    ],
    notes:[
      'Campaign-specific categories must exist before importing items that use them.',
      'This initial contract handles ordinary item flags and one optional passive attribute bonus; complex use effects and additional properties will be addressed with the import implementation.',
      'Equippable items and rings are never stackable; consumables must be stackable.'
    ]
  },
  {
    id:'character-inventory',
    title:'Character Inventory',
    summary:'Grant several different catalog items and quantities to characters in the selected campaign.',
    columns:[
      {key:'character_name',required:false,description:'Existing character name. Required if character_id is blank; must resolve uniquely within the campaign.'},
      {key:'character_id',required:false,description:'Optional character UUID; use to disambiguate characters with the same name.'},
      {key:'item_name',required:false,description:'Existing campaign or ruleset item name. Required if item_definition_id is blank and must resolve uniquely.'},
      {key:'item_definition_id',required:false,description:'Optional item definition UUID; preferred when different items share a name.'},
      {key:'quantity',required:true,description:'Whole number greater than zero. Equippable items become separate inventory instances.'}
    ],
    examples:[
      ['Example Adventurer','','Longsword','','1'],
      ['Example Adventurer','','Potion of Healing','','4'],
      ['Example Wizard','','Rope, Hempen (50 feet)','','2']
    ],
    notes:[
      'The character and item must already exist in the active campaign or its ruleset.',
      'Characters and items can be referenced by unique names or by UUID. If both are supplied, the future importer will verify they refer to the same record.',
      'The importer will need to batch grants safely, preserve stackability and record inventory activity.'
    ]
  },
  {
    id:'shop-stock',
    title:'Shop Inventory & Prices',
    summary:'Plan merchandise, stock, buyback settings and prices for existing campaign merchants.',
    columns:[
      {key:'merchant_name',required:false,description:'Existing campaign merchant name; required if merchant_id is blank.'},
      {key:'merchant_id',required:false,description:'Optional campaign merchant UUID to disambiguate names.'},
      {key:'item_name',required:false,description:'Existing item definition name; required if item_definition_id is blank.'},
      {key:'item_definition_id',required:false,description:'Optional item definition UUID to disambiguate names.'},
      {key:'currency_code',required:true,description:'Existing campaign currency code, e.g., GP; currency must already be configured.'},
      {key:'unit_price',required:true,description:'Price for one unit; nonnegative and compatible with currency precision.'},
      {key:'buyback_price',required:true,description:'Nonnegative price paid by merchant when buying this item back.'},
      {key:'quantity',required:true,description:'Whole-number stock between 0 and 1,000,000 (0 indicates no stock).'},
      {key:'buys_from_players',required:true,description:'true or false.'}
    ],
    examples:[
      ['Example Trading Post','','Potion of Healing','','GP','50','25','12','true'],
      ['Example Trading Post','','Longsword','','GP','15','7.5','3','false']
    ],
    notes:[
      'Examples use fictional merchants. Create the merchant and currency in the GM Dashboard before trying future imports.',
      'Pricing uses the selected currency denomination; prices must not exceed 1,000,000,000.',
      'Whether repeated rows overwrite or increment existing stock will be chosen during import preview in Milestone 8.3.'
    ]
  },
  {
    id:'loot-contents',
    title:'Treasure & QR Loot Contents',
    summary:'Describe items and currency in QR loot containers, including several containers per file.',
    columns:[
      {key:'container_name',required:false,description:'Name of the existing or new loot container; required when container_id is blank.'},
      {key:'container_id',required:false,description:'Optional existing QR loot source UUID for an unclaimed, active container.'},
      {key:'entry_type',required:true,description:'Use item or currency. Each row represents one kind of reward.'},
      {key:'item_name',required:false,description:'For item rows only: existing item definition name unless item_definition_id is supplied.'},
      {key:'item_definition_id',required:false,description:'For item rows only: optional item definition UUID.'},
      {key:'quantity',required:false,description:'For item rows only: whole number from 1 to 500 per row (current add-loot operation limit).'},
      {key:'currency_code',required:false,description:'For currency rows only: existing campaign currency code.'},
      {key:'currency_amount',required:false,description:'For currency rows only: positive amount in that denomination, subject to its precision.'}
    ],
    examples:[
      ['Example Ancient Chest','','item','Potion of Healing','','2','',''],
      ['Example Ancient Chest','','item','Longsword','','1','',''],
      ['Example Ancient Chest','','currency','','','','GP','35'],
      ['Example Hidden Cache','','currency','','','','SP','120']
    ],
    notes:[
      'Each container can have multiple item and currency rows. The import preview will determine how new containers are created or existing ones updated.',
      'Only active, unclaimed containers can be modified. The CSV never contains QR claim tokens or character account information.',
      'QR codes are generated separately in the GM Dashboard after review of imported contents.'
    ]
  }
];

const escapeCsv=(value:string):string=>{
  const safe=value.replace(/\r\n?/g,'\n');
  return /[",\n]/.test(safe)?'"'+safe.replace(/"/g,'""')+'"':safe;
};

/** Generate a clean UTF-8 CSV. The downloaded file prepends BOM for Excel. */
export function makeGmTemplateCsv(template:GmCsvTemplate,example=false):string{
  const rows=[template.columns.map(col=>col.key)];
  if(example){
    for(const row of template.examples){
      if(row.length!==template.columns.length)throw new Error('CSV example column mismatch: '+template.id);
      rows.push([...row]);
    }
  }
  return rows.map(row=>row.map(escapeCsv).join(',')).join('\r\n')+'\r\n';
}

export function downloadGmTemplateCsv(template:GmCsvTemplate,example=false):void{
  const csv='\uFEFF'+makeGmTemplateCsv(template,example);
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='nexus-gm-'+template.id+(example?'-example':'-blank')+'.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
