# Nexus Multiverse — Phase 13 Handoff
**Date:** November 13, 2026
**Project:** `jasonbladesNX/inventory`; Supabase `fvapsdirjgknxpqlxljx`
**Status:** Phase 13 mapping foundation implemented; full populated-character migrations NOT COMPLETE.

## Delivered
- `docs/sql/phase13_migration_manifest.sql`: private, RLS-enabled `character_migration_manifests` storing a per-transfer non-destructive mapping review.
- `preview_character_migration(p_request)`: authorized character/GM-only item definition, slot, currency and learned recipe matching candidate snapshot. Currency base factors and current balances included; never silently converts currencies.
- `save_character_migration_manifest(p_request,p_mapping,p_review)`: destination GM only, after source+destination approvals; saves a reviewed mapping without moving inventory. Strict JSON-object input and max size.
- `src/CharacterTransfers.tsx`: approved transfer's mapping preview and source/target match counts, with GM-only save action.
- Existing Phase 12.6 atomic dependency-free migration path retained. Populated characters remain blocked, protecting composite campaign FKs and existing equipment, nested containers, wallets, crafting, trade, and history records.

## Database tests (rollback only)
- Populated character returned item mapping candidates.
- Preview did not perform migration.
- Manifest review before dual GM approval was rejected.
- Destination GM could review and store mapping after approvals.
- Unauthorized account could not view the mapping.
- All test campaigns, transfer requests and manifests rolled back.

## Outstanding roadmap items
13.2 Inventory and nested-container graph conversion, 13.3 equipped slots/effects, 13.4 explicit currency conversion rules, 13.5 learned recipes and active jobs, 13.6 cross-ruleset transformations, 13.7 pending trade/loot handling, 13.8 user-reviewed final mapping, 13.9 transactional conversion and audit/undo, 13.10 end-to-end browser acceptance.

**Do not state Phase 13 full migration complete.** At this handoff only mapping preview/review is implemented and tested. Live Cloudflare frontend and CI build unverified. All migration changes must be transactional and preserve source records until conversion is proven safe.


## Validated mapping follow-up
- `docs/sql/phase13_mapping_validation.sql`: `validate_character_migration_manifest` checks every populated item definition, equipment slot, currency, and learned recipe against the destination campaign candidates, reports missing/invalid selections.
- `docs/sql/phase13_review_validation_guard.sql`: `save_character_migration_manifest(...,p_review=true)` now refuses incomplete/invalid mappings; `p_review=false` still permits drafts.
- `src/CharacterTransfers.tsx`: per-source destination dropdowns, draft vs reviewed mapping actions. No destructive populated-character migration.
- Rollback test: populated character with no destination mappings -> validator returns missing mappings; reviewed save rejected, draft save accepted.
- Phase 13 source regression updated and registered in CI.
**Still pending** actual atomic conversion of populated inventory, nested containers, equipment, currency, crafting data, active histories and bank ownership. Entire Phase 13 cannot be marked accepted from mapping tests alone.
