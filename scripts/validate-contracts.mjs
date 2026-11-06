import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(path,'utf8');
const main=read('src/main.tsx');const trade=read('src/Trading.tsx');
const checks=[
 ['no live settlement RPC in UI',!/rpc\(['"](?:finalize_approved_trade|settle_item_trade|claim_loot_qr)['"]/.test(main+trade)],
 ['version-pinned trade approvals',trade.includes("rpc('accept_trade_offer_version'")&&trade.includes('p_expected_version:t.offer_version')],
 ['campaign-scoped trade recipients',/db\.rpc\('list_trade_recipients',\{p_campaign:(?:c|id)\}\)/.test(main)],
 ['scoped inventory reader',main.includes("rpc('list_character_inventory_for_trade',{p_character:ch})")],
 ['counteroffer access',trade.includes("rpc('counter_trade_offer'")],
 ['cancel access',trade.includes("rpc('cancel_trade_offer'")],
 ['trade labels access',trade.includes("rpc<TradeLabel[]>('list_trade_item_labels'")],
 ['approved layout still bundled',read('browser-preview.html').includes('NEXUS')],
];
let errors=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)errors++}
if(errors)process.exit(1);
