# Nexus Multiverse — Automatic Stacking Revision

Approved rule: **Automatically stack compatible non-equippable supplies. Never stack equippable items.**

## Current behavior
- New standard acquisitions use the catalog's item category and ruleset slot categories.
- Weapons, armor, shields, rings, jewelry, clothing, headgear, footwear,
  spellcasting focuses, tools, wondrous items and containers are acquired as
  individual item instances, each quantity 1.
- Non-equippable supplies (gear, consumables, ammunition, materials, components,
  miscellaneous, supplies) can consolidate if the definition permits stacking.
- Auto consolidation occurs on authorized `add_inventory_item` acquisition
  and on normal `move_character_item_storage` changes.
- Two stacks must share the same owner/holder, container, definition, identified
  status, condition, custom name, full public and private properties.
- Items with per-instance effects or active item ledger/loot/merchant references
  are excluded from destructive consolidation.
- Explicit Split Stack appears in the expanded item details for qualifying
  multi-unit supply stacks. Splitting allows temporary separation for quantity
  management, while subsequent acquisition/movement combines matching stacks.
- The old manual Consolidate choice is removed from the Inventory stack UI.
- Quantity movements still respect the existing container capacity checks.
- Existing Trash action and equip rules are unchanged.

## Why equippable items stay separate
Equippable units can have distinct slots, identification, effects, wear,
customization and inventory references. Multiplying the quantity on a single
instance would prevent safe individual equip or replace handling.

## Safeguards
- The server enforces stack classification even for direct RPC calls.
- Equippable/unique items are rejected by stack split, merge or partial
  quantity-move actions.
- Existing equipment instance stacks with quantity>1: none found at migration.
- Acquisition of >500 equippable items in one request is rejected to avoid
  excessive per-unit creation.
- Merging is transactional and retains an existing item-instance ID.
- Changes respect the existing authenticated and campaign authorization
  rules. Private helper functions have no direct client grants.
- Existing item history records retain movement item names and character ID
  even when a moved supply stack is consolidated.

## Intentional current boundary
Legacy item trade settlement uses transaction_line item-instance references,
which must not be silently deleted. Trade-delivered items currently remain
separate when their historical transaction references require it; automatic
consolidation of traded inventory requires a separately audited trade-ledger
migration. The current release does not rewrite trade history.

## Acceptance checks
1. Acquire 5 identical torches into a character already carrying torches,
   verify a single combined carried stack.
2. Acquire two identical Longswords, verify two separately equipable entries.
3. Acquire two rings or armor items, verify separate entries.
4. Open a stack of at least 2 supplies, confirm Split Stack is available.
5. Open a sword or ring, confirm Split Stack is absent.
6. Move part of a known-weight supply stack into a pouch/backpack, verify
   separate locations and correct weights.
7. Move those supplies back, verify automatic recombination in carried inventory.
8. Confirm different conditions/custom properties prevent automatic combination.
9. Verify storage movement and acquisition history remains readable.
10. Confirm Loadout Health, Equip/Unequip, Trash and inventory filters unaffected.

## DB migration and CI
- docs/sql/automatic-stack-non-equippable-only.sql
- scripts/test-automatic-stacking.mjs
- scripts/test-stack-management.mjs
