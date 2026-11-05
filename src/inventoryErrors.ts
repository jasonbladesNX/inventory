/** Convert PostgREST/Supabase errors (often plain objects) to safe, readable text. */
const generic='Unable to complete this action. Please try again.';
const invalidMessage=(value:string)=>/^(\[object Object\]|object Object|undefined|null)$/i.test(value.trim());

export function inventoryErrorMessage(error:unknown):string {
  const strings:string[]=[];
  const seen=new Set<unknown>();
  function collect(value:unknown, depth:number):void{
    if(depth>5||value==null||seen.has(value))return;
    if(typeof value==='string'){
      const text=value.trim();
      if(!text||invalidMessage(text))return;
      if((text.startsWith('{')&&text.endsWith('}'))||(text.startsWith('[')&&text.endsWith(']'))){
        try{collect(JSON.parse(text) as unknown,depth+1);return}catch{ /* ordinary error text */ }
      }
      strings.push(text);
      return;
    }
    if(typeof value!=='object')return;
    seen.add(value);
    const record=value as Record<string,unknown>;
    for(const key of ['message','details','hint','error_description','error','cause'])collect(record[key],depth+1);
  }
  collect(error,0);
  const message=strings.find(value=>/Container capacity exceeded:/i.test(value))??strings[0];
  if(!message)return generic;
  const capacity=message.match(/Container capacity exceeded:\s*([\d.]+) lb\s*\+\s*([\d.]+) lb exceeds ([\d.]+) lb/i);
  if(capacity)return `Not enough room in this container. The item weighs ${capacity[2]} lb, the container holds ${capacity[3]} lb, and ${capacity[1]} lb is already inside.`;
  if(message.includes('Container contains items with unknown weights'))return 'This container has an item with no recorded weight. Take it out or set its weight before adding more items.';
  if(message.includes('Item weight is missing or invalid'))return 'This item has no valid weight recorded and cannot be stored in a weight-limited container.';
  return message;
}
