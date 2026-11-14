# Nexus Multiverse — Phase 15 Development Handoff
**Date:** November 13, 2026
**Project:** `jasonbladesNX/inventory` — Supabase `fvapsdirjgknxpqlxljx`
**Status:** Party membership and BOTH requested bank features implemented and rollback-tested. Remaining party gameplay integration not completed.

## User requirements added to Phase 15
1. **Personal Bank:** back-home, off-character inventory. Banked items cannot be equipped, moved, consumed or traded during an active GM-started game.
2. **Party Bank:** shared storage for any active character in a party; deposits and withdrawals between sessions only.
The game session is a GM-controlled explicit active/inactive state. The two banks use separate inventory holders outside carried character inventory. Server-side controls, not merely disabled UI buttons, enforce restrictions.

## Delivered
- `docs/sql/phase15_party_banks.sql`: `campaign_session_state`, `campaign_parties`, `campaign_party_members`, `campaign_banks`, `campaign_bank_activity` with RLS, direct grants revoked, dedicated authorized RPCs.
- `manage_campaign_session(p_campaign,p_running)`: GM starts or ends a game; session row is locked. All bank deposits and withdrawals acquire same row lock to prevent races.
- `manage_campaign_party`: GM creates/names parties and assigns/removes active characters. Unique campaign-member party assignment prevents conflicting membership. Creation provisions a shared vault holder.
- `list_character_banks`: active character only; creates private personal bank lazily and lists only personal plus party banks the character belongs to.
- `manage_bank_item`: full or partial stack deposit/withdraw; verifies authenticated character ownership, active party membership, carried vs bank holder, capacity, quantity, equipped items, active trades, nested/linked containers, persistent item effects. Preserves item properties and records activity.
- `app_private.block_live_bank_items`: BEFORE item-instance mutation trigger rejects all changes involving bank holders during active sessions, including alternate GM/item RPC paths.
- `docs/sql/phase15_bank_equipment_guard.sql`: independent trigger blocks equipping any bank-held instance.
- `docs/sql/phase15_bank_effect_container_guard.sql`: refuses moving items with persistent effects or linked container sources to a bank.
- `docs/sql/phase15_party_session_views.sql`: GM-scoped party roster and authenticated campaign session state views.
- `docs/sql/phase15_bank_treasury.sql`: secured personal/party currency balances, deposit and withdrawal, audited balance moves and bank-wallet session locks.
- `docs/sql/phase15_bank_wallet_hardening.sql`: rejects bank wallet holder changes and old/new balance transfer attempts while running.
- `docs/sql/phase15_bank_activity.sql`: private bank item/currency activity history visible only to the owner or current party members.
- `src/BankPanel.tsx` and `src/bank-panel.css`: responsive Character Inventory banking card, deposit/withdraw controls, party and personal sections, active-session lock banner, history, refresh.
- `src/BankTreasury.tsx`: currency balances and transfer UI per bank.
- `src/GmSessionPartyManager.tsx`: GM start/end-game control, party creation and membership.
- `src/FeatureErrorBoundary.tsx`: bank widget failure cannot black-screen main Inventory page.
- `src/main.tsx`: GM dashboard and Inventory integration.
- `scripts/test-phase15-party-banks.mjs` wired into GitHub Actions.

## Database verification (rollback only; no user records changed)
1. Personal bank created and an eligible item deposited and withdrawn.
2. Starting a game rejected withdrawal and even direct bank item updates.
3. Two separate players in a GM-created party: first deposited an item, second withdrew into their own inventory.
4. Another party member could not access the first player's personal bank.
5. Partial-stack deposit and return conserved total quantities.
6. Unauthorized outsider was refused personal-bank read, withdrawal and game start.
7. Personal currency deposit/withdraw conserved balance and bank transfer was blocked while playing.
8. Party currency deposited by first player and withdrawn by second only between sessions.
9. Reassigning a bank currency balance or bank wallet holder during a running session was blocked.
10. Bank activity listing executed successfully.
All synthetic accounts, inventory and currency movements, party memberships, session state changes, and bank allocations from tests rolled back.

## Remaining Phase 15 roadmap
- 15.1 Party creation/membership: **implemented**.
- 15.2 Shared party items and personal bank: **implemented for eligible top-level stacks**; recursive nested-container banking intentionally blocked.
- 15.3 Party treasury: **implemented**.
- 15.4 Group loot distribution: **not yet integrated** into the new party UI.
- 15.5 Party trading and transfers: **shared-bank item/currency deposits and withdrawals implemented**; dedicated party-to-party trade workflow not implemented.
- 15.6 Party positioning in zones: **existing Phase 9 zone facilities; party-level controls not implemented**.
- 15.7 Party initiative/combat coordination: **existing Phase 10 initiative; party-level controls not implemented**.
- 15.8 Shared rest/time advancement: **not implemented**.
- 15.9 Party messages/GM controls: **existing Phase 11 campaign messages and new Phase 15 GM party controls; party-specific message audience not implemented**.
- 15.10 Integration/browser tests: **database rollback tests passed; live frontend and full TypeScript/CI build unverified**.

## Important data and rules caveats
- Banked items are outside a character inventory holder, so other character inventory/equip/quick-use/trade RPCs do not see them. The database also rejects mutations of those item instances during the live session.
- A bank transfer fails if an item is equipped, nested, linked to a container or persistent item effect, or reserved in an active trade. A whole top-level stack can retain its item UUID when moved; partial stacks create a new item instance for the separated quantity.
- Players may inspect bank content during games, but cannot change it.
- Currency precision and available balance are checked server-side.
- Campaign transfers of characters with personal bank references remain blocked by Phase 12/13 migration preflight until bank mapping is implemented.
- Separate parties do not share banks.
- All public bank tables have RLS enabled and direct authenticated grants revoked; operations go through restricted RPCs.
- No production deployment or user browser acceptance has been verified in this run.

## Consolidated browser acceptance
- GM creates a party; assigns two characters from separate accounts.
- Each character sees private personal bank plus the same party bank in Inventory.
- Person A stores an item; Person B withdraws it and sees inventory update.
- Person B cannot see or withdraw Person A's personal bank.
- Personal and party currency deposits/withdrawals preserve balances.
- Partial stack splits and withdrawals show correct totals and activity history.
- GM starts game; all bank item/currency controls lock; no quick-use/equip/trade of banked items.
- GM ends game; transfers unlock.
- Reject equipped, nested and active-trade-reserved items.
- Verify iPhone layout and that Inventory cannot black-screen from bank UI errors.

**Handoff stop point:** User-requested personal and party banks implemented with server locks; Phase 15 full broader party gameplay roadmap remains incomplete.


## Phase 15 continued gameplay implementation (supersedes older pending roadmap descriptions above)
- `docs/sql/phase15_party_gameplay.sql`: GM-only `manage_party_gameplay` atomic party zone move, short/long rest through existing per-character RPC, and per-user private party GM message; `get_party_gameplay_summary` returns party roster, zones, HP, initiative summary.
- `docs/sql/phase15_party_loot_distribution.sql`: GM distribution of party bank loot to active party members between sessions; full/partial item stacks, audited and locked while game active.
- `docs/sql/phase15_party_bank_loot_preview.sql`: GM gameplay summary includes party bank item entries for distribution UI.
- `src/GmPartyGameplay.tsx`: GM party roster/initiative, zone moves, group rest, private message, bank loot distribution, all with confirmation and error feedback.
- `src/main.tsx`: GM Party Gameplay panel.
- `docs/sql/phase15_bank_wallet_hardening.sql`: bank wallet balance and holder reassignment blocked while game active, even by alternate mutations.
- `docs/sql/phase15_bank_activity.sql`: item/currency history of personal/accessible party banks, rolled-back query tested. `src/BankPanel.tsx` shows bank activity.
- Phase 15 source regression suite expanded, registered in GitHub Actions.

Additional rollback SQL tests passed: two-party-player currency deposit/withdraw; wallet old/new and holder reassignment attempts blocked in active session; GM party zone moves, group long rest, direct party messaging; GM party-bank loot preview/distribution blocked during game and allowed between games.

### Updated milestone status
- 15.1 Party creation & membership: core implemented.
- 15.2 Shared items, individual home bank and party bank: implemented with server-side between-session restrictions; nested containers intentionally restricted.
- 15.3 Personal & party currency bank/treasury: implemented.
- 15.4 Group loot distribution: GM party-bank distribution implemented; advanced claim/award policies not implemented.
- 15.5 Party item/currency transfers: shared-bank transfers implemented; dedicated multi-party trade negotiation not implemented.
- 15.6 Party movement across zones: GM bulk party move implemented.
- 15.7 Party initiative: GM party initiative **summary** implemented, not a separate coordinated party initiative engine.
- 15.8 Group rests: implemented through existing character rest rules and atomic transaction, no separate group downtime planning.
- 15.9 Party GM messages: private messages sent to party participants; player-to-party chat not implemented.
- 15.10 Database rollback tests and source regressions implemented. **Live Cloudflare UI/browser checks and actual full TypeScript build remain unverified.**

**The personal and party banks are the core delivered user-requested additions.** Remaining optional party-gameplay expansions should be separately scoped and browser-tested. No existing campaign data was mutated by rollback tests.


## Player party self-service follow-up — November 14, 2026

### Gap corrected
Prior Phase 15 party creation and membership controls were GM-only. Players could use party-bank storage once a GM assigned them but had no player-facing way to create, join, or leave a party.

### Implemented
- `docs/sql/phase15_player_party_self_service.sql`: authenticated `list_player_party_options(p_character)` and `manage_player_party(p_character,p_action,p_party,p_name)`.
- A player can create a named party (auto-joins them and provisions a shared party bank), join an existing party in the same active campaign, or leave their current party.
- One active party per character; a character cannot change parties while the GM session is running. Every operation checks ownership and active campaign membership, locks the session row, and emits an audit event. No open invitation is needed for the default join flow; available campaign parties are discoverable to active characters.
- Leaving revokes future shared-bank access but **does not** delete the party, its shared holder, items, or currency.
- `src/PlayerPartyManager.tsx`, `src/player-party.css`: compact responsive panel for Current Party/roster, Create Party, Join Party, Leave Party and lock status.
- `src/main.tsx`: player party controls under each character in the Player Portal and in gameplay, within a recoverable feature boundary. `src/app-pages.css` adds portal accordion styles.
- `scripts/test-player-party-self-service.mjs` added to GitHub Actions regression suite.

### Database rollback tests
1. Owner created a party; auto-membership and shared bank confirmed.
2. Duplicate membership/create rejected.
3. Leaving a party during active GM session rejected.
4. Leaving between games removed membership but preserved shared party bank.
5. Joining a separate party worked.
6. Another user cannot mutate the player's membership.
7. Two distinct test characters/users: discover party, join, see party bank; leave, lose bank access; unknown-party join denied; game-session join denied.
All data changes from these tests rolled back. The 10 permanent QA characters remain intact.

**Verification outstanding:** Full TypeScript/Vite build and live mobile/browser acceptance still need checking. GM Dashboard party management remains available. Future enhancements may include invitations/approval requests for private parties and leadership permissions; default parties are open to any active character in that campaign.

### Player-party bank refresh integration
- `BankPanel` now accepts an optional `revision` counter, and its data-refresh effect reacts to membership changes. `src/main.tsx` passes the existing inventory revision; player create/join/leave advances that counter so newly available party banks appear promptly.
- No live GitHub Actions run was available for the latest commit during this check; browser and build acceptance remain outstanding.


## Phase 15 continuation — Party approvals, invitations and organizer controls (November 14, 2026)

Following user browser acceptance of self-service create/join/leave and shared bank access, implemented a controlled-enrollment workflow that preserves **open** as the default.

### Delivered
- `docs/sql/phase15_party_approval_invites.sql`: `campaign_parties.join_policy` (`open` or `approval`); private `party_membership_requests` ledger; player join requests, organizer/GM invitations, approve/decline/cancel with authenticated authorization; GM-only join-policy changes; request list scoped to the player's active character, organizer or GM.
- `docs/sql/phase15_party_policy_rpc_updates.sql`: existing direct-join RPC rejects approval-required parties (server-side), exposes join policy and organizer metadata to players/GM. Existing open-party join behavior retained.
- `docs/sql/phase15_party_invite_candidates.sql`: current organizer/GM can list invite-eligible campaign characters who do not belong to another party or already have a pending request.
- `docs/sql/phase15_repeat_party_request_fix.sql`: previous accepted/rejected requests no longer prevent future invitations; unique *pending* request index remains.
- `docs/sql/phase15_gm_party_session_lock.sql`: GM create/add/remove operations now obey the active-session lock too.
- `docs/sql/phase15_party_organizer_membership_guard.sql`: leaving a party revokes the former organizer's privileges to invite and review, while GM authority persists.
- `src/PlayerPartyManager.tsx`: player requests to join approval-required parties; organizers invite other characters and review pending join requests; invited players accept/decline. Keyboard submit and button click both honor join policies.
- `src/GmSessionPartyManager.tsx`: GM select Open/Approval Required for each party.
- `src/player-party.css`: compact pending request UI.
- `scripts/test-phase15-party-approvals.mjs`: wired into CI, source-contract validation.

### Database integration tests (all rollback-only, no lasting test-party data)
1. Open-party behavior continues to work through the existing join path; approval-required join rejected if submitted directly.
2. Player requests, and organizer/GM approvals, create membership; player cannot approve own join request.
3. Organizer invites, targeted player accepts, member receives access; arbitrary accounts cannot invite.
4. Only GM changes join policy; duplicate pending requests blocked.
5. GM/member mutations and pending approvals blocked during live session.
6. Re-invitation after an earlier accepted membership and later leave succeeds.
7. Party founder loses organizer privileges after leaving, including invitee-list access.

### Remaining considerations
- The default remains `open`; GMs must set a party to `approval` before join requests are required.
- An invitation may be accepted regardless of the party's open/approval policy; acceptance always belongs to the invited player's active character.
- No external notifications are sent to offline users; the pending requests display on the Player Portal or gameplay party panel when refreshed.
- Live TypeScript/Vite build and browser acceptance of this latest UI remain unverified; do not mark this continuation accepted without a browser test.


## Phase 15 continuation — Player Party Configuration (November 14, 2026)

User reported that there was no way to configure a party from the player interface, despite the GM having a join-policy dropdown. This UI gap is corrected.

### Implementation
- `docs/sql/phase15_party_configuration.sql`: `configure_party(p_party,p_name,p_policy)` and `remove_party_member(p_party,p_character)`. Authorized to the **current player organizer** (original creator who still controls an active character in that party), or the campaign GM.
- Organizer can edit party name, choose `open` or `approval` join policy, and remove another member.
- Renaming the party also updates its shared bank holder's display name, without changing item/currency ownership.
- Member removal revokes bank access by removing the character's party membership; all shared bank contents remain unchanged.
- Both RPCs lock/validate the campaign session and refuse changes while GM gameplay is active. Changes are audit-logged and public/anon function access revoked.
- `src/PlayerPartyManager.tsx`: **Configure Party** toggle for organizers within My Party, with a compact edit form, Save Party Settings button and Manage Members rows; disabled during active gameplay.
- `src/player-party.css`: responsive settings and roster controls.
- `scripts/test-phase15-party-configuration.mjs`: source regression registered in existing GitHub Actions workflow.

### Rollback-only SQL tests
- Party rename and approval-policy update succeeded.
- Shared bank display name updated, retaining the same holder.
- Ordinary party member could not edit settings.
- Organizer could remove another party member between games.
- Rename and member removal blocked while GM game session was active.
- Former organizer lost party editing access after leaving; GM could still configure an orphaned party.
- All test changes rolled back.

### Browser acceptance required
Open a character that **created and currently belongs to** a party; under Player Portal → Manage [Character]'s Party or gameplay → My Party, click **Configure Party**. Change party name and join policy, verify a different player sees the updated join requirement, and remove a test member. Confirm the GM Start Game lock disables changes. A regular member should not see the configuration button.

**Verification caveat:** DB tests and source-level checks performed; actual TypeScript build, deployment and live player browser checks remain unverified. No real-party data modified.
