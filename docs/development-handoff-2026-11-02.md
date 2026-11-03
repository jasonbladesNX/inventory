# Nexus Multiverse — TTRPG Inventory App
## Development handoff · 2026-11-02

> **Purpose:** Resume development in a fresh ChatGPT conversation without losing architectural decisions, current functionality, connection details, security safeguards, or test history. This document is a snapshot; inspect the latest code, migrations, and CI status before changing anything.
>
> **Important:** This is a **tabletop RPG character inventory application**, **not** Nexus Game Lounge's retail inventory or reorder system. Its in-game shops, loot, currency, trading, and crafting are genuine RPG features.

## 1. Project and deployment

| Component | Location / identity |
|---|---|
| GitHub repository | `jasonbladesNX/inventory` |
| Branch | `main` |
| Last application-code commit validated before this handoff | `f759450c5f2e9fa4e8962c3e1a7187dcb20b5e5b` |
| Last app CI result | **Success**, GitHub Actions run `41568385589` |
| App URL | https://nexus-ttrpg-inventory.accounts-6ea.workers.dev/ |
| Cloudflare | Worker project linked to the GitHub repo; automatic deploy after pushes to `main` |
| Supabase project ID | `fvapsdirjgknxpqlxljx` |
| Supabase project | https://supabase.com/dashboard/project/fvapsdirjgknxpqlxljx |
| Supabase API host | `https://fvapsdirjgknxpqlxljx.supabase.co` |

**Isolation warning:** Another project, **Helios BattleTech**, uses Supabase and Cloudflare but has a **different project**. Never run database changes against Helios. Always verify the project ID before any Supabase action.

**Tech:** React 19, TypeScript 5.9, Vite 7, `@supabase/supabase-js` 2.x, Lucide React. GitHub Actions uses Node 22 and runs `npm run syntax`, `npm run contracts`, `npm run check`, `npm run build`. Cloudflare deploys built Vite static assets.

**Configuration:** The browser bundles `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time. These are supplied as GitHub Actions repository variables and Cloudflare build variables. **Do not put service-role keys or other secrets in frontend code, documentation, or chat.** Supabase Auth redirect/Site URL should match the Worker app origin, not localhost.

## 2. Product design and scope

- Brand and interface: **Nexus Multiverse**; immersive game-inventory aesthetic, midnight/navy background, cyan illuminated borders, fantasy-style headings, readable mobile content.
- **Four tabs:** Character, Inventory, Shop, Craft.
- User supplied a four-screen iPhone concept reference during the preceding conversation. Use it as the principal visual reference; it is not source code and must not replace working components.
- **First supported system: Dungeons & Dragons 5e**, with both **SRD 5.1** and **SRD 5.2.1** already published in `ruleset_versions`. Prefer SRD 5.2.1 for new campaigns when an explicit default is needed, but keep 5.1 selectable.
- **Long-term goal: other TTRPGs without rewriting the core.** Supabase already has `game_systems` and versioned `ruleset_versions`. A campaign references a specific version. Attributes, equipment slots, currency denominations, and capacity model belong in ruleset/campaign configuration; domain ownership, inventory movement, trading security, and transaction handling remain system-neutral.
- Existing published ruleset examples include custom/homebrew, D&D 5e, Pathfinder 2e, Cyberpunk RED, Shadowrun 6e, and Vampire: The Masquerade 5e. They are **not** all fully implemented gameplay integrations.

## 3. Verified user-facing functionality

User personally confirmed, across successive iterations:
1. Account registration, email confirmation, and login work.
2. Campaign creation/listing and character creation/listing work.
3. The Nexus Multiverse Character and Inventory screens render.
4. Inventory items added to the character appear in the graphical inventory.
5. Equipping an item persists; equipped items appear in Character > Equipped Items.
6. Unequip returns the item to non-equipped inventory.
7. Equipment swapping works, including two-handed conflict handling.
8. The final **simplified single Equip selector** automatically replaces occupying gear; the user explicitly confirmed **“Everything works great.”**

**Latest requested behavior, implemented and verified:** The Inventory tab has only one Equip menu. Choosing a slot automatically unequips conflicting equipped items, then equips the new item **atomically**. This includes hand conflicts involving two-handed weapons. Do not restore separate Equip and Replace menu choices.

**Known testing data:** Supabase contains a `Test Campaign` and `Test Barbarian`. Catalog examples include Longsword and Short Sword, categorized as `weapon`. Test character inventory/equipment state can change as the user tests. **Do not assume specific current counts or reset/delete records without instruction.**

## 4. Current feature boundaries

### Character — working initial version
- Actual campaign and character name; equipped items from authorized read RPC; active equipment effects from RPC; wallet/currency from authorized RPC.
- Unequip buttons; equipment refresh after actions.
- **Claim Loot** is a noninteractive placeholder (not a functional action).
- Equipment slot labels are campaign-configured; early user-created test labels may have inconsistent capitalization or underscores.

### Inventory — working initial version
- Graphical item cards using live data, quantity, eligibility status, equip selector.
- Single Equip action replaces conflicts automatically; UI refreshes item/effect/equipment state.
- GM create-item form supports category selection and a **Two-handed weapon** checkbox. Underlying item definition metadata uses JSONB `default_properties.two_handed=true`.
- Existing trading and connection diagnostics are still displayed **below** the graphical Inventory screen. They are development-era UI, not final design.
- **Not yet complete:** item detail panels, item artwork per category, nested backpack/container browsing, sorting/filtering, fully contextual equipment choices, encumbrance UI, robust item property authoring.

### Shop and Craft — placeholders
- Tabs are visible but intentionally state unavailable. Do **not** claim checkout, recipe consumption, or actual shop functions are implemented.
- Database contains some merchant and related tables; this is **not proof of end-to-end readiness**.

### Other important limits
- RLS and role checks remain essential. Frontend-only UI disabling is **not authorization**.
- The trading surface has experimental offer/counter/cancel/version-based acceptance logic; settlement routines remain intentionally restricted. Do not silently grant direct player access to `finalize_approved_trade`, `settle_item_trade`, or other unverified settlement entry points.
- D&D equipment category enforcement and simple two-handed hand-conflict handling are implemented. This is **not a complete D&D 5e equipment/attunement/proficiency rules engine**. Attunement, weapon mastery, strength requirements, handedness variants, and detailed conditions are future work.

## 5. Important source files

| File | Role |
|---|---|
| `src/main.tsx` | Entry point, authentication, campaign/character selection, GM item catalog, invoking data RPCs, refresh state, trading mount; currently compact/minified-style JSX; refactor carefully |
| `src/CharacterScreen.tsx` | Nexus Multiverse four-tab UI, live equipped gear and currency, graphical inventory, Unequip and Equip actions |
| `src/character-screen.css` | Mobile-first cyan fantasy UI styles |
| `src/style.css` | Existing app shell and legacy panel styles |
| `src/rulesets.ts` | Versioned ruleset adapter, D&D-first display defaults, generic fallback |
| `src/Trading.tsx`, `src/TradeQR.tsx` | Experimental trade interface/QR |
| `src/ConnectionChecks.tsx` | Connectivity/development checks |
| `docs/ruleset-architecture.md` | Original ruleset architecture/constraints |
| `scripts/validate-contracts.mjs` | Safety-oriented source contract checks |
| `scripts/validate-source.mjs` | Syntax checks; currently lists only some TSX files explicitly |
| `.github/workflows/build.yml` | GitHub CI pipeline |
| `package.json` | Build and TypeScript commands |

**CI detail:** `npm run check` has no dedicated `tsconfig.json` and passes explicit `src/` entrypoints. Imported components are transitively type-checked. If you add new independent TS/TSX files, ensure type/syntax checks cover them.

## 6. Core Supabase concepts

Representative existing entities:
- `game_systems`, `ruleset_versions`, `campaigns`, `campaign_members`, `characters`
- `item_definitions` (category, default_properties, property_schema, ruleset/campaign association)
- `item_instances` (individual possessions, holder, properties, quantity), `inventory_holders`, `containers`
- `equipment_slot_definitions` (code, label, capacity, allowed_categories, config), `equipment_assignments`, `item_effects`
- `currencies`, `wallets`, `wallet_balances`
- Trade and merchant related tables, transaction/audit records, loot-related structures.

### Key frontend/RPC contracts
- `create_inventory_campaign(p_name,p_ruleset)`
- `create_inventory_character(p_campaign,p_name)`
- `create_campaign_slot(p_campaign,p_code,p_label)`
- `create_campaign_equipment_item(p_campaign,p_name,p_category,p_bonus_attribute,p_bonus,p_two_handed)` — new GM catalogue creation wrapper.
- `add_inventory_item(p_campaign,p_character,p_definition,p_quantity)`
- `list_character_inventory_for_trade(p_character)` — existing inventory list used in the UI; returned entries include `item_id`, `name`, `quantity`, `eligible`. `eligible` is **trade eligibility**, not equipment compatibility.
- `list_character_effects(p_character)`
- `list_character_equipped_items(p_character)` — secure read; returns `assignment_id`, `slot_id`, `item_name`; respects identification/GM visibility.
- `list_my_trade_currency(p_character)` — wallet display.
- `equip_inventory_item(p_item,p_slot)` — **current standard UI call**; delegates to the three-argument implementation with replacement enabled.
- `equip_inventory_item(p_item,p_slot,p_replace)` — transactional implementation; checks auth/ownership, configured category eligibility, D&D defaults, slot capacity, two-handed conflicts, and replaces conflicts when requested. Standard two-argument API passes `true`.
- `unequip_inventory_item(p_assignment)` — removes only the equipment assignment, preserving the owned item.
- Trading RPCs: `list_my_trades`, `list_trade_recipients`, `list_trade_item_labels`, `list_my_trade_currency`, `create_trade_offer`, `counter_trade_offer`, `cancel_trade_offer`, `accept_trade_offer_version` (version-pinned). Confirm exact argument shapes in current source.

**RLS discovery from earlier debugging:** Browser direct reads of `equipment_assignments` and `item_instances` showed zero rows despite the owner having equipped items, because those tables did not have equivalent player-readable SELECT policies. This was fixed by a strictly authorized `list_character_equipped_items` RPC. **Do not loosen table RLS to make the UI work.**

**SECURITY DEFINER functions:** These are privileged operations and must retain proper ownership/character/campaign checks, explicit `search_path`, qualified object references, and restricted EXECUTE grants. Validate with a simulated authenticated user as well as unauthorized users before adding new operations.

## 7. Most recent implementation history

- Ruleset adapter and D&D-first prioritization created; relations normalized after a TypeScript failure.
- Character screen implemented with direct Supabase reads; replaced with secure equipment-display RPC after discovering missing SELECT policies.
- Graphical Inventory wired to the same live item data as the old text list; duplicate text list removed.
- Unequip RPC implemented and user verified.
- D&D slot/category enforcement and single-instance equip protection added; Longsword/Short Sword test item definitions moved from generic `gear` to `weapon`.
- GM category selector added. Category constraints enforced by database.
- Two-handed item metadata and atomic equip-or-replace implemented; user tested.
- Last simplification removed separate **Equip / Replace** controls; `equip_inventory_item(uuid,uuid)` now automatically replaces conflicts. User confirmed full workflow functioning.
- **Baseline commit:** `f759450c5f2e9fa4e8962c3e1a7187dcb20b5e5b`; associated CI run **41568385589, success**.

## 8. Immediate next development choices

The core equip/unequip loop now works. Suggested priorities:

1. **Equipment UX and data rules:** Show valid slots instead of offering incompatible choices; improve equipped-item indicators and item details; standardize labels; make capacity and two-handed occupancy transparent. Preserve single-action automatic replacement.
2. **Richer D&D 5e item model:** Item category, weapon properties, armor properties, weight, value, rarity, magical effects; decide on rule scope and SRD licensing/content provenance.
3. **Containers / backpack:** Nested containers, grouping, sorting/search, individual item information, safely moving inventory between containers.
4. **Currency and loot:** Display actual wallets; design GM-authorized loot distribution. No premature settlement exposure.
5. **Campaign Shops:** GM-managed merchants, stock/price, validated purchases, concurrency-safe currency/item transfers.
6. **Crafting:** Recipes, material prerequisites, player availability, transactional consumption/output creation.
7. **Permissions / quality:** Multi-account RLS/adversarial tests, mobile real-device layout checks, idempotency/transactions, integration tests and monitoring.

The user has not yet selected the precise next task after completing equipment auto-replacement; propose the next practical milestone rather than assuming shop/craft is already ready.

## 9. How to continue in a new chat

1. Open this handoff, `docs/ruleset-architecture.md`, and the latest `src/main.tsx`, `src/CharacterScreen.tsx`.
2. Confirm the repo's latest `main` commit and recent GitHub Actions results. Check the correct Supabase project before any DB action.
3. Ask which next feature to prioritize, **unless the user already gives a task**. Don't repeat validated equipment tests without reason.
4. Preserve working functionality in incremental commits; after each substantive edit, inspect CI logs and test actual RPC logic in reversible transactions. Avoid claiming Cloudflare/browser is verified just because Actions succeeded.
5. When using GitHub/Supabase connected tools, discover relevant actions through the available connectors; don't ask the user to copy data manually when it is accessible.

### Suggested continuation message

> We're continuing Nexus Multiverse, the D&D-first, multi-ruleset TTRPG character inventory app. The equipment loop and automatic conflict replacement work and were confirmed by the user. Our live app is on Cloudflare Workers, GitHub repo `jasonbladesNX/inventory`, Supabase project `fvapsdirjgknxpqlxljx`. Please use `docs/development-handoff-2026-11-02.md` and `docs/ruleset-architecture.md` as the baseline, verify the latest code/CI, then help me implement the next feature without breaking existing security or functions.
