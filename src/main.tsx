import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {BookOpen,Castle,ChevronLeft,Compass,Crown,Eye,EyeOff,Plus,ScrollText,Shield,UserRound} from 'lucide-react';
import {prioritizeStarterRulesets} from './rulesets';
import {inventoryErrorMessage} from './inventoryErrors';
import CharacterScreen,{type InventoryTab} from './CharacterScreen';
import EffectEditor from './EffectEditor';
import EffectEditorBoundary from './EffectEditorBoundary';
import RequirementEditor from './RequirementEditor';
import ItemUseEffectFields,{buildUseEffect,draftFromEffect,emptyUseEffect,type UseEffectDraft} from './ItemUseEffectFields';
import ConnectionChecks from './ConnectionChecks';
import Trading from './Trading';
import GmCurrencyManager from './GmCurrencyManager';
import GmMerchantManager from './GmMerchantManager';
import GmLootManager from './GmLootManager';
import GmCraftingManager from './GmCraftingManager';
import GmCraftingProfessions from './GmCraftingProfessions';
import GmItemCategoryManager,{type CampaignItemCategory} from './GmItemCategoryManager';
import GmBulkGrantItems from './GmBulkGrantItems';
import GmCsvTemplates from './GmCsvTemplates';
import GmCsvImports from './GmCsvImports';
import GmDashboardCard from './GmDashboardCard';
import GmZoneManager from './GmZoneManager';
import './style.css';
import './app-pages.css';

const url=import.meta.env.VITE_SUPABASE_URL||'';
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'';
const ready=!!url&&!!key&&!key.startsWith('REPLACE');
const db=ready?createClient(url,key):null;
type Row={id:string;name:string;[key:string]:any};
type PlayerCharacter={character_id:string;character_name:string;campaign_id:string;campaign_name:string};
type Page='landing'|'player'|'gm-select'|'gm'|'create'|'play';
type Entry='player'|'gm'|'create';
const itemCategories=[['gear','General Gear'],['ingredient','Ingredient'],['consumable','Consumable'],['weapon','Weapon'],['shield','Shield'],['armor','Armor'],['clothing','Clothing'],['jewelry','Jewelry'],['ring','Ring'],['headgear','Headgear'],['footwear','Footwear'],['focus','Spellcasting Focus'],['tool','Tool'],['wondrous','Wondrous Item']];

function App(){
  const[page,setPage]=useState<Page>('landing');
  const[entry,setEntry]=useState<Entry>('player');
  const[activeTab,setActiveTab]=useState<InventoryTab>('character');
  const[gmAccess,setGmAccess]=useState(false);
  const[gmCampaignIds,setGmCampaignIds]=useState<string[]>([]);
  const[gmCampaignLoading,setGmCampaignLoading]=useState(false);
  const[gmCampaignError,setGmCampaignError]=useState('');
  const[inventoryVersion,setInventoryVersion]=useState(0);
  const[craftingConfigVersion,setCraftingConfigVersion]=useState(0);
  const[shopImportVersion,setShopImportVersion]=useState(0);
  const[lootImportVersion,setLootImportVersion]=useState(0);
  const[session,setSession]=useState<any>(null);
  const[sessionReady,setSessionReady]=useState(false);
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[showPassword,setShowPassword]=useState(false);
  const[playerCharacters,setPlayerCharacters]=useState<PlayerCharacter[]>([]);
  const[playerCharactersLoading,setPlayerCharactersLoading]=useState(false);
  const[playerCharactersError,setPlayerCharactersError]=useState('');
  const[register,setRegister]=useState(false);
  const[systems,setSystems]=useState<any[]>([]);
  const[campaigns,setCampaigns]=useState<Row[]>([]);
  const[campaign,setCampaign]=useState('');
  const[chars,setChars]=useState<Row[]>([]);
  const[recipients,setRecipients]=useState<Row[]>([]);
  const[char,setChar]=useState('');
  const[items,setItems]=useState<any[]>([]);
  const[defs,setDefs]=useState<any[]>([]);
  const[customItemCategories,setCustomItemCategories]=useState<CampaignItemCategory[]>([]);
  const[slots,setSlots]=useState<any[]>([]);
  const[effects,setEffects]=useState<any[]>([]);
  const[campaignName,setCampaignName]=useState('');
  const[characterName,setCharacterName]=useState('');
  const[slotCode,setSlotCode]=useState('');
  const[slotLabel,setSlotLabel]=useState('');
  const[itemName,setItemName]=useState('');
  const[itemCategory,setItemCategory]=useState('gear');
  const[itemConsumable,setItemConsumable]=useState(false);
  const[itemStackable,setItemStackable]=useState(true);
  const[editStackableValue,setEditStackableValue]=useState(true);
  const[newItemUseEffect,setNewItemUseEffect]=useState<UseEffectDraft>({...emptyUseEffect});
  const[existingItemUseEffect,setExistingItemUseEffect]=useState<UseEffectDraft>({...emptyUseEffect});
  const[editConsumableDefinition,setEditConsumableDefinition]=useState('');
  const[editConsumableValue,setEditConsumableValue]=useState(true);
  const[effectPotionName,setEffectPotionName]=useState('');
  const[effectPotionType,setEffectPotionType]=useState('temp_hp');
  const[effectPotionCode,setEffectPotionCode]=useState('poisoned');
  const[effectPotionAmount,setEffectPotionAmount]=useState('5');
  const[effectPotionDuration,setEffectPotionDuration]=useState('3');
  const[effectPotionUnit,setEffectPotionUnit]=useState('round');
  const[twoHanded,setTwoHanded]=useState(false);
  const[attr,setAttr]=useState('');
  const[bonus,setBonus]=useState('');
  const[selectedDef,setSelectedDef]=useState('');
  const[msg,setMsg]=useState('');
  const[busy,setBusy]=useState(false);
  const[campaignBusy,setCampaignBusy]=useState(false);
  const isOrdinaryItemCategory=(code:string)=>['gear','ingredient','consumable','ammunition','material','component','misc','supplies'].includes(code)||customItemCategories.some(c=>c.code===code);
  const itemCategoryDefaultStack=(code:string)=>customItemCategories.find(c=>c.code===code)?.default_stackable??['gear','ingredient','consumable','ammunition','material','component','misc','supplies'].includes(code);

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
    setChar('');setItems([]);setEffects([]);setChars([]);setDefs([]);setCustomItemCategories([]);setSlots([]);
    try{
      const [people,catalog,equipment,account,membership,recipientQuery,campaignOwner,categoryQuery]=await Promise.all([
        db.from('characters').select('id,name,member_id').eq('campaign_id',id),
        db.from('item_definitions').select('id,name,category,code,source_info,default_properties,campaign_id').eq('campaign_id',id),
        db.from('equipment_slot_definitions').select('id,label').eq('campaign_id',id),
        db.auth.getUser(),
        db.from('campaign_members').select('id,user_id,role,status').eq('campaign_id',id),
        db.rpc('list_trade_recipients',{p_campaign:id}),
        db.from('campaigns').select('owner_user_id').eq('id',id).single(),
        db.rpc('list_campaign_item_categories',{p_campaign:id})
      ]);
      for(const result of [people,catalog,equipment,membership,recipientQuery,campaignOwner,categoryQuery])if(result.error)throw result.error;
      if(account.error)throw account.error;
      const me=account.data.user?.id;
      const memberships=(membership.data||[]).filter(m=>m.user_id===me&&m.status==='active');
      const owned=campaignOwner.data?.owner_user_id===me;
      const gm=owned||memberships.some(m=>m.role==='gm'||m.role==='owner');
      const allowed=new Set(memberships.map(m=>m.id));
      setGmAccess(gm);
      setChars((people.data||[]).filter(person=>gm||allowed.has(person.member_id)));
      setRecipients(recipientQuery.data||[]);
      setDefs(catalog.data||[]);
      setCustomItemCategories((categoryQuery.data||[]) as CampaignItemCategory[]);
      setSlots(equipment.data||[]);
    }finally{setCampaignBusy(false)}
  }
  async function refreshItemCatalog(id:string){
    if(!db)return;
    const [catalog,categoryQuery]=await Promise.all([
      db.from('item_definitions').select('id,name,category,code,source_info,default_properties,campaign_id').eq('campaign_id',id),
      db.rpc('list_campaign_item_categories',{p_campaign:id})
    ]);
    if(catalog.error)throw catalog.error;
    if(categoryQuery.error)throw categoryQuery.error;
    setDefs(catalog.data||[]);
    setCustomItemCategories((categoryQuery.data||[]) as CampaignItemCategory[]);
  }
  async function chooseCampaign(id:string){
    setCampaign(id);
    setMsg('');
    if(!id){setGmAccess(false);setChars([]);setChar('');setDefs([]);setCustomItemCategories([]);setSlots([]);return}
    await run(()=>loadCampaign(id));
  }
  async function loadChar(c:string,ch:string){
    const own=await rpc('list_character_inventory_for_trade',{p_character:ch});
    setItems((own||[]).map((i:any)=>({...i,display_name:i.name})));
    setEffects(await rpc('list_character_effects',{p_character:ch}));
    setInventoryVersion(v=>v+1);
  }
  async function openPlayerCharacter(selected:PlayerCharacter){
    if(busy||campaignBusy||playerCharactersLoading)return;
    setBusy(true);setMsg('');
    try{
      setCampaign(selected.campaign_id);
      await loadCampaign(selected.campaign_id);
      await loadChar(selected.campaign_id,selected.character_id);
      setChar(selected.character_id);
      setActiveTab('character');
      navigate('play');
    }catch(e){setMsg(inventoryErrorMessage(e))}
    finally{setBusy(false)}
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
    if(next==='gm'){setCampaign('');setGmAccess(false);navigate('gm-select');return}
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
    if(page!=='gm-select'||!session||!db)return;
    let cancelled=false;
    setGmCampaignLoading(true);setGmCampaignError('');setGmCampaignIds([]);
    void Promise.all([
      db.from('campaigns').select('id,name,owner_user_id,ruleset_version_id'),
      db.from('campaign_members').select('campaign_id,role,status').eq('user_id',session.user.id).eq('status','active')
    ]).then(([campaignResult,membershipResult])=>{
      if(campaignResult.error)throw campaignResult.error;
      if(membershipResult.error)throw membershipResult.error;
      if(cancelled)return;
      setCampaigns(campaignResult.data||[]);
      const authorized=new Set((membershipResult.data||[]).filter(m=>m.role==='gm'||m.role==='owner').map(m=>m.campaign_id));
      setGmCampaignIds((campaignResult.data||[]).filter(c=>c.owner_user_id===session.user.id||authorized.has(c.id)).map(c=>c.id));
    }).catch(e=>{if(!cancelled)setGmCampaignError(inventoryErrorMessage(e))})
    .finally(()=>{if(!cancelled)setGmCampaignLoading(false)});
    return()=>{cancelled=true};
  },[page,session?.user?.id]);
  useEffect(()=>{
    if(page!=='player'||!session||!db)return;
    let cancelled=false;
    setPlayerCharactersLoading(true);setPlayerCharactersError('');setPlayerCharacters([]);
    void Promise.resolve(db.rpc('list_my_player_characters')).then(({data,error})=>{
      if(cancelled)return;
      if(error)throw error;
      setPlayerCharacters((data||[]) as PlayerCharacter[]);
    }).catch(e=>{if(!cancelled)setPlayerCharactersError(inventoryErrorMessage(e))})
      .finally(()=>{if(!cancelled)setPlayerCharactersLoading(false)});
    return()=>{cancelled=true};
  },[page,session?.user?.id]);
  useEffect(()=>{
    if(session)return;
    setCampaign('');setChar('');setGmAccess(false);setChars([]);setItems([]);setPlayerCharacters([]);
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
    <label>Password
      <span className="nx-password-field">
        <input type={showPassword?'text':'password'} autoComplete={register?'new-password':'current-password'} required minLength={6} value={password} onChange={e=>setPassword(e.target.value)}/>
        <button type="button" className="nx-password-toggle" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(v=>!v)}>
          {showPassword?<EyeOff size={19} aria-hidden="true"/>:<Eye size={19} aria-hidden="true"/>}
        </button>
      </span>
    </label>
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
      <div className="nx-header-actions">
        {isPlay&&<button type="button" className="nx-header-back" onClick={()=>navigate(entry==='gm'?'gm':'player')}><ChevronLeft size={17}/>{entry==='gm'?'GM Dashboard':'Player Portal'}</button>}
        {session&&<button type="button" className="nx-header-exit" onClick={()=>{void db?.auth.signOut();navigate('landing')}}>Sign out</button>}
      </div>
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
            <UserRound size={28}/><strong>Player Login</strong><span>Choose one of your characters</span>
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
      page==='gm-select'?<section className="nx-page-card nx-select-page">
        <button type="button" className="nx-back-link" onClick={()=>navigate('landing')}><ChevronLeft size={17}/> Landing</button>
        <div className="nx-page-icon"><Crown/></div><h1>GM Campaigns</h1>
        <p>Select a campaign to manage.</p>
        <div className="nx-player-character-list" aria-label="Available GM campaigns">
          {gmCampaignLoading?<p role="status">Loading your campaigns…</p>:
            gmCampaignError?<p className="nx-character-list-error" role="alert">{gmCampaignError}</p>:
            gmCampaignIds.length===0?<p className="nx-small-note">No campaigns are available for this GM account.</p>:
            campaigns.filter(c=>gmCampaignIds.includes(c.id)).map(c=><button type="button" key={c.id} className="nx-player-character-card"
              disabled={busy||campaignBusy} onClick={()=>{void (async()=>{setBusy(true);setMsg('');try{
                await loadCampaign(c.id);setCampaign(c.id);navigate('gm');
              }catch(e){setGmCampaignError(inventoryErrorMessage(e))}finally{setBusy(false)}})()}}>
              <span className="nx-player-character-label"><strong>{c.name}</strong><span>Open GM Dashboard</span></span>
            </button>)}
        </div>
        <button type="button" className="nx-create-shortcut" onClick={()=>navigate('create')}><Plus size={18}/> Set Up New Campaign</button>
      </section>:
      page==='player'?<section className="nx-page-card nx-select-page nx-player-portal">
        <button type="button" className="nx-back-link" onClick={()=>navigate('landing')}><ChevronLeft size={17}/> Landing</button>
        <div className="nx-page-icon"><UserRound/></div><h1>Player Portal</h1>
        <p>Choose one of your assigned characters to enter its campaign.</p>
        <div className="nx-player-character-list" aria-label="Your characters">
          {playerCharactersLoading?<p role="status">Loading your characters…</p>:
            playerCharactersError?<p className="nx-character-list-error" role="alert">Unable to load your characters: {playerCharactersError}</p>:
            playerCharacters.length===0?<p className="nx-small-note">No characters are currently assigned to this account. Ask your GM to assign a character in an active campaign.</p>:
            playerCharacters.map(person=><button type="button" key={person.character_id} className="nx-player-character-card"
              disabled={busy||campaignBusy} aria-label={`Open ${person.character_name} in ${person.campaign_name}`}
              onClick={()=>{void openPlayerCharacter(person)}}>
              <span className="nx-player-character-label">
                <strong>{person.character_name}</strong>
                <span>{person.campaign_name}</span>
              </span>
            </button>)}
        </div>
        <div className="nx-future-feature"><ScrollText size={20}/><div><strong>Request Character Transfer</strong><span>Coming soon — transfer characters between campaigns with GM approval.</span></div></div>
      </section>:
      page==='create'?<section className="nx-page-card nx-create-page">
        <button type="button" className="nx-back-link" onClick={()=>navigate('gm-select')}><ChevronLeft size={17}/> GM Campaigns</button>
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
          <button type="button" className="nx-back-link" onClick={()=>navigate('gm-select')}><ChevronLeft size={17}/> Campaigns</button>
          <div className="nx-page-icon"><Crown/></div><h1>GM Dashboard</h1>
          <p>Campaign management, character administration, catalog configuration and equipment effects.</p>
          <p className="nx-small-note">Managing: <strong>{selectedCampaign?.name||'Campaign'}</strong></p>
          {!campaign&&<p className="nx-small-note">Select a campaign to manage its resources.</p>}
        </div>
        {campaign&&!campaignBusy&&!gmAccess&&<section className="nx-page-card nx-warning"><Shield size={20}/><div><h2>GM permission required</h2><p>Your account doesn't have manager access to this campaign. Select another campaign or use the Player Portal.</p></div></section>}
        {campaign&&gmAccess&&!campaignBusy&&<>
          <GmDashboardCard key={'characters-'+campaign} title="Character Management">
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
          </GmDashboardCard>
          <GmDashboardCard key={'zones-'+campaign} title="Campaign Zones & Time"><GmZoneManager db={db!} campaign={campaign}/></GmDashboardCard>
          <GmDashboardCard key={'csv-templates-'+campaign} title="GM CSV Templates">
            <GmCsvTemplates/>
          </GmDashboardCard>
          <GmDashboardCard key={'csv-imports-'+campaign} title="GM CSV Imports">
            <GmCsvImports db={db!} campaign={campaign} onImported={async kind=>{
              if(kind==='catalog')await refreshItemCatalog(campaign);
              else if(kind==='shop-stock')setShopImportVersion(v=>v+1);
              else if(kind==='loot-contents')setLootImportVersion(v=>v+1);
              else if(char)await loadChar(campaign,char);
            }}/>
          </GmDashboardCard>
          <GmDashboardCard key={'recipes-'+campaign} title="Crafting Skills & Recipes">
            <GmCraftingProfessions db={db!} campaign={campaign} characters={chars}
              onChanged={()=>setCraftingConfigVersion(v=>v+1)}/>
            <GmCraftingManager db={db!} campaign={campaign} definitions={defs} characters={chars}
              configVersion={craftingConfigVersion}/>
          </GmDashboardCard>
          <GmDashboardCard key={'currency-'+campaign} title="Campaign Currency">
            <GmCurrencyManager db={db!} campaign={campaign} characters={chars} onChanged={async()=>{if(char)await loadChar(campaign,char)}}/>
          </GmDashboardCard>
          <GmDashboardCard key={'merchants-'+campaign} title="Campaign Merchants">
            <GmMerchantManager db={db!} campaign={campaign} definitions={defs} refreshVersion={shopImportVersion}/>
          </GmDashboardCard>
          <GmDashboardCard key={'loot-'+campaign} title="QR Loot Containers">
            <GmLootManager db={db!} campaign={campaign} refreshVersion={lootImportVersion}/>
          </GmDashboardCard>
          <GmDashboardCard key={'catalog-'+campaign} title="GM Item Catalog">
          <section className="nx-page-card nx-gm-tools">
            <h2><BookOpen size={20}/> GM Item Catalog</h2>
            <GmItemCategoryManager db={db!} campaign={campaign} definitions={defs} categories={customItemCategories}
              builtInCategories={itemCategories} onChanged={()=>refreshItemCatalog(campaign)}/>
            <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              await rpc('create_campaign_custom_item_with_stacking',{p_campaign:campaign,p_name:itemName,p_category:itemCategory,p_bonus_attribute:itemConsumable||itemCategory==='consumable'?null:attr||null,p_bonus:itemConsumable||itemCategory==='consumable'?null:bonus?Number(bonus):null,p_two_handed:itemCategory==='weapon'&&twoHanded,p_consumable:itemConsumable||itemCategory==='consumable',p_use_effect:itemConsumable||itemCategory==='consumable'?buildUseEffect(newItemUseEffect):null,p_stackable:itemStackable});
              await loadCampaign(campaign);setItemName('');setItemConsumable(false);setItemStackable(itemCategoryDefaultStack(itemCategory));setNewItemUseEffect({...emptyUseEffect});
            })}}>
              <label>New item name<input required value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New equipment item"/></label>
              <label>Item category
                <select value={itemCategory} onChange={e=>{setItemCategory(e.target.value);setItemStackable(itemCategoryDefaultStack(e.target.value));if(!isOrdinaryItemCategory(e.target.value))setItemConsumable(false)}}>
                  {itemCategories.map(([code,label])=><option key={code} value={code}>{label}</option>)}
                  {customItemCategories.filter(c=>c.active).map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label className="nx-checkbox"><input type="checkbox" checked={twoHanded} disabled={itemCategory!=='weapon'} onChange={e=>setTwoHanded(e.target.checked)}/> Two-handed weapon</label>
              <label className="nx-checkbox"><input type="checkbox" checked={itemConsumable||itemCategory==='consumable'}
                disabled={!isOrdinaryItemCategory(itemCategory)||itemCategory==='consumable'}
                onChange={e=>{setItemConsumable(e.target.checked);if(e.target.checked){setItemStackable(true);setAttr('');setBonus('')}}}/> Consumable / Usable — deduct one item when used</label>
              <label className="nx-checkbox"><input type="checkbox" checked={itemStackable}
                disabled={!isOrdinaryItemCategory(itemCategory)||itemConsumable||itemCategory==='consumable'}
                onChange={e=>setItemStackable(e.target.checked)}/> Stackable — combine identical items into one quantity</label>
              {(itemConsumable||itemCategory==='consumable')&&<p className="nx-small-note">Usable items deduct one unit from inventory and can apply an optional effect. They must be stackable.</p>}
              <label>Bonus attribute (optional)<input placeholder="e.g. STR" disabled={itemConsumable||itemCategory==='consumable'} value={attr} onChange={e=>setAttr(e.target.value)}/></label>
              <label>Bonus amount (optional)<input type="number" step="any" placeholder="e.g. 2" disabled={itemConsumable||itemCategory==='consumable'} value={bonus} onChange={e=>setBonus(e.target.value)}/></label>
              {(itemConsumable||itemCategory==='consumable')&&<ItemUseEffectFields prefix="new-custom-item" value={newItemUseEffect} onChange={setNewItemUseEffect} disabled={busy}/>} 
              <button type="submit" disabled={busy}>Create Catalog Item</button>
            </form>
            <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              const choice=defs.find(d=>d.id===editConsumableDefinition);
              if(!choice)throw Error('Select a custom item.');
               // Enable stacking before turning Use on; turn Use off before disabling stacking.
               let stacking;
               if(editConsumableValue){
                 stacking=await rpc('set_campaign_item_stackable',{p_campaign:campaign,p_definition:choice.id,p_stackable:true});
                 await rpc('update_campaign_custom_item_use_settings',{
                   p_campaign:campaign,p_definition:choice.id,p_consumable:true,
                   p_use_effect:buildUseEffect(existingItemUseEffect)
                 });
               }else{
                 await rpc('update_campaign_custom_item_use_settings',{
                   p_campaign:campaign,p_definition:choice.id,p_consumable:false,p_use_effect:null
                 });
                 stacking=await rpc('set_campaign_item_stackable',{p_campaign:campaign,p_definition:choice.id,p_stackable:editStackableValue});
               }
              await loadCampaign(campaign);
              setMsg(`${choice.name} settings saved. ${Number(stacking?.merged_stacks??0)} existing compatible stacks merged.`);
            })}}>
              <h3>Update Existing Custom Item</h3>
              <label>Item
                <select required value={editConsumableDefinition} onChange={e=>{const id=e.target.value;const selected=defs.find(d=>d.id===id);setEditConsumableDefinition(id);setEditConsumableValue(selected?.default_properties?.consumable===true||selected?.category==='consumable');setEditStackableValue(selected?.default_properties?.stackable!=='false'&&selected?.default_properties?.stackable!==false);setExistingItemUseEffect(draftFromEffect(selected?.default_properties?.use_effect))}}>
                  <option value="">Choose an eligible custom item…</option>
                  {defs.filter(d=>isOrdinaryItemCategory(d.category)&&!!d.campaign_id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label>Usable status
                <select value={editConsumableValue?'yes':'no'} onChange={e=>{setEditConsumableValue(e.target.value==='yes');if(e.target.value==='yes')setEditStackableValue(true)}}>
                  <option value="yes">Consumable / Usable</option>
                  <option value="no">Not consumable</option>
                </select>
              </label>
              <label className="nx-checkbox"><input type="checkbox" checked={editStackableValue}
                disabled={editConsumableValue}
                onChange={e=>setEditStackableValue(e.target.checked)}/> Stackable — merge compatible existing stacks when saved</label>
              {editConsumableValue&&<ItemUseEffectFields prefix="existing-custom-item" value={existingItemUseEffect} onChange={setExistingItemUseEffect} disabled={busy||campaignBusy}/>}
              <button type="submit" disabled={busy||campaignBusy||!editConsumableDefinition}>Save Item Settings</button>
            </form>
          </section>
          </GmDashboardCard>
          <GmDashboardCard key={'potions-'+campaign} title="Custom Effect Potions">
          <section className="nx-page-card nx-gm-tools">
            <h2><BookOpen size={20}/> Custom Effect Potions</h2>
            <p>Create campaign-specific consumables that grant temporary HP, apply or remove a condition, or track an ability bonus. Grant them to characters using the item catalog tool below.</p>
            <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              if(!campaign)throw Error('Select a campaign first.');
              await rpc('create_campaign_effect_potion',{
                p_campaign:campaign,p_name:effectPotionName.trim(),p_effect_type:effectPotionType,
                p_code:effectPotionType==='temp_hp'?null:effectPotionType==='ability_bonus'?effectPotionCode.toLowerCase():effectPotionCode.toLowerCase(),
                p_amount:effectPotionType==='temp_hp'||effectPotionType==='ability_bonus'?Number(effectPotionAmount):null,
                p_duration:effectPotionType==='add_condition'||effectPotionType==='ability_bonus'?Number(effectPotionDuration):null,
                p_unit:effectPotionUnit
              });
              setEffectPotionName('');
              await loadCampaign(campaign);
              setMsg('Effect potion created. Use Grant Item to Character to add it to a character inventory.');
            })}}>
              <label>Potion name<input required minLength={3} maxLength={120} placeholder="Potion of Resilience" value={effectPotionName} onChange={e=>setEffectPotionName(e.target.value)}/></label>
              <label>Effect type<select value={effectPotionType} onChange={e=>{setEffectPotionType(e.target.value);setEffectPotionCode(e.target.value==='ability_bonus'?'str':'poisoned')}}>
                <option value="temp_hp">Grant temporary HP</option>
                <option value="remove_condition">Remove condition</option>
                <option value="add_condition">Apply condition</option>
                <option value="ability_bonus">Timed ability bonus</option>
              </select></label>
              {effectPotionType!=='temp_hp'&&<label>{effectPotionType==='ability_bonus'?'Ability':'Condition'}
                {effectPotionType==='ability_bonus'?<select value={effectPotionCode} onChange={e=>setEffectPotionCode(e.target.value)}>
                  {['str','dex','con','int','wis','cha'].map(a=><option key={a} value={a}>{a.toUpperCase()}</option>)}
                </select>:<input required maxLength={60} value={effectPotionCode} onChange={e=>setEffectPotionCode(e.target.value)}/>}
              </label>}
              {(effectPotionType==='temp_hp'||effectPotionType==='ability_bonus')&&<label>{effectPotionType==='temp_hp'?'Temporary HP':'Ability bonus'}
                <input required type="number" step="1" min={effectPotionType==='temp_hp'?1:-30} max={effectPotionType==='temp_hp'?100000:30}
                  value={effectPotionAmount} onChange={e=>setEffectPotionAmount(e.target.value)}/>
              </label>}
              {(effectPotionType==='add_condition'||effectPotionType==='ability_bonus')&&<>
                <label>Duration units<select value={effectPotionUnit} onChange={e=>setEffectPotionUnit(e.target.value)}>
                  {['round','turn','minute','hour','rest','permanent'].map(u=><option key={u} value={u}>{u}</option>)}
                </select></label>
                {effectPotionUnit!=='permanent'&&<label>Duration<input type="number" required min={1} max={100000} value={effectPotionDuration} onChange={e=>setEffectPotionDuration(e.target.value)}/></label>}
              </>}
              <button type="submit" disabled={busy||campaignBusy||!effectPotionName.trim()}>Create Effect Potion</button>
            </form>
          </section>
          </GmDashboardCard>
          <GmDashboardCard key={'requirements-'+campaign} title="Equipment Requirements">
          <RequirementEditor db={db!} campaign={campaign} definitions={defs}
            attributes={effectAttributes}
            onChanged={async()=>{await loadCampaign(campaign)}}/>
          </GmDashboardCard>
          <GmDashboardCard key={'effects-'+campaign} title="Equipment Effects">
          <EffectEditorBoundary campaign={campaign}>
            <EffectEditor db={db!} campaign={campaign} definitions={defs}
              attributes={effectAttributes} operations={effectOperations}
              characters={chars} selectedCharacter={char}
              allowEquippedCategory={allowsCategoryCondition}
              onChanged={async()=>{if(char)await loadChar(campaign,char)}}/>
          </EffectEditorBoundary>
          </GmDashboardCard>
          <GmDashboardCard key={'slots-'+campaign} title="Equipment Slots">
          <section className="nx-page-card nx-gm-tools">
            <h2><Shield size={20}/> Equipment Slots</h2>
            <p>{slots.map(s=>s.label).join(' · ')||'No slots configured yet.'}</p>
            <form className="nx-tool-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              const code=slotCode.trim();
              if(!code)throw Error('Enter an equipment slot code.');
              await rpc('create_campaign_slot',{p_campaign:campaign,p_code:code,p_label:slotLabel.trim()||code});
              await loadCampaign(campaign);
              setSlotCode('');setSlotLabel('');
            })}}>
              <h3>Add Equipment Slot</h3>
              <label>Slot code<input required maxLength={60} placeholder="e.g. main_hand" value={slotCode} onChange={e=>setSlotCode(e.target.value)}/></label>
              <label>Slot label<input maxLength={80} placeholder="e.g. Main Hand" value={slotLabel} onChange={e=>setSlotLabel(e.target.value)}/></label>
              <button type="submit" disabled={busy}>Add Slot</button>
            </form>
          </section>
          </GmDashboardCard>
          <GmDashboardCard key={'grants-'+campaign} title="Grant Item to Character">
          <section className="nx-page-card nx-gm-tools">
            <h2><Plus size={20}/> Grant Item to Character</h2>
            <GmBulkGrantItems db={db!} campaign={campaign} characters={chars} definitions={defs}
              disabled={busy||campaignBusy} onGranted={async recipientId=>{
                if(char===recipientId)await loadChar(campaign,recipientId);
              }}/>
            {chars.length===0&&<p className="nx-small-note">Create a character above before granting items.</p>}
          </section>
          </GmDashboardCard>
        </>}
      </section>:
      page==='play'&&campaign&&char?<div className="nx-play-page">
        <CharacterScreen db={db!} campaign={campaign} campaignName={displayName} character={char}
          characterName={current?.name||'Character'} slots={slots} effects={effects} inventoryVersion={inventoryVersion}
          items={items} busy={busy}
          onEquip={(itemId,slotId)=>{void run(async()=>{await rpc('equip_inventory_item',{p_item:itemId,p_slot:slotId});await loadChar(campaign,char)})}}
          onUnequip={assignmentId=>{void run(async()=>{await rpc('unequip_inventory_item',{p_assignment:assignmentId});await loadChar(campaign,char)})}}
          onMoveStorage={async(itemId,containerItemId)=>{setBusy(true);setMsg('');try{
            await rpc('move_character_item_storage',{p_character:char,p_item:itemId,p_container_item:containerItemId});
            await loadChar(campaign,char);
          }catch(e){setMsg(inventoryErrorMessage(e));throw e}finally{setBusy(false)}}}
          onInventoryChanged={async()=>{await loadChar(campaign,char)}}
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
        <p>Choose an assigned character in the Player Portal.</p>
        <button type="button" onClick={()=>navigate('player')}>Go to Player Portal</button>
      </section>}
      {msg&&<div className="nx-global-message" role="status">{msg}</div>}
    </main>
    {!isPlay&&<footer className="nx-app-footer">Nexus Multiverse · Alpha · <a href="/srd-attribution.html">SRD 5.2.1 attribution</a></footer>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
