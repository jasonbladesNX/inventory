# Connected beta build checklist

1. Upload this folder to a **private** GitHub repository and use Actions > Build and type-check to validate the application. The workflow installs npm packages, type-checks TSX, builds the Vite application, and uploads the `dist` artifact. No Supabase secrets are required to compile.
2. Configure Cloudflare Pages (or equivalent) with build command `npm run build` and output directory `dist`.
3. Set **only** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as build environment variables from the dedicated Nexus TTRPG Inventory project. **Never** use service-role/secret keys in the browser.
4. Configure the Supabase Auth redirect/site URLs for your actual test domain; do not guess a URL.
5. Use two ordinary test accounts in the same campaign to check trade recipient lookup, owner-only inventory, offer/approval/cancellation and QR invitation authorization.
6. Leave `finalize_approved_trade` inaccessible to authenticated clients, and do not enable QR loot settlement.
7. Only enable settlement after passing end-to-end browser, cancellation/offer-version, RLS, and stress tests.

The existing `browser-preview.html` remains a standalone demo; it is **not** a Supabase-connected release.


## v1.8 build gate
Before deploying, obtain a successful GitHub Actions run using the included workflow.
Download `nexus-ttrpg-dist` from that run. Configure Supabase Auth Site URL and redirect URLs to your actual test domain. Use only the public/publishable Supabase key in Vite environment variables.
The standalone `browser-preview.html` is a **simulation only** and is not the connected app.
Do not enable public.finalize_approved_trade until two live-account browser sessions and access checks are completed.


### v1.9 GitHub Actions configuration
Set GitHub repository **Settings → Secrets and variables → Actions → Variables** with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the dedicated inventory project. These are public browser configuration values, **not** service-role or secret API keys. The workflow now fails if either value is absent instead of silently packaging an unconfigured website.

Before approving a trade, the React application calls `accept_trade_offer_version` with the version displayed to the player. If it changes, refresh the trade and require renewed review.


## v2.2 deployment handoff
1. Create a private GitHub repository, upload the contents of this folder including `.github/workflows/build.yml`.
2. Set GitHub Actions repository variables `VITE_SUPABASE_URL=https://fvapsdirjgknxpqlxljx.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` from Supabase Project Settings > API Keys. Never use a service role/secret key.
3. Run Actions > Build and type-check > Run workflow. Confirm a green result and downloadable `nexus-ttrpg-dist` artifact.
4. In Cloudflare Pages connect the repository, configure build `npm run build`, output `dist`, and the same two public VITE_ variables.
5. Configure the resulting hostname under Supabase Authentication > URL Configuration and test with two ordinary users.
6. Leave authenticated EXECUTE disabled on finalize_approved_trade, settle_item_trade and claim_loot_qr until subsequent authorization testing.

Build and hosting require external account access not available within this session.
