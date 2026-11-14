# Nexus Multiverse — Phase 12 Development Handoff

**Date:** November 13, 2026
**Repository:** `jasonbladesNX/inventory` (`main`)
**Supabase project:** `fvapsdirjgknxpqlxljx`
**Scope:** TTRPG character inventory app. Builds on accepted Phase 11 GM-to-player messaging fix.

## Status

Delivered a functional player-to-player QR trade workflow with tested settlement, plus a cross-campaign character transfer request and dual-GM approval workflow. The cross-campaign **actual movement of character/inventory data is not implemented**; approved transfers deliberately remain `approved_pending_migration` until a safe atomic migration can handle the dependent campaign-specific records.

Production GitHub Actions results, full TypeScript build, Cloudflare deployment, and two-device/browser verification have not been independently confirmed. The user accepted the Phase 11 messaging fix, but has not yet accepted Phase 12.

## Delivered work

### 12.1 — QR trade invitation navigation

Existing `TradeQR` generates a link containing the campaign and trade ID. Added Player Portal detection and an **Open trade as [character]** action for characters in the invited campaign. Authenticated users reach the correct character's Inventory tab, where the pre-existing `Trading` component validates trade participation and scrolls to the invitation.

A QR scan is not authorization. Recipient must authenticate and explicitly accept the offer.

### 12.2 — Two-party, versioned trade settlement

Existing settlement RPCs were inspected and tested using rollback-only transactions. A full two-account test created a temporary recipient, entered a valid stackable item offer, collected two version-matched acceptances, finalized the trade, verified item transfer and completed status, and rolled back all changes.

Additional rollback security checks passed: no approvals, only one approval, outsider account, campaign GM-approval-required policy, and duplicate settlement rejection.

Enabled a **Settle Trade** button only when the logged-in character is a participant, both have accepted the current version, the offer is unexpired, and the backend reports `accepted`. The button requires explicit confirmation and invokes the existing `finalize_approved_trade` RPC, followed by inventory refresh. The server checks campaign policies, inventory/currency availability, equipped items, participants and trade version atomically.

**Do not weaken these server checks or use the QR token as consent.** Final settlement changes actual item/currency holdings, so beta acceptance must include both parties.

### 12.3 — Player-initiated cross-campaign character transfers

Replaced the Player Portal “Coming soon” placeholder with a working request interface. Players can choose one of their characters, choose a destination campaign where they already have active membership, enter an optional reason and submit. A unique partial index prevents parallel open requests for one character.

### 12.4 — Two-GM approval and notifications

Request state machine: `requested` → source GM approves → `awaiting_target` → destination GM approves → `approved_pending_migration`; cancel/reject paths are explicit. Both GMs can review appropriate requests in their respective campaign dashboards; notifications use the Phase 11 secured notification inbox. Source and destination GM permissions are checked separately by PostgreSQL RPCs, with fixed search paths. The transfer request table uses RLS and revokes all direct client access.

### 12.5 — Transfer readiness

Authorized requester/source GM/target GM can view a readiness report on approved requests showing source/destination ruleset match and counts of inventory items, equipment, wallets, crafting jobs, trades, attributes, learned recipes and initiative entries. This report explicitly says **automatic migration is unavailable**. It does not mutate any character or item.

## Database migrations

- `docs/sql/phase12_character_transfer_approval_workflow.sql`
- `docs/sql/phase12_character_transfer_readiness.sql`

New table: `public.character_transfer_requests`, RLS enabled, direct grants revoked.

New authorized RPCs:
- `list_character_transfer_requests(p_campaign)`
- `list_character_transfer_targets(p_character)`
- `manage_character_transfer(p_action,p_character,p_target_campaign,p_request,p_reason)`
- `get_character_transfer_readiness(p_request)`

Existing trade settlement RPCs were reused, not replaced: `create_trade_offer`, `accept_trade_offer_version`, `finalize_approved_trade`; protected internal `app_private.settle_mixed_trade_core`.

## Frontend / CI

- Added `src/CharacterTransfers.tsx` and `src/character-transfers.css`.
- Updated `src/main.tsx` to insert transfer UI in Player Portal and GM Dashboard, route QR trade invites through player selection into Inventory, and refresh inventory after settlement.
- Updated `src/Trading.tsx` to make both-party versioned settlement available and update status/help text.
- Added `scripts/test-transfer-qr-12.mjs`, registered in `.github/workflows/build.yml`.

## Automated verification

**Transfer tests (rollback):**
1. Destination eligibility and request creation.
2. Duplicate-request rejection.
3. Source GM approval then destination GM approval.
4. Character remains in original campaign after approval (no unsafe migration).
5. Approved request cannot be cancelled by player.
6. Unauthorized accounts cannot inspect transfers or target campaigns.
7. Separate-account source/destination GM permission isolation.
8. Migration readiness JSON, matching ruleset, and dependency counts.

**Trade tests (rollback):**
1. Two distinct player accounts propose, approve, and successfully settle a stackable item.
2. Item appears in destination holder, trade status becomes completed.
3. Zero or one approval fails settlement.
4. Nonparticipant cannot settle.
5. GM approval-required campaign policy rejects automatic settlement.
6. Completed trade cannot be settled twice.

All test accounts, campaigns, character records, trades, inventory movements and transfer requests were rolled back; no test mutation persists.

## Consolidated beta acceptance checklist

- [ ] Open a QR trade invitation from camera (iPhone Safari) and reach Player Portal after sign-in.
- [ ] Select participant character and open the corresponding trade under Inventory.
- [ ] Another character/account cannot access trade contents or approve.
- [ ] Create an item/currency offer; have both parties approve the same version.
- [ ] Final settlement button appears only when both current approvals are present; confirm transfer.
- [ ] Item quantities and currency balances update for both players; inventory transaction recorded.
- [ ] Counteroffer changes version and resets approvals, preventing stale settlement.
- [ ] Equipped items, expired trades, insufficient currency and outsider actions fail safely.
- [ ] Player Portal allows transfer request only for eligible destination memberships.
- [ ] Duplicate transfer request is blocked.
- [ ] Source GM can approve first; destination GM separately approves second.
- [ ] Source GM cannot impersonate destination GM, or vice versa.
- [ ] Notifications appear in Phase 11 inbox for GM and player workflow.
- [ ] GM readiness report displays ruleset and dependency counts.
- [ ] Final transfer state is **approved, migration pending**; original character and inventory remain unchanged.
- [ ] Verify mobile layout, production CI build and live Cloudflare deployment.

## Remaining work / next follow-up

**Automatic character migration** needs an explicit, reversible data migration design covering character/campaign membership composite FKs, item definitions and instances, inventory holders, containers, equipped slots, wallets and currency exchange, crafting recipes/jobs, active trades, zone assignments/initiative, effects, audits, ownership and source/destination GM confirmation. Until implemented and tested, no approval action should change `characters.campaign_id`.

A native QR scanner within the app is not yet implemented; the existing QR invitation can be scanned with the phone camera and deep-linked into the web app. Phase 11 APNs/FCM native push delivery also remains a separate dependency.

**Stop point:** Phase 12 core trade functionality and cross-campaign approval workflow are implemented, but full automatic campaign transfer and live frontend validation remain pending. Do not describe Phase 12 as fully accepted or fully deployed.
