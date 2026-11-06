import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {BookOpen,Castle,ChevronLeft,Compass,Crown,Plus,ScrollText,Shield,UserRound} from 'lucide-react';
import {prioritizeStarterRulesets} from './rulesets';
import {inventoryErrorMessage} from './inventoryErrors';
import CharacterScreen,{type InventoryTab} from './CharacterScreen';
import EffectEditor from './EffectEditor';
import EffectEditorBoundary from './EffectEditorBoundary';
import ConnectionChecks from './ConnectionChecks';
import Trading from './Trading';
import './style.css';
import './app-pages.css';

const url=import.meta.env.VITE_SUPABASE_URL||'';
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'';
const ready=!!url&&!!key&&!key.startsWith('REPLACE');
const db=ready?createClient(url,key):null;
type Row={id:string;name:string;[key:string]:any};
type Page='landing'|'player'|'gm'|'create'|'play';
type Entry='player'|'gm'|'create';
const itemCategories=[['gear','General Gear'],['weapon','Weapon'],['shield','Shield'],['armor','Armor'],['clothing','Clothing'],['jewelry','Jewelry'],['ring','Ring'],['headgear','Headgear'],['footwear','Footwear'],['focus','Spellcasting Focus'],['tool','Tool'],['wondrous','Wondrous Item']];

function App(){
  const[page,setPage]=useState<Page>('landing');
  const[entry,setEntry]=useState<Entry>('player');
  const[activeTab,setActiveTab]=useState<InventoryTab>('character');
  const[gmAccess,setGmAccess]=useState(false);
  const[inventoryVersion,setInventoryVersion]=useState(0);
  const[session,setSession]=useState<any>(null);
  const[sessionReady,setSessionReady]=useState(false);
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[register,setRegister]=useState(false);
  const[systems,setSystems]=useState<any[]>([]);
  const[campaigns,setCampaigns]=useState<Row[]>([]);
  const[campaign,setCampaign]=useState('');
  const[chars,setChars]=useState<Row[]>([]);
  const[recipients,setRecipients]=useState<Row[]>([]);
  const[char,setChar]=useState('');
  const[items,setItems]=useState<any[]>([]);
  const[defs,setDefs]=useState<any[]>([]);
  const[slots,setSlots]=useState<any[]>([]);
  const[effects,setEffects]=useState<any[]>([]);
  const[campaignName,setCampaignName]=useState('');
  const[characterName,setCharacterName]=useState('');
  const[itemName,setItemName]=useState('');
  const[itemCategory,setItemCategory]=useState('gear');
  const[twoHanded,setTwoHanded]=useState(false);
  const[attr,setAttr]=useState('');
  const[bonus,setBonus]=useState('');
  const[selectedDef,setSelectedDef]=useState('');
  const[msg,setMsg]=useState('');
  const[busy,setBusy]=useState(false);
  const[campaignBusy,setCampaignBusy]=useState(false);

  async function run(fn:()=>Promise<unknown>){
    setBusy(true);setMsg('');
    try{await fn()}catch(e){setMsg(inventoryErrorMessage(e))}
    finally{setBusy(false)}
  }
  async function rpc(fn:string,args:Record<string,unknown>){
    if(!db)throw Error('Supabase not configured');
    const{data,error}=await db.rpc(fn,args);
    if(error)throw error;
    return data;
  }
  async function loadCampaigns(){
    if(!db)return;
    const result=await db.from('campaigns').select('id,name,owner_user_id,ruleset_version_id');
    if(result.error)throw result.error;
    setCampaigns(result.data||[]);
    return result.data||[];
  }
  async function loadCampaign(id:string){
    if(!db)return;
    setCampaignBusy(true);setGmAccess(false);
    setChar('');setItems([]);setEffects([]);setChars([]);setDefs([]);setSlots([]);
    try{
      const [people,catalog,equipment,account,membership,recipientQuery]=await Promise.all([
        db.from('characters').select('id,name,member_id').eq('campaign_id',id),
        db.from('item_definitions').select('id,name,category,code,source_info').eq('campaign_id',id),
        db.from('equipment_slot_definitions').select('id,label').eq('campaign_id',id),
        db.auth.getUser(),
        db.from('campaign_members').select('id,user_id,role,status').eq('campaign_id',id),
        db.rpc('list_trade_recipients',{p_campaign:id})
      ]);
      for(const result of [people,catalog,equipment,membership,recipientQuery])if(result.error)throw result.error;
      if(account.error)throw account.error;
      const me=account.data.user?.id;
      const memberships=(membership.data||[]).filter(m=>m.user_id===me&&m.status==='active');
      const owned=campaigns.some(c=>c.id===id&&c.owner_user_id===me);
      const gm=owned||memberships.some(m=>m.role==='gm'||m.role==='owner');
      const allowed=new Set(memberships.map(m=>m.id));
      setGmAccess(gm);
      setChars((people.data||[]).filter(person=>gm||allowed.has(person.member_id)));
      setRecipients(recipientQuery.data||[]);
      setDefs(catalog.data||[]);
      setSlots(equipment.data||[]);
    }finally{setCampaignBusy(false)}
  }
  async function chooseCampaign(id:string){
    setCampaign(id);
    setMsg('');
    if(!id){setGmAccess(false);setChars([]);setChar('');setDefs([]);setSlots([]);return}
    await run(()=>loadCampaign(id));
  }
  async function loadChar(c:string,ch:string){
    const own=await rpc('list_character_inventory_for_trade',{p_character:ch});
    setItems((own||[]).map((i:any)=>({...i,display_name:i.name})));
    setEffects(await rpc('list_character_effects',{p_character:ch}));
    setInventoryVersion(v=>v+1);
  }
  async function chooseCharacter(id:string){
    setChar(id);
    if(id)await run(()=>loadChar(campaign,id));
  }
  function navigate(next:Page){
    setMsg('');
    setPage(next);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function openEntry(next:Entry){
    setEntry(next);
    navigate(next==='create'?'create':next);
  }

  useEffect(()=>{
    if(!db){setSessionReady(true);return}
    void db.auth.getSession().then(({data})=>{setSession(data.session);setSessionReady(true)}).catch(e=>{setMsg(inventoryErrorMessage(e));setSessionReady(true)});
    const{data:{subscription}}=db.auth.onAuthStateChange((_event,s)=>setSession(s));
    return()=>subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    if(!session||!db)return;
    void Promise.all([
      db.from('ruleset_versions').select('id,version_label,configuration,game_systems(code,name)').eq('status','published'),
      loadCampaigns()
    ]).then(([result])=>{
      if(result.error)throw result.error;
      setSystems(prioritizeStarterRulesets((result.data||[]).map(s=>({...s,game_systems:Array.isArray(s.game_systems)?s.game_systems[0]||null:s.game_systems}))));
    }).catch(e=>setMsg(inventoryErrorMessage(e)));
  },[session]);
  useEffect(()=>{
    if(session)return;
    setCampaign('');setChar('');setGmAccess(false);setChars([]);setItems([]);
    if(sessionReady)setPage('landing');
  },[session,sessionReady]);

  const current=chars.find(c=>c.id===char);
  const selectedCampaign=campaigns.find(c=>c.id===campaign);
  const ownedCampaigns=campaigns.filter(c=>c.owner_user_id===session?.user?.id);
  const campaignRuleset=systems.find(s=>s.id===selectedCampaign?.ruleset_version_id);
  const effectPolicy=campaignRuleset?.configuration?.effect_resolution as {numeric_operations?:string[];supported_conditions?:string[]}|undefined;
  const effectOperations=Array.isArray(effectPolicy?.numeric_operations)?effectPolicy.numeric_operations.filter((value):value is string=>typeof value==='string'):['add','set'];
  const effectAttributes=Array.isArray(campaignRuleset?.configuration?.attributes)?campaignRuleset.configuration.attributes.filter((value:unknown):value is string=>typeof value==='string'):[];
  const allowsCategoryCondition=Array.isArray(effectPolicy?.supported_conditions)&&effectPolicy.supported_conditions.includes('requires_equipped_category');
  const displayName=selectedCampaign?.name||'Campaign';
  const isPlay=page==='play'&&Boolean(session&&campaign&&char);
  const signIn=<form className="nx-login-form" onSubmit={e=>{
    e.preventDefault();
    void run(async()=>{
      if(!db)throw Error('Supabase not configured');
      const result=register?await db.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+'/'}}):await db.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      if(register)setMsg('Account created. Check your email for confirmation if prompted.');
    })
  }}>
    <label>Email<input type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete={register?'new-password':'current-password'} required minLength={6} value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <button type="submit" disabled={busy}>{register?'Create account':'Sign in'}</button>
    <button type="button" className="nx-text-button" onClick={()=>setRegister(!register)}>{register?'Already registered? Sign in':'New account? Register'}</button>
    <p className="nx-small-note">The same Nexus account is used for both player and GM access. Campaign permissions determine which tools are available.</p>
  </form>;
  const campaignSelect=<label className="nx-form-field" htmlFor="nx-campaign-select">Campaign
    <select id="nx-campaign-select" value={campaign} disabled={campaignBusy||busy} onChange={e=>{void chooseCampaign(e.target.value)}}>
      <option value="">Choose a campaign…</option>
      {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  </label>;
  const characterSelect=<label className="nx-form-field" htmlFor="nx-character-select">Character
    <select id="nx-character-select" value={char} disabled={!campaign||campaignBusy||busy} onChange={e=>{void chooseCharacter(e.target.value)}}>
      <option value="">{campaignBusy?'Loading characters…':'Choose a character…'}</option>
      {chars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  </label>;
  return <div className={'nx-app'+(isPlay?' nx-app-playing':'')}>
    <header className="nx-app-header">
      <button type="button" className="nx-app-brand" onClick={()=>navigate('landing')} aria-label="Return to Nexus Multiverse landing page">NEXUS <span>MULTIVERSE</span></button>
      {session&&<button type="button" className="nx-header-exit" onClick={()=>{void db?.auth.signOut();navigate('landing')}}>Sign out</button>}
    </header>
    <main className="nx-page-content">
      {!ready?<section className="nx-page-card"><h1>Setup required</h1><p>Set the Supabase connection values for this deployment.</p></section>:
      !sessionReady?<section className="nx-page-card"><h1>Loading Nexus Multiverse…</h1></section>:
      page==='landing'?<section className="nx-entry-page">
        <div className="nx-landing-emblem"><Compass size={39}/></div>
        <p className="nx-overline">Nexus Game Lounge</p>
        <h1>YOUR ADVENTURE.<br/>YOUR INVENTORY.</h1>
        <p className="nx-landing-description">Manage your character, collect treasures and explore your campaign from one connected hub.</p>
        <div className="nx-entry-grid">
          <button type="button" className="nx-entry-card" onClick={()=>openEntry('player')}>
            <UserRound size={28}/><strong>Player Login</strong><span>Choose your campaign and character</span>
          </button>
          <button type="button" className="nx-entry-card" onClick={()=>openEntry('gm')}>
            <Shield size={28}/><strong>GM Login</strong><span>Campaign management and tools</span>
          </button>
          <div className="nx-entry-card nx-entry-disabled" aria-label="Create new campaign coming soon">
            <Castle size={28}/><strong>Create a New Campaign</strong><span>Coming soon from the landing screen</span>
          </div>
        </div>
        {session&&<p className="nx-session-hint">Signed in. Choose Player or GM to continue.</p>}
      </section>:
      !session?<section className="nx-page-card nx-auth-page">
        <button type="button" className="nx-back-link" onClick={()=>navigate('landing')}><ChevronLeft size={17}/> Back to landing</button>
        <div className="nx-page-icon">{entry==='gm'?<Shield/>:<UserRound/>}</div>
        <h1>{entry==='gm'?'GM Login':'Player Login'}</h1>
        <p>Sign in to your Nexus account to continue.</p>
        {signIn}
      </section>:
      page==='player'?<section className="nx-page-card nx-select-page">
        <button type="button" className="nx-back-link" onClick={()=>navigate('landing')}><ChevronLeft size={17}/> Landing</button>
        <div className="nx-page-icon"><UserRound/></div><h1>Player Portal</h1>
        <p>Select your campaign and character to enter the inventory interface.</p>
        <div className="nx-selection-form">{campaignSelect}{characterSelect}
          <button type="button" className="nx-primary-action" disabled={!campaign||!char||campaignBusy||busy} onClick={()=>{setActiveTab('character');navigate('play')}}>Enter Character</button>
        </div>
        {campaign&&!campaignBusy&&chars.length===0&&<p className="nx-small-note">No accessible characters were found in this campaign.</p>}
        <div className="nx-future-feature"><ScrollText size={20}/><div><strong>Request Character Transfer</strong><span>Coming soon — transfer characters between campaigns with GM approval.</span></div></div>
      </section>:
      page==='create'?<section className="nx-page-card nx-create-page">
        <button type="button" className="nx-back-link" onClick={()=>navigate('gm')}><ChevronLeft size={17}/> GM Dashboard</button>
        <div className="nx-page-icon"><Castle/></div><h1>Campaign Setup</h1>
        <p>Create the campaign and choose its game system. Character, item catalog and equipment-slot editing will remain in the GM Dashboard.</p>
        <form className="nx-selection-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
          const id=await rpc('create_inventory_campaign',{p_name:campaignName,p_ruleset:selectedDef});
          await loadCampaigns();setCampaign(id);await loadCampaign(id);
          setCampaignName('');setSelectedDef('');navigate('gm');
        })}}>
          <label className="nx-form-field">Campaign name<input required maxLength={120} value={campaignName} placeholder="The Lost Kingdom" onChange={e=>setCampaignName(e.target.value)}/></label>
          <label className="nx-form-field">Game system and ruleset
            <select required value={selectedDef} onChange={e=>setSelectedDef(e.target.value)}>
              <option value="">Choose ruleset…</option>
              {systems.map(s=><option key={s.id} value={s.id}>{s.game_systems?.name} — {s.version_label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy||!selectedDef}>Create Campaign</button>
        </form>
        <p className="nx-small-note">Additional first-time setup options can be added to this page as the campaign system expands.</p>
      </section>:
      page==='gm'?<section className="nx-gm-page">
        <div className="nx-page-card nx-gm-header">
          <button type="button" className="nx-back-link" onClick={()=>navigate('landing')}><ChevronLeft size={17}/> Landing</button>
          <div className="nx-page-icon"><Crown/></div><h1>GM Dashboard</h1>
          <p>Campaign management, character administration, catalog configuration and equipment effects.</p>
          {campaignSelect}
          <button type="button" className="nx-create-shortcut" onClick={()=>navigate('create')}><Plus size={18}/> Set Up New Campaign</button>
          {!campaign&&<p className="nx-small-note">Select a campaign to manage its resources.</p>}
        </div>
        {campaign&&!campaignBusy&&!gmAccess&&<section className="nx-page-card nx-warning"><Shield size={20}/><div><h2>GM permission required</h2><p>Your account doesn't have manager access to this campaign. Select another campaign or use the Player Portal.</p></div></section>}
        {campaign&&gmAccess&&!campaignBusy&&<>
          <section className="nx-page-card nx-gm-tools">
            <h2><UserRound size={20}/> Character Management</h2>
            {characterSelect}
            {char&&<button type="button" className="nx-secondary-action" onClick={()=>{setActiveTab('character');navigate('play')}}>Open Character Screen</button>}
            <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              await rpc('create_inventory_character',{p_campaign:campaign,p_name:characterName});
              await loadCampaign(campaign);setCharacterName('');
            })}}>
              <h3>Add Character</h3>
              <label>Character name<input required value={characterName} onChange={e=>setCharacterName(e.target.value)}/></label>
              <button type="submit" disabled={busy}>Create Character</button>
            </form>
          </section>
          <section className="nx-page-card nx-gm-tools">
            <h2><BookOpen size={20}/> GM Item Catalog</h2>
            <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              await rpc('create_campaign_equipment_item',{p_campaign:campaign,p_name:itemName,p_category:itemCategory,p_bonus_attribute:attr||null,p_bonus:bonus?Number(bonus):null,p_two_handed:itemCategory==='weapon'&&twoHanded});
              await loadCampaign(campaign);setItemName('');
            })}}>
              <label>New item name<input required value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New equipment item"/></label>
              <label>Equipment category
                <select value={itemCategory} onChange={e=>setItemCategory(e.target.value)}>
                  {itemCategories.map(([code,label])=><option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <label className="nx-checkbox"><input type="checkbox" checked={twoHanded} disabled={itemCategory!=='weapon'} onChange={e=>setTwoHanded(e.target.checked)}/> Two-handed weapon</label>
              <label>Bonus attribute (optional)<input placeholder="e.g. STR" value={attr} onChange={e=>setAttr(e.target.value)}/></label>
              <label>Bonus amount (optional)<input type="number" step="any" placeholder="e.g. 2" value={bonus} onChange={e=>setBonus(e.target.value)}/></label>
              <button type="submit" disabled={busy}>Create Catalog Item</button>
            </form>
          </section>
          <EffectEditorBoundary campaign={campaign}>
            <EffectEditor db={db!} campaign={campaign} definitions={defs}
              attributes={effectAttributes} operations={effectOperations}
              characters={chars} selectedCharacter={char}
              allowEquippedCategory={allowsCategoryCondition}
              onChanged={async()=>{if(char)await loadChar(campaign,char)}}/>
          </EffectEditorBoundary>
          <section className="nx-page-card nx-gm-tools">
            <h2><Shield size={20}/> Equipment Slots</h2>
            <p>{slots.map(s=>s.label).join(' · ')||'No slots configured yet.'}</p>
            <button type="button" className="nx-secondary-action" disabled={busy} onClick={()=>void run(async()=>{
              const code=window.prompt('Slot code, e.g. main_hand');
              if(!code)return;
              const label=window.prompt('Slot label',code)||code;
              await rpc('create_campaign_slot',{p_campaign:campaign,p_code:code,p_label:label});
              await loadCampaign(campaign);
            })}>Add Slot</button>
          </section>
          {char&&<section className="nx-page-card nx-gm-tools">
            <h2><Plus size={20}/> Grant Item to Character</h2>
            <label className="nx-form-field">Catalog item<select id="nx-grant-definition" defaultValue="">
              <option value="">Choose an item…</option>
              {defs.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
            <button type="button" disabled={busy} onClick={()=>void run(async()=>{
              const definition=(document.getElementById('nx-grant-definition') as HTMLSelectElement)?.value;
              if(!definition)throw Error('Choose an item');
              await rpc('add_inventory_item',{p_campaign:campaign,p_character:char,p_definition:definition,p_quantity:1});
              await loadChar(campaign,char);
            })}>Add to Inventory</button>
          </section>}
        </>}
      </section>:
      page==='play'&&campaign&&char?<div className="nx-play-page">
        <div className="nx-play-heading">
          <button type="button" className="nx-back-link" onClick={()=>navigate(entry==='gm'?'gm':'player')}><ChevronLeft size={17}/>{entry==='gm'?'GM Dashboard':'Player Portal'}</button>
          <span>{displayName} · {current?.name||'Character'}</span>
        </div>
        <CharacterScreen db={db!} campaign={campaign} campaignName={displayName} character={char}
          characterName={current?.name||'Character'} slots={slots} effects={effects} inventoryVersion={inventoryVersion}
          items={items} busy={busy}
          onEquip={(itemId,slotId)=>{void run(async()=>{await rpc('equip_inventory_item',{p_item:itemId,p_slot:slotId});await loadChar(campaign,char)})}}
          onUnequip={assignmentId=>{void run(async()=>{await rpc('unequip_inventory_item',{p_assignment:assignmentId});await loadChar(campaign,char)})}}
          onMoveStorage={async(itemId,containerItemId)=>{setBusy(true);setMsg('');try{
            await rpc('move_character_item_storage',{p_character:char,p_item:itemId,p_container_item:containerItemId});
            await loadChar(campaign,char);
          }catch(e){setMsg(inventoryErrorMessage(e));throw e}finally{setBusy(false)}}}
          onSaveAttributes={async(scores,size)=>{setBusy(true);setMsg('');try{
            await rpc('save_character_ability_scores',{p_character:char,p_scores:scores,p_size:size});
            await loadChar(campaign,char);
          }catch(e){setMsg(inventoryErrorMessage(e));throw e}finally{setBusy(false)}}}
          tab={activeTab} onTabChange={setActiveTab}/>
        {activeTab==='inventory'&&<section className="nx-play-extras">
          <ConnectionChecks db={db!} campaign={campaign} character={char}/>
          <Trading key={campaign+':'+char} db={db!} campaign={campaign} character={char} characters={recipients}/>
        </section>}
      </div>:<section className="nx-page-card">
        <h1>Select a Character</h1>
        <p>Choose your campaign and character in the Player Portal.</p>
        <button type="button" onClick={()=>navigate('player')}>Go to Player Portal</button>
      </section>}
      {msg&&<div className="nx-global-message" role="status">{msg}</div>}
    </main>
    {!isPlay&&<footer className="nx-app-footer">Nexus Multiverse · Alpha · <a href="/srd-attribution.html">SRD 5.2.1 attribution</a></footer>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
