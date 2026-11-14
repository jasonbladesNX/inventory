import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const schema=read('docs/sql/phase10_zone_initiative.sql');
const integration=read('docs/sql/phase10_initiative_zone_turn_integration.sql');
const main=read('src/main.tsx');
const gm=read('src/GmInitiativeManager.tsx');
const player=read('src/CharacterInitiative.tsx');
const character=read('src/CharacterScreen.tsx');
for(const table of ['character_initiative_preferences','zone_initiative_sessions','zone_initiative_entries','zone_initiative_events']){
 assert.ok(schema.includes('create table public.'+table),table+' missing');
 assert.ok(schema.includes('alter table public.'+table+' enable row level security'),table+' RLS missing');
}
for(const rpc of ['set_character_initiative_modifier','get_character_initiative','get_zone_initiative','manage_zone_initiative']){
 assert.ok(schema.toLowerCase().includes('function public.'+rpc),rpc+' missing');
}
assert.ok(schema.includes('app_private.is_gm(p_campaign)'));
assert.ok(schema.includes('for update'));
assert.ok(schema.includes('unique(zone_id,request_id)'));
assert.ok(schema.includes("v_item->>'unit'='round'"));
assert.ok(schema.includes("v_item->>'remaining'"));
assert.ok(schema.includes("raise exception 'Roster changed"));
assert.ok(schema.includes("v_ready<>v_count"));
assert.ok(schema.includes('order by score desc,modifier desc,roll desc,character_id'));
assert.ok(schema.includes('if p_action='));
assert.ok(schema.includes("p_action='reorder'"));
assert.ok(integration.includes("'next_with_zone_turn'"));
assert.ok(integration.includes("perform public.manage_campaign_zone(p_campaign,'advance'"));
assert.ok(integration.includes("v_item->>'unit'='round'"));
assert.ok(integration.includes("p_request is null"));
assert.ok(main.includes('<GmInitiativeManager db={db!} campaign={campaign}/>'));
assert.ok(character.includes('<CharacterInitiative db={db} campaign={campaign} character={character}'));
assert.ok(player.includes('get_character_initiative'));
assert.ok(player.includes('set_character_initiative_modifier'));
assert.ok(player.includes("p_action:'roll'"));
assert.ok(player.includes('setInterval'));
for(const op of ['request','start','adjust','reorder','next','next_with_zone_turn','close']){
 assert.ok(gm.includes("'"+op+"'"),'GM action '+op+' missing');
}
assert.ok(gm.includes('crypto.randomUUID()'));
console.log('Phase 10 initiative structural regression passed.');
