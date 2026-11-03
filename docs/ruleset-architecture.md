# Nexus Multiverse — ruleset architecture (development baseline)

## Product direction
Ship a complete Dungeons & Dragons 5e experience first, but do not make
D&D assumptions part of the shared inventory, authorization, or data model.
The initial mobile navigation follows the approved Nexus Multiverse mockup:
**Character | Inventory | Shop | Craft**.

## Layer boundaries

1. **Core domain (system-neutral):** campaigns, players, characters, item
   definitions and instances, containers, equip assignments, currencies,
   wallets, merchants, recipes, trades, audit events, and permissions.
2. **Versioned ruleset records:** `game_systems` and `ruleset_versions`
   in Supabase. Each campaign references a particular ruleset version.
   Attributes, slot conventions, denomination ratios, encumbrance model,
   and rule-specific metadata are supplied by configuration, not global
   hard-coded columns.
3. **Presentation adapters:** `src/rulesets.ts` maps a ruleset code to
   UI labels and preferred character-sheet presentation. The generic
   fallback must work for unknown or homebrew game systems.
4. **UI modules:** shared touch-friendly components with a D&D 5e initial
   experience. A ruleset adapter formats domain data, never bypasses
   Supabase authorization or alters transactions.

## Initial D&D 5e support
- Both existing published SRD 5.1 and SRD 5.2.1 versions remain available.
- Standard ability codes: STR, DEX, CON, INT, WIS, CHA.
- Display equipped items grouped by configured equipment slots.
- Show derived equipment effects without assuming every RPG uses D&D stats.
- Format coins from the selected ruleset's stored denominations.
- Weight is the initial capacity model; other systems may use bulk or none.
- Inventory and equip actions must continue using existing secured APIs.
- Shops and crafting get real features later, not fake buttons or sample
  transactions. Keep disabled/unavailable actions visibly labeled.
- Loot/trade settlement is deliberately **not enabled** for player calls
  until authorization, double-spend, and multi-account checks are complete.

## First delivery sequence
1. Ruleset metadata and system adapters (started).
2. Responsive Nexus Multiverse shell and Character screen, loading actual
   selected campaign/character data; no fake game-state values.
3. Equipment slot details, currency wallet display and active bonuses.
4. Inventory/backpack views including nested containers and item details.
5. Shop UI backed by campaign merchants and server-authorized checkout.
6. Craft UI backed by recipe requirements and atomic material consumption.
7. Multi-account permissions, mobile usability and end-to-end tests.

## Non-negotiable design constraints
- Never make D&D 5e the only selectable system.
- Never use frontend labels or local state as security authorization.
- Preserve item ownership, RLS, campaign membership and GM capabilities.
- Treat JSON configuration as versioned ruleset data, not executable code.
- Keep live settlement privileges disabled until explicitly verified.
