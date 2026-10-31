# Controlled browser-test checklist (v1.5)

The approved `browser-preview.html` demo layout remains unchanged. Run these checks **only on a local/staging React build**, not in production. Settlement (`finalize_approved_trade`) is still disabled for authenticated users.

## Setup
1. Install Node.js 22+, run `npm install` from a network-connected terminal, then `npm run build`.
2. Add `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the dedicated Nexus project. Never use service-role/secret keys.
3. Run `npm run dev`; visit localhost using two separate browser profiles with separate test accounts.
4. In the dedicated test campaign create a GM and two player memberships, with one character for each player.

## Expected checks
- Account A only sees their character in their selector, and the GM can choose any campaign character.
- Account B does not see A's private inventory through the scoped reader.
- A offers one item and a currency amount; B sees the offer from their account.
- B submits a counteroffer; approvals reset and both re-accept the new version.
- Trade invite URLs require sign-in and membership; a third account cannot view the offer.
- Cancel a pending trade; approval afterwards must fail.
- Use the read-only Connection Checks panel for every signed-in character.
- Verify no settlement, inventory transfer, or QR-loot claim action is exposed.

## Status
- Database-only access and transfer tests were completed previously.
- Full React production build and actual browser-session tests are **not yet verified**.
- An actual Cloudflare Pages deployment is **not yet configured**.
