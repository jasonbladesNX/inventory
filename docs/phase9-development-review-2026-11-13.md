# Nexus Multiverse — Phase 9 Development Review / Handoff
**Date:** 2026-11-13
**Scope:** Milestones 9.1–9.6 implemented together at user request; manual browser/iPhone sign-off intentionally deferred.

## Current infrastructure
- GitHub: `jasonbladesNX/inventory`, `main`.
- Supabase project: `fvapsdirjgknxpqlxljx` **only**.
- React 19 + TypeScript + Vite, web on Cloudflare Workers.
- Phase 8 CSV imports remain untouched.
- Phase 10 initiative is not implemented.

## Phase 9 implementation
| Milestone | Delivery |
|---|---|
| 9.1 | `campaign_zones` and `character_zone_assignments`; GM create/rename/disable/enable zones and move characters; default zone created/backfilled for existing and new campaigns and characters. |
| 9.2 | Zone-specific integer turn counter starting at zero; no shared global clock. |
| 9.3 | GM-only `manage_campaign_zone` advancement with row locking and unique per-zone request UUID for idempotent retries. |
| 9.4 | Each zone turn decrements **turn-unit** temporary HP durations, conditions, and timed effects on its current active characters. Expired turn effects are removed. **Round, minute, hour, rest, permanent** remain untouched. This is intentionally separate from existing personal character time and rest actions. |
| 9.5 | Character screen shows the zone and its turn, polls every 15 seconds and refreshes character data if zone or turn changes. |
| 9.6 | `zone_time_events` audit for moves, zone changes, advances, corrections and undo. Corrections require reason and change only the displayed counter; effects are **not retroactively adjusted**. Undo latest advance only, with snapshot conflict and unchanged-roster checks. |

## Files
- `docs/sql/phase9_zone_time_management.sql`: current migration and secured RPC definitions.
- `src/GmZoneManager.tsx`, `src/CharacterZoneStatus.tsx`, `src/campaign-zones.css`: new interfaces.
- `src/main.tsx`, `src/CharacterScreen.tsx`, `src/CombatStatusPanel.tsx`: integrations and time-action wording.
- `scripts/test-zone-management-9.mjs`: structural regression checks, added to `.github/workflows/build.yml`.

## Security
- New tables have RLS enabled and direct `anon`/`authenticated` table rights revoked.
- RPCs check campaign membership or character authorization; writes require `app_private.is_gm(p_campaign)`.
- Cross-campaign zone references are constrained by composite foreign keys.
- Advances serialize on the selected zone row and require a request UUID.
- Event snapshots are not exposed through the read RPC; history returns metadata only.
- No user data was intentionally overwritten during verification. All functional DB tests used transactions ending in `ROLLBACK`.

## Verified backend checks
- Migration applied successfully; follow-up function error was fixed in a second recorded migration.
- Rollback tests passed: zone creation, moving characters, occupied zone disable rejection, independent counter advancement, turn effect decrement/expiry, round effect non-decrement, repeated request idempotency, safe undo, audited correction, unauthorized writes.
- Additional rollback tests passed: moved characters do not tick in the previous zone, other zone counters remain unchanged, unsafe undo after unrelated character changes is refused, unauthorized campaign/character zone reads refused.
- Persistent final sanity check: 1 zone, 1 assignment, 1 existing character, 0 zone events, 0 missing assignments.
- Structural regression script is checked into CI; the latest GitHub Actions run and production bundle **were not independently confirmed** in this handoff. Do not claim browser or iPhone tests passed.

## Consolidated Phase 9 acceptance checklist
1. In GM Dashboard, open **Campaign Zones & Time** and verify **Default Zone** contains the existing character.
2. Create **Floor 1** and **Floor 2**; verify separate counters start at 0.
3. Rename Floor 1; confirm name saves.
4. Move a character into Floor 1; confirm roster and the character's screen zone label.
5. Attempt to disable occupied Floor 1; it must be blocked.
6. Disable empty Floor 2; confirm disabled zone cannot accept character moves or advances; re-enable.
7. Advance Floor 1 twice; confirm its counter advances to 2 while other zone counters do not.
8. Give the character a 2-turn timed condition and 2-round timed condition; advance Floor 1 once; turn condition decreases, round condition does not.
9. Advance again; turn condition expires; round condition remains.
10. Confirm browser character screen shows the new zone turn after automatic refresh or reopening.
11. Try undo latest advancement immediately using a reason; confirm turn and effects restore.
12. Make an intervening change to the character and attempt undo; the operation must be blocked instead of overwriting data.
13. Enter a different target turn with reason; correction updates counter without silently changing effects.
14. Open history and confirm advances, moves, corrections and undo appear with times and reasons.
15. With a non-GM account, confirm zone changes/advances are unavailable and unauthorized RPC calls fail.
16. On iPhone Safari, confirm compact controls, dropdowns, zone status and refresh behavior.

## Known boundaries / follow-up
- No Phase 10 initiative or combat-round progression has been added.
- Existing personal **Advance Time** still advances that character's effect timers, independently of GM zone turns; it does not change the zone turn.
- Automatic refresh uses polling at 15-second intervals, not realtime subscriptions.
- Correct-to-turn does not replay or reverse effect durations; use undo only when safe.
- No automated multi-session race harness or device test was available. Verify the current GitHub Actions run and published Cloudflare app before claiming a successful production release.
