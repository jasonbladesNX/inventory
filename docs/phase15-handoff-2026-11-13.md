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


## Phase 15 — Explicit Party Leadership and Transfer (November 14, 2026)

Following acceptance of Party Configuration, user requested one party leader who alone among players can access Configure Party, with the creating player as default and irreversible privilege loss on handoff.

### Changes
- `docs/sql/phase15_party_leadership.sql`: `campaign_parties.leader_character_id`; existing parties backfilled by creator's character where possible, else earliest member; new parties assign first member as leader through `maintain_party_leader` trigger. Existing `created_by` remains an immutable historical field, **not an authorization role**.
- `transfer_party_leadership(p_party,p_target_character)`: only authenticated current leader, recipient must be an active member of same party, no self-transfer, only between GM sessions. Transactional row-lock update, before/after audit event. Immediate old-leader privilege loss.
- `maintain_party_leader` disallows a leader leaving or being removed while other party members remain until they transfer leadership. On an otherwise empty party the last member can leave and leadership becomes null; future first member is promoted automatically.
- `docs/sql/phase15_party_leadership_authorization.sql` and `docs/sql/phase15_party_leadership_auth_correction.sql`: All existing player/GM party data projection and authorization updated: `configure_party`, `remove_party_member`, `manage_party_membership_request`, `list_party_membership_requests`, `list_party_invitable_characters`, `list_player_party_options`, `list_campaign_parties`. Former creator cannot still configure, invite, approve, remove members, or transfer unless they are the newly assigned current leader (or separately authorized as a campaign GM through GM admin permissions).
- `src/PlayerPartyManager.tsx`: roster identifies Party Leader; only the current leader sees **Configure Party**; within configuration, **Transfer Party Leadership** lets the leader pick another current member, confirms permanent loss of power, calls server RPC and refreshes UI. New leader receives their controls after refresh. Bank storage stays with the party.
- `scripts/test-phase15-party-leadership.mjs` registered in GitHub Actions.

### Rollback tests passed
1. Creating player automatically became leader.
2. Leadership transferred Player A → B → C using separate real QA test user accounts.
3. Prior leader immediately lost `is_organizer`, configure permissions, member-removal authorization, invite candidates access, and transfer ability; new leader gained configuration authority.
4. Self-transfer rejected; leader cannot leave while other members remain until handing over.
5. Leadership transfer during active GM game blocked.
6. After handoff, former leader could leave; final member leaving reset vacant leader marker.
7. GM administrative powers remain separate from player leadership role.
No test data persisted. Existing QA campaigns and shared banks remain unchanged.

### Browser acceptance
Test with two player accounts/characters assigned to one party: creator sees **Configure Party → Transfer Party Leadership**. Select another member; confirm; original creator no longer sees Configure Party. Sign in as the recipient and refresh; recipient sees the leader badge and Configure Party and can change settings. Confirm an ordinary member cannot transfer, and transfer is disabled after GM starts the game.

**Build/deployment note:** Server-side rollback tests and source assertions completed. Full TypeScript build, GitHub Actions run and live browser verification not independently confirmed.


### Final party leadership hardening
- `docs/sql/phase15_party_leadership_pending_request_guard.sql`: Former leaders who authored pending invitations cannot cancel them after transferring leadership. Only current leader, GM, or the requester of their own join request may cancel. The pending-request UI applies the same permissions.
- Additional rollback test passed: old leader's attempt to cancel an outstanding invite was rejected; new leader successfully cancelled it.
- `scripts/test-phase15-party-leadership.mjs` now checks this privilege revocation.


## Phase 15 continuation — Party-private chat (November 14, 2026)

The previous GM Party Gameplay view could send private one-to-one party announcements, but players had no shared party message feed. This continuation implements a dedicated conversation.

### Delivered
- `docs/sql/phase15_party_chat.sql`: `campaign_party_messages` table, RLS enabled, authenticated/anonymous direct grants revoked. The only supported access is through `list_party_messages(p_party,p_character,p_limit)` and `send_party_message(p_party,p_character,p_body)`, both authenticated and server-authorized.
- Players may read/send only when the supplied character is active, belongs to the party, and is owned by their active campaign membership; a GM can read/send as GM without requiring a character. Former members immediately lose read/send access. A blank message or body over 2000 characters is rejected. Messages are scoped by exact party UUID, not campaign.
- The feed returns the most recent 50 messages in chronological order; clients can request up to 100.
- `src/PartyChat.tsx` and `src/party-chat.css`: compact mobile-responsive Party Messages list with sender, GM indicator, timestamps, compose field, 2000-character counter, send, refresh, error states, 15-second polling.
- `src/PlayerPartyManager.tsx`: Party Messages appears inside the current-party card for all active members, not only the leader.
- `src/GmPartyGameplay.tsx`: GM Party Gameplay panel includes the same private party chat (GM identity), alongside preexisting direct announcements.
- `scripts/test-phase15-party-chat.mjs`: registered in GitHub Actions.

### Rollback SQL verification (passed)
- Non-member could neither read nor send private party messages.
- Two distinct synthetic test player accounts joined the same party and exchanged messages.
- A GM posted and viewed messages.
- Upon leaving, the prior member could no longer read or send.
- Blank messages rejected. All test messages, parties and session changes rolled back.
- Source integration checks: 10/10 passed.

### Important notes
- Party messages are allowed during active GM sessions; membership and bank locks remain unaffected.
- This is polling, not Supabase Realtime; read markers, typing indicators, attachments, and notifications for offline accounts are not implemented.
- The existing direct GM-to-player message flow remains available separately.
- Full Vite/TypeScript build, deployment and live browser acceptance were not independently verified.

### Browser acceptance
1. With Player A and Player B in the same party, open **My Party → Party Messages**, send from A and refresh B; B should receive the message and be able to reply.
2. GM opens **Party Gameplay**, selects the party, posts a GM message; players see it with GM designation.
3. Player C outside the party should not see its feed. After B leaves, B should immediately lose access to the conversation.
4. Start Game: verify messages still work while bank and membership controls remain locked.
5. Verify mobile message input, timestamps, refresh and no inventory black screen.


## Phase 15 continuation — Player Party Combat Board (November 14, 2026)

Following browser acceptance of private party messaging, implemented the next party gameplay gap: **a shared, read-only player combat status view**, synchronized with the existing Phase 10 GM zone initiative tracker.

### Delivered
- `docs/sql/phase15_party_combat_board.sql`: `get_party_combat_board(p_party,p_character)`. Verifies a caller is a current, active owner of the supplied party character, or an authorized campaign GM. Returns only active party members, grouped by their assigned active campaign zones, including zone initiative phase, round, active turn position, whether a party member is acting, initiative score, roll, position and character HP. Non-party enemy identity is deliberately not included. Uses existing `zone_initiative_sessions`, `zone_initiative_entries`, `character_zone_assignments` as authoritative state, does not create a separate encounter system or modify initiative.
- `src/PartyCombatBoard.tsx`, `src/party-combat.css`: responsive party combat board, highlighted active party member, zone/round/position and HP, manually refreshable plus 15-second polling.
- `src/PlayerPartyManager.tsx`: combat board shown in active party card, alongside Party Messages.
- `src/GmPartyGameplay.tsx`: same board in GM party gameplay view, not replacing the GM's interactive Phase 10 combat manager.
- `scripts/test-phase15-party-combat-board.mjs`: registered in GitHub Actions for source contract regression.

### Database rollback tests (passed)
- GM and the member owning an active party character could read the board.
- A member could not use a different party character's UUID to access it; unrelated signed-in account blocked.
- Synthetic combat arena, encounter session, and two party initiative entries: board correctly returned round 3, active position 1, actor A and two party members; after changing authoritative round/position, board updated to round 4 and actor B.
- Entire test setup, including temporary party/zone/session assignments, rolled back. Permanent QA characters preserved.

### Remaining/verification
- This milestone does **not** introduce player turn advancement or GM initiative modifications from the player UI. The existing GM Zone Initiative Manager remains authoritative.
- The board shows party positions, not every opposing combatant; if an opponent is acting, it says "Another participant is acting".
- Full TypeScript/Vite build, CI execution, production deployment and user browser acceptance not yet verified.

### Browser acceptance
1. GM creates/selects a party with two or more player characters sharing a zone; starts zone initiative using the existing GM Initiative Manager.
2. Players open **My Party → Party Combat Board**, verify round, phase, and individual initiative order.
3. GM advances to the next party member; the highlighted acting character updates after refresh (or the next 15-second poll).
4. Members in different zones appear in separate groupings. Non-members and characters who leave should not access the party board.
5. Combat controls remain GM-only; Party Messages and bank/session locks continue to work.


## Phase 15 continuation — Atomic Batch Party Loot Distribution (November 14, 2026)

Following user browser acceptance of the Party Combat Board, implemented a more capable GM loot allocation workflow on top of the existing single-recipient `distribute_party_bank_loot` RPC. Existing single-item distribution remains supported and unchanged.

### Delivered
- `docs/sql/phase15_party_batch_loot.sql`: `batch_distribute_party_bank_loot(p_party,p_allocations,p_apply=false)`. Requires campaign GM membership, an active campaign, session not running, valid 1–25 row JSON allocation array, active party recipients with carried inventory, positive quantities, compatible bank-stored items and expected original stock counts. Deterministically locks source item rows, verifies aggregate allocation does not exceed stock, and checks expected quantities so stale previews cannot silently transfer other amounts. In preview mode, returns validated allocation summaries but transfers nothing. In apply mode, calls the existing `distribute_party_bank_loot` within the same PostgreSQL transaction; any row failure aborts the entire batch. Existing activity logging is preserved by reusing the established RPC.
- `src/GmPartyLootBatch.tsx`, `src/gm-party-loot-batch.css`: responsive GM editor to add/remove up to 25 allocations. Each row selects item, recipient, quantity; displays source stock. "Preview All" validates; only then "Confirm & Distribute All" performs server-side validation again after explicit confirmation. Edits and stock changes invalidate the preview. Successful apply clears allocations and refreshes bank summary.
- `src/GmPartyGameplay.tsx`: new batch panel below existing Distribute Party Bank Loot action, leaving all GM party mechanics intact.
- `scripts/test-phase15-party-batch-loot.mjs`: source regression registered with GitHub Actions.

### Database rollback verification (passed)
1. GM created a temporary party with two active QA characters and a 10-unit stack of test ingredients in its bank, all inside a transaction.
2. Dry-run returned two validated allocations with no item changes.
3. Over-allocation of 12 units rejected.
4. Stale expected-stock count rejected.
5. Atomic apply distributed 3 to character A, 4 to character B and left 3 in bank; both activity events used existing logging.
6. Non-GM could not preview or allocate.
7. Active GM game session blocked distribution.
8. All test allocations/items/party records rolled back, preserving the user's permanent test data.
9. Source-level integration verification: 15/15 checks passed.

### Browser acceptance
- GM Dashboard → Party Gameplay → select party → **Batch Party Loot Distribution**.
- Add two allocations for the same banked stack to two different party members. Preview and confirm. Verify both recipient inventories and remaining party-bank quantity.
- Preview once, then change an allocation: the old confirmation should disappear.
- Preview, have another user change bank stock, then attempt to confirm. The stale allocation must fail without moving any inventory.
- Start Game: preview/apply must be denied at the database layer; ending game restores access.
- Previous single-item Distribute Loot, Party Messages, and Party Combat Board should continue to work.

**Limitations:** No automatic fair-share/need-before-greed policy or player voting yet. This is GM-directed distribution of eligible top-level bank items, not nested containers, equipment-bound items or reserved items. A full TypeScript/Vite build, GitHub Actions execution, deployment and browser acceptance were not independently verified.


## Phase 15 continuation — Party Loot Requests and Leader Approvals (November 14, 2026)

Following browser acceptance of GM Batch Party Loot Distribution, added a player-driven request/review workflow.

### Delivered
- `docs/sql/phase15_party_loot_requests.sql`: `party_loot_requests` with RLS and no direct anonymous/authenticated table grants, unique pending requests by party/item/character, status/audit history, `list_party_loot_requests(p_party,p_character)` and `manage_party_loot_request(p_party,p_action,p_character,p_item,p_quantity,p_request,p_expected_quantity)`.
- Active party players can request top-level bank items (with expected stock count), see and cancel their pending requests. The current party leader or campaign GM can review, approve or decline. Previous leaders lose approval permissions immediately on leadership handoff.
- Approval atomically validates current party membership, recipient inventory, stock freshness, eligible non-equipped/non-container/non-effect/non-trade item status and the active-game lock; moves/splits the item, logs the bank withdrawal and updates request status within one transaction. Stale requests are rejected rather than silently fulfilled against new bank state. No double approvals.
- `src/PartyLootRequests.tsx` and `src/party-loot-requests.css`: mobile-friendly request form and pending approval queue, with current role/state controls, 20-second refresh and transfer confirmation.
- Player panel (`src/PlayerPartyManager.tsx`) and GM Party Gameplay (`src/GmPartyGameplay.tsx`) both mount the request panel. GM summary and player Inventory revision refresh after approved transfers.
- `scripts/test-phase15-party-loot-requests.mjs` added to existing GitHub Actions workflow.

### Rollback database tests passed
1. Player requested 3 of 7 stocked ingredients; request visible only to permitted accounts.
2. Player self-approval denied; GM approval moved 3 units to the player inventory, leaving 4 in shared bank.
3. Repeating approval rejected; request actions blocked during running game.
4. Leadership transfer A→B: A lost review access and could not approve an existing request; B gained access and approved that same pending request.
5. All test party/items/request state rolled back and existing permanent QA data preserved.

### Important current policy distinction
**This is an optional request/approval workflow.** The established `manage_bank_item` RPC still allows active party members to withdraw shared-bank items directly between sessions, as previously designed. Therefore, approval is *not yet a mandatory withdrawal policy*. A later milestone must add a GM-configurable party-bank withdrawal approval setting and enforce it on every withdrawal path if mandatory leader approval is desired. Do not claim this workflow blocks legacy direct withdrawals.

### Browser acceptance
1. Player opens **My Party → Party Loot Requests**, selects a shared-bank item and requests a positive quantity.
2. Leader opens the same panel and approves; the item moves to the requesting character's inventory and bank decreases accordingly. Other ordinary members cannot approve.
3. Transfer leadership and confirm the original leader loses the approval queue while the new leader gains it.
4. Test Decline, requester Cancel, duplicate request prevention, invalid quantity, stale bank stock, and session lock.
5. Confirm prior GM Batch Party Loot Distribution, Party Chat and Party Combat Board remain functional.

**Build/deploy status:** SQL rollback tests passed; full TS/Vite build, CI run, and browser deployment not independently verified.


## Phase 15 continuation — GM Party Bank Withdrawal Policy (November 14, 2026)

After user browser acceptance of Player Party Loot Requests/Approvals, closed the previously documented direct-bank withdrawal policy gap.

### Delivered
- `docs/sql/phase15_party_bank_withdrawal_policy.sql`: adds `campaign_parties.bank_withdrawal_policy` constrained to `direct` (default, preserving existing games) or `approval`. Authenticated, GM-only `set_party_bank_withdrawal_policy(p_party,p_policy)` validates campaign game session lock, changes policy, and logs a campaign audit event.
- Enforcement is **server-side** in both existing item withdrawal `manage_bank_item` and currency withdrawal `manage_bank_currency`: for party bank withdrawals under `approval`, an authenticated member receives an authorization error and must use an approved request workflow. Deposits and personal-bank withdrawals are unaffected.
- Existing `list_campaign_parties` exposes policy to GM, `list_character_banks` exposes it to a bank-owning player, and `list_party_loot_requests` exposes policy to the party request UI.
- `src/GmSessionPartyManager.tsx`: GM Party Management dropdown for Direct versus Approval Required; disabled while gameplay session is active.
- `src/BankPanel.tsx`: shows approval-required notice and hides direct item withdrawal control for a restricted party bank.
- `src/BankTreasury.tsx`: shows notice and hides direct currency withdrawal control for a restricted party bank.
- `src/PartyLootRequests.tsx`: explanatory policy text points players to item request/approval flow.
- `scripts/test-phase15-party-bank-withdrawal-policy.mjs` registered in GitHub Actions.

### Database rollback tests (passed)
1. Default `direct` allowed an active party player to withdraw an item.
2. GM switched policy to `approval`; direct party item withdrawal and direct party currency withdrawal both rejected with authorization errors.
3. Non-GM was denied permission to change policy.
4. Player could create an item loot request and GM-approved fulfillment still moved the requested item quantity into that player's carried inventory.
5. GM restored `direct` and direct withdrawal worked again.
6. During an active game session even the GM could not change the policy; the GM could change it once the session ended.
7. All test parties/items/policy changes were rolled back.

### Deliberate limitation
This phase extends mandatory leader/GM approval to **items** via `Party Loot Requests`. Under `approval` policy, **currency withdrawals are blocked**, but there is **not yet a currency approval-request UI or approval RPC**. Deposit operations remain available between sessions. Consider a dedicated Party Currency Requests milestone next rather than weakening the existing currency guard.

### Browser acceptance
1. GM Dashboard → Party/Session Manager: find **Party bank withdrawal policy** and set Approval Required.
2. Player Inventory → Home & Party Banks: party item Withdraw button hidden; personal bank Withdraw remains available. Party Treasury direct currency Withdraw hidden.
3. Player My Party → Party Loot Requests: request item; leader or GM approves; quantity moves to player, leaving correct bank quantity.
4. Change policy back to Direct; player party item/currency withdraw actions reappear.
5. Start game: changing the policy denied, existing bank session lock still works.
6. Confirm all other Phase 15 flows remain available.

**Status:** Database integration tests and source checks performed; full TypeScript/Vite build, GitHub Actions execution and live browser acceptance not independently verified.
