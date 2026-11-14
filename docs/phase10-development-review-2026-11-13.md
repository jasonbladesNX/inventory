# Nexus Multiverse — Phase 10 Development Handoff
Snapshot: 2026-11-13. Baseline: GitHub jasonbladesNX/inventory, main. Supabase project: fvapsdirjgknxpqlxljx. This is the TTRPG character inventory application, not retail inventory.

## Status
Phase 10.1–10.6 implementation committed to GitHub and deployed as database migrations to the existing Supabase project. Rollback-only SQL tests and source-level structural checks passed. Latest GitHub Actions production build and live Cloudflare/iPhone interaction have not been independently verified.

## Milestones
- 10.1: Player-controlled, system-neutral per-character initiative modifier (-100 to 100); saved modifier applies to future GM roll requests.
- 10.2: GM requests initiative for currently active characters in a selected zone. Players submit their d20 results (1–20); GMs can record rolls too.
- 10.3: Scores are roll + captured modifier; server orders by score descending, modifier descending, roll descending, then character UUID. Cannot begin until all roll.
- 10.4: GM edits scores and reorders participants explicitly, retaining the currently active participant when order changes. Before/after adjustments are audited.
- 10.5: Character screen shows roll requests, modifier, own roll/score/position, current combat round, active participant, and a Your Turn indicator. Refresh polls every 15 seconds.
- 10.6: Next Participant advances only initiative, increasing the combat round on wrap and ticking round-duration conditions/effects in that zone. Next + Zone Turn explicitly advances initiative and the Phase 9 zone turn atomically. Other zones are isolated.

## Database
New tables: public.character_initiative_preferences, public.zone_initiative_sessions, public.zone_initiative_entries, public.zone_initiative_events.
New RPCs: set_character_initiative_modifier; get_character_initiative; get_zone_initiative; manage_zone_initiative.
All four tables have RLS, and direct anon/authenticated table privileges are revoked. Authenticated RPCs validate GM rights or character ownership. GM action request UUIDs are unique per zone for idempotence. Zone-level row locks serialize progression.
Important: campaign turn, combat round and individual initiative position remain independent concepts. The combined progression is opt-in.

Applied SQL migrations committed at:
- docs/sql/phase10_zone_initiative.sql
- docs/sql/phase10_initiative_zone_turn_integration.sql
- docs/sql/phase10_audit_initiative_adjustments.sql

Frontend files:
- src/GmInitiativeManager.tsx
- src/CharacterInitiative.tsx
- src/zone-initiative.css
- integrations in src/main.tsx and src/CharacterScreen.tsx.

Regression:
- scripts/test-zone-initiative-10.mjs
- .github/workflows/build.yml (registered new test).

## Verification performed
Rollback SQL integration tests passed: modifier, request, valid and invalid rolls, incomplete-start rejection, score/order, manual changes and before/after audit, both-direction reorder with active actor retained, round rollover, round-only effects, idempotent retries, explicit combined initiative + zone turn, zone isolation, stale roster refusal, invalid zone refusal, denied unauthorized actions/reads and encounter close.
Source-level checks: 15/15 passed for schema, RLS, RPCs, locking, idempotency, timer units, frontend and CI references.
Final live database check before handoff: 0 initiative sessions, 0 initiative entries, 0 initiative events, 0 saved initiative preferences; existing character and zone retained. Tests were rolled back.
Security advisor flags informational RLS-without-policy and authenticated SECURITY DEFINER warnings for these four tables/functions. Intentional restricted-RPC architecture but review before production sign-off.
Not verified: full GitHub Actions run, production TypeScript build, Cloudflare publishing and browser/iPhone end-to-end operation.

## Consolidated acceptance checklist
- [ ] Character screen modifier saves and survives reopening; both positive and negative values.
- [ ] GM Initiative panel lists active zones and starts a roll request for selected zone only.
- [ ] Player sees request and submits d20; 0, 21 and fractional rolls are blocked.
- [ ] GM sees per-character roll and score; cannot start with missing rolls.
- [ ] All submitted rolls produce descending score order and deterministic tie handling.
- [ ] Two zones retain independent initiative status, round counters and rosters.
- [ ] GM score change records before/after and manual reorder preserves active participant.
- [ ] Character sees own position, score, current round and active character; Your Turn updates.
- [ ] Next Participant progresses within current round without changing Phase 9 zone turn.
- [ ] Wrapping last to first increments the combat round and ticks only round effects.
- [ ] Next + Zone Turn explicitly advances both counters/timer categories atomically.
- [ ] Moving a character during an encounter causes a stale-roster rejection until reroll.
- [ ] Encounter can end and restart; audit history persists.
- [ ] Player/non-GM cannot edit GM controls or obtain full GM initiative data.
- [ ] Check layout and 15-second updates on iPhone Safari.
- [ ] Verify latest GitHub Actions build and Cloudflare deployment.

## Known boundaries and future work
Manual initiative modifiers are system-neutral; no automatic DEX or game-system formula yet. d20 rolls are entered, not automatically generated. Only active player characters assigned to a zone join initiative; NPC combatants are not in this milestone. Score editing and position editing are distinct. Changes to zone membership require fresh initiative, rather than invisible mid-round corrections. Mobile push notifications and Phase 11 features are not included.

Use this handoff alongside Phase 9. Continue only after consolidated Phase 10 review, unless the user explicitly requests otherwise.
