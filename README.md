# Nexus TTRPG Inventory — Prototype

React/Vite prototype connected to Supabase project `fvapsdirjgknxpqlxljx`.

## Run
1. Install Node.js 20.19+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`, replace the publishable key with the **publishable** key from Supabase Dashboard > Project Settings > API Keys. Never put a secret/service-role key in this file.
4. Run `npm run dev` and open the shown local URL.
5. Build using `npm run build`.

## Build verification
A clean install was attempted on October 31, 2026. It failed because this execution environment cannot resolve registry.npmjs.org (`EAI_AGAIN`); offline install also failed because @supabase/supabase-js was not cached. No successful Vite build is claimed. Run `npm install` and `npm run build` on a network-enabled development computer before deployment.

## v0.4 trade-screen improvements
- Do not render invalid dates when a trade has no expiration.
- Hide the approval action on offers that do not involve the selected character.
- Hide the approval action for expired offers.
- More explicit incoming/outgoing/other-character labeling for players with multiple characters.
- Final settlement remains inaccessible from the UI and from authenticated Supabase clients.

## Current capability
Email/password authentication, create/select campaign, create character, create custom catalog item as GM, create equipment slot as GM, add item, request equipped effects.

## Limitations
Development prototype, not deployed. Ownership filtering and secure character-specific equipped item reads need refinement before broader testing. There is no GM invitation interface, trade flow, full approval workflow, or published rules catalog. Some database operations are currently deliberately unavailable to clients. The project must be security-tested with separate accounts before production use.


v0.5: Added optional currency offer amounts from a secure character wallet reader, and shareable trade invitation URLs. Settlement remains disabled. The inviter URL requires a signed-in participant; deep-link focusing is not implemented yet.


v0.6: Multiple item and currency lines may be assembled, reviewed, and removed before submission. A `?trade=<uuid>` invitation focuses an authorized offer after the user selects its campaign and character. Settlement remains disabled. QR image rendering is not included. Client validations complement, but do not replace, server checks.


v0.7: QR codes are rendered locally as SVG using the MIT-licensed Kazuhiko Arase encoder (bundled under src/vendor/qr). Trade invitations include campaign and trade UUID. On sign-in the matching authorized campaign is selected automatically; selecting the character loads the invite and highlights the trade. QR codes do not contain access credentials. Final settlement remains disabled. npm registry was inaccessible during this update; full Vite build must be verified in a network-enabled environment.


v0.8: Recipient can submit an item/currency counteroffer via authenticated `counter_trade_offer` RPC; submission revises only recipient-side lines, increments offer version and resets acceptances. A new UI counteroffer mode reuses line selectors. Settlement remains disabled. Full production build still unverified.


v0.9: Both trade participants can cancel pending/accepted offers. Cancellation is checked server-side, and subsequent approvals are rejected. Counteroffer invalidation and renewed two-party approval were verified with rollback-only database tests. Production build/browser tests remain pending; settlement remains inaccessible to authenticated clients.


v1.0: Complete two-sided item settlement verified by rollback SQL test. Added full per-side trade review and explicit approval confirmation. Unknown counterpart item identifiers are intentionally shown as short IDs, not private item names. Browser build and beta release remain pending; settlement RPC is still restricted.


## v1.1 browser preview
- Open `browser-preview.html` locally in Chrome/Firefox: no npm, server, or credentials required. It is a **mock-data UI preview**, never Supabase-connected.
- Actual React source remains in `src/` and requires Node.js, `npm install`, `.env`, then `npm run build`.
- For a Cloudflare Pages build, use framework Vite, build command `npm run build`, output directory `dist`, and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as deployment environment variables (publishable key only; never a secret/service_role key). Configure SPA fallback on Pages if deep links are needed.
- No live settlement or loot claim is enabled. Deploy only to a private/test audience after installing dependencies and testing auth/RLS in a browser.


v1.2 validation preview: Keeps the v1.1 dark two-column layout. The local-only preview now supports two-player approval, recipient counteroffers, approval reset, cancellation, and item removal. Opening browser-preview.html requires no installation. No real settlement, scanning, or Supabase interaction is performed by the demo.

## v1.3 — Connected testing milestone
The approved v1.2 offline preview layout remains unchanged in `browser-preview.html`.
The React application now contains a **read-only connection-check panel** that tests:
1. signed-in user, 2. campaign access, 3. eligible inventory RPC, 4. wallet currency RPC, 5. trade inbox RPC.
Checks never call settlement or modify inventory. Use two separate real test accounts for permission validation.
The panel is only usable after a local or hosted Vite build with public (publishable) Supabase credentials.
**Do not put service-role or secret keys in VITE_ variables.**
Production build and real browser connectivity have not been independently verified in this environment.


## v1.4 — Inventory scope corrected
- React character inventory now calls `list_character_inventory_for_trade` instead of the campaign-wide inventory reader.
- This prevents a selected player's inventory display from mixing in other characters' rows.
- Trade settlement and QR loot claiming are still restricted at the database level.
- The approved standalone browser-preview layout is unchanged.
- TypeScript/TSX syntax checks are run using the locally available TypeScript compiler (syntax only); an npm dependency-backed production build is not yet verified.


v1.5: The character selector uses the authenticated campaign membership to show only the player's own character; campaign GMs can select other characters for management. Added `BROWSER_TEST_PLAN.md` for two-profile verification. No backend changes or settlement permission changes.


v1.6: The trading UI now gets recipient options from secure `list_trade_recipients` RPC, separate from owned/GM-managed character selection. Added GitHub Actions build and type-check workflow and DEPLOYMENT_STEPS.md. Build not performed locally due missing npm packages.


## v1.7 trade review labels
New authenticated RPC `list_trade_item_labels(p_trade)` resolves names for item IDs included in a trade, only when requester participates in that trade. Unidentified items are labeled generically. React trade reviews fetch these labels after loading offers, making counterpart items readable without querying another character's inventory. Browser preview layout remains unchanged. This version has not been production-built or browser-integrated. Live settlement remains disabled.


### v1.8 changes
- Clears pending item/currency drafts when a different character is selected.
- Clarifies unconfirmed counterparty acceptance in the trading UI.
- Adds `npm run syntax` to CI ahead of typechecking and building.
- Build and hosting remain unverified due to unavailable npm registry in this environment.


## v1.9 approval safety
- Approvals now include the offer version the player reviewed (`accept_trade_offer_version`).
- The old trade-ID-only approval RPC is no longer available to authenticated clients.
- A trade draft is remounted when the selected character changes, preventing stale state.
- Pending-approval wording now reflects that `other_accepted` means **both** have approved.
- The standalone preview is unchanged and remains simulated.
- Connected production builds and live browser sign-in are **not yet verified**.


## v2.0 verification update
Improved `npm run syntax` to use a locally or globally installed TypeScript parser. The GitHub workflow still installs project dependencies for full type-check and build. No changes to settlement privileges. A full connected production build has not been verified.


### v2.1 readiness update
- Kept the approved standalone browser preview unchanged.
- Disabled the equipment-slot selector for items the inventory reader marks ineligible; a status label explains the restriction.
- Clarified that a trade remains pending until both approvals are present.
- Added `npm run contracts` (zero external dependencies) to check known RPC wiring and that live settlement is absent from frontend calls.
- This is source-level verification only, not a production build or authenticated browser test.
- Run `npm install && npm run syntax && npm run contracts && npm run check && npm run build` in a network-enabled environment.


v2.2: Improved deployment handoff, explicit Vite environment typings, corrected pending-approval wording. Production build and hosting are unverified.
