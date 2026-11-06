# Nexus Multiverse — Milestones 6.16–6.20

This release bundles five sequential feature increments. No user acceptance test is
assumed to have occurred for the intermediate milestones. Existing item transactions,
character attributes, equipment replacement, inventory containers and permissions are
not modified by this release.

## 6.16 — Loadout Health Overview
- Read-only audit of currently equipped items and active rule requirements.
- Overall equipped-item count and count of items failing one or more rules.
- Clear valid/needs-attention statuses, no automatic unequipping.

## 6.17 — Equipment Dependency Map
- For each equipped item, project effects if that item were removed.
- Show the other equipped items that would newly fail a minimum attribute rule.
- Display current and post-removal scores alongside requirements.

## 6.18 — Forbidden-Category Conflict Audit
- Audit existing equipped-category exclusion rules, including invalid loadouts.
- Show the actual conflicting equipped item name.
- Flag unsupported or malformed requirement configurations for GM review.
- No mutation; the existing transactional equip/replace checks remain authoritative.

## 6.19 — Guided Repair
- Highlight equipment currently failing requirements.
- Provide a Review Unequip option for an affected item.
- Show a centered, keyboard-accessible confirmation dialog before proceeding.
- Delegate to the existing authorized unequip flow, including its dependency
  warning. Never remove multiple items or rewrite character data automatically.

## 6.20 — Consolidated Report and Refresh
- Copy a text snapshot using the local browser clipboard after user action.
- Manually refresh loadout health and recalculate after item/attribute changes.
- Filter between issues-only and a complete equipped-item audit.
- Preserve Nexus Multiverse mobile layout and fixed bottom navigation.

## Data contract and security
- public.list_character_loadout_audit(p_character uuid)
- public.list_character_equipment_dependency_map(p_character uuid)
- Both are STABLE, SECURITY DEFINER with empty search_path.
- Both reuse existing character-scoped ownership/GM authorization.
- GRANT EXECUTE to authenticated only; anon and public denied.
- No new tables, RLS changes, inventory update RPCs, or write privileges.
- Existing source effect resolver and equip transactions remain unchanged.

## Regression coverage
- GitHub Actions TypeScript, syntax and Vite production build.
- Existing equipment, inventory and page-navigation contract checks.
- New component server-render smoke test.
- SQL tests under a simulated character owner and unauthorized user.
- Category conflict checked inside a rolled-back transaction.
- Browser acceptance is performed once after deployment of the combined release.

## Explicit limitations
- The health audit evaluates configured minimum effective-attribute requirements,
  forbidden equipped categories and requirement configuration validity.
- It does not automatically resolve circular prerequisites or turn-based combat
  statuses, and does not validate all possible game-system-specific restrictions.
- Dependency links are derived from currently valid requirements that would be
  broken by removing a single item. Already-invalid rules are displayed in health
  status rather than counted as new removal dependencies.
