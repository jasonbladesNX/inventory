/** Extract readable text from thrown Supabase/PostgREST errors (which need not be Error instances). */
export function inventoryErrorMessage(error:unknown):string {
  const fallback='Unable to complete this action. Please try again.';
  if (typeof error==='string') return error.trim()||fallback;
  if (!error || typeof error!=='object') return fallback;
  const record=error as Record<string,unknown>;
  const message=[record.message,record.details,record.hint].find(value=>typeof value==='string'&&value.trim()) as string|undefined;
  if(!message){
    if(record.error&&record.error!==error)return inventoryErrorMessage(record.error);
    return fallback;
  }
  const capacity=message.match(/^Container capacity exceeded:\s*([\d.]+) lb \+ ([\d.]+) lb exceeds ([\d.]+) lb$/i);
  if(capacity){
    return `Not enough room in this container. The item weighs ${capacity[2]} lb, the container holds ${capacity[3]} lb, and ${capacity[1]} lb is already inside.`;
  }
  if(message==='Container contains items with unknown weights'){
    return 'This container has an item with no recorded weight. Take it out or set its weight before adding more items.';
  }
  if(message==='Item weight is missing or invalid; set its weight before storing'){
    return 'This item has no valid weight recorded and cannot be stored in a weight-limited container.';
  }
  return message;
}
