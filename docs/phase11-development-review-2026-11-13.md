# Nexus Multiverse — Phase 11 Development Review & Handoff
**Snapshot:** 2026-11-13
**Project:** TTRPG character inventory and campaign manager, not retail inventory.
**GitHub:** `jasonbladesNX/inventory` (main)
**Supabase:** `fvapsdirjgknxpqlxljx` — never modify a different database.
**Previous milestones:** Phase 8 CSV uploads, Phase 9 zones/time and Phase 10 initiative retained.

## Status
Phase 11 core backend, responsive web UI, authorization, Realtime subscription plumbing, gameplay event triggers, preference settings and native push token registration have been implemented and committed. Backend rollback-only tests and source-level contract checks passed. GitHub Actions full build and browser/iPhone interaction have not been independently verified. Actual APNs/FCM push transmission is **not active**; the mobile credential and delivery integration remains a future dependency.

## Phase 11 delivery by milestone
| Milestone | Implementation |
|---|---|
| **11.1 Messaging infrastructure** | Campaign messages, per-recipient access and read receipts, campaign settings, notification preferences and inbox tables. |
| **11.2 GM announcements** | GM can publish to the whole campaign or active characters in a selected zone; server determines recipient user IDs and snapshots delivery. |
| **11.3 Direct messaging** | GM-to-player, player-to-GM private conversations; player-to-player DMs disallowed in this phase. Conversation history through recipient-scoped RPC, not direct table SELECT. |
| **11.4 In-app notifications** | Inbox, unread count, mark read and mark all read, message read state. |
| **11.5 Gameplay notifications** | Database triggers for initiative roll requests and active turns, trade-offer status updates, and approval requests/resolutions, respecting GM and user preferences. |
| **11.6 Real-time delivery** | `notification_inbox` added to `supabase_realtime` publication with owner-only SELECT RLS. Client uses authenticated `postgres_changes` subscription filtered by user ID and polling fallback every 30 seconds. Network/device realtime receipt remains to be tested. |
| **11.7 Native push readiness** | Secure `notification_device_tokens` table and `register_notification_device` RPC for future native APNs/FCM tokens. **No APNs/FCM server delivery, signed native application, or push credential installation in Phase 11.** |
| **11.8 GM controls** | Campaign policy for direct messaging and gameplay alert categories; audience selection; individual opt-out preferences. |

## Database migrations
- `docs/sql/phase11_messaging_notifications_core.sql`
- `docs/sql/phase11_gameplay_notification_triggers.sql`

### Security
Private messages and recipient tables have RLS enabled and revoke direct table access. RPC authorization validates authenticated campaign access, GM role for announcements and campaign policy changes, and allowed DM direction. Message records are exposed only when the signed-in user is in the recipient table. Notification inbox RLS limits readable rows to `user_id = auth.uid()`; no direct insert/update/delete privileges for clients. Alerts deduplicate source keys. Sensitive push tokens are kept out of exposed responses.

## Frontend changes
- `src/CampaignComms.tsx` and `src/campaign-comms.css` — announcements, direct messaging, inbox, read state, preferences, GM policies, Realtime subscription.
- `src/main.tsx` — GM Dashboard “Campaign Messages & Notifications”.
- `src/CharacterScreen.tsx` — player Character tab expandable messages/notification center.
- `scripts/test-campaign-comms-11.mjs` — structural regression.
- `.github/workflows/build.yml` — includes Phase 11 regression.

## Verified tests
Rollback-only database tests passed:
1. GM campaign announcement insertion, recipient-scoped retrieval and read receipts.
2. Campaign notification policy updates and player opt-out settings.
3. Initiative request trigger delivered notification to eligible character account; inbox unread and mark-all-read worked.
4. Rejection of unauthenticated/unauthorized messaging and inbox reads.
5. Approval request trigger and status-change notification.
6. Suppression of gameplay alerts when user preference disabled.
7. Invalid direct recipients and invalid zone announcement rejected.
8. Temporary synthetic second account: GM-to-player DM, private recipient inbox, player-to-GM reply, GM-only announcement authorization, campaign DM-disable enforcement. All temporary records rolled back.
9. Supabase realtime publication contains notification_inbox.
10. Source-level regression checks 13/13 passed for schema, RLS, ACL, API, triggers, Realtime and frontend wiring.

**Limitations of tests:** No production TypeScript/CI run result independently verified in this conversation, no authenticated end-to-end browser test, no native APNs/FCM push delivery test. Full multi-device subscription delivery and trade notification GUI need manual review.

## Consolidated Phase 11 acceptance tests
- [ ] GM Dashboard shows Messages & Notifications card; player Character tab shows expandable panel.
- [ ] GM sends an announcement to whole campaign; authorized players receive message and inbox notification.
- [ ] GM sends announcement to Zone A; Zone B-only player does not receive it.
- [ ] Player can send a DM to GM; GM can reply; a third player cannot read the conversation.
- [ ] Player cannot publish campaign-wide announcements or DM a non-GM player.
- [ ] Message lengths and empty drafts are validated; errors are readable on mobile.
- [ ] Notification unread count updates; mark one read; mark all read; message read state persists.
- [ ] Initiative roll request generates notification; active participant changes generate turn alert.
- [ ] Trade status and approval changes generate appropriate alerts.
- [ ] User preference to mute announcements, DMs or gameplay alerts prevents newly generated alerts.
- [ ] GM can disable direct messages and select gameplay categories; unauthorized players cannot change GM settings.
- [ ] Open second browser/session to confirm live subscription updates without manual refresh; check polling fallback.
- [ ] Mobile Safari layout is usable and client subscription properly disconnects when leaving campaign.
- [ ] Verify no recipient message or inbox rows leak across campaign or user boundaries.
- [ ] Confirm latest GitHub Actions production build, Cloudflare deployment and iPhone browser behavior before acceptance.
- [ ] Do not expect native push banners until native app IDs, APNs/FCM credentials, server delivery worker and permissions are configured.

## Recommended follow-up
1. Verify complete GitHub Actions build and live frontend. Address any failed type/build checks.
2. Conduct one consolidated browser/iPhone review and real-time two-session test.
3. When native apps are commissioned, integrate Capacitor native push permission/token acquisition, server-side delivery worker with APNs/FCM credentials, token revocation, retries and rate limits. No credentials go into browser bundles.
4. Consider idempotency keys for sending messages, pagination and richer threaded conversation UX after beta review.

## Continuation
Preserve the existing four bottom gameplay tabs (Character, Inventory, Shop, Craft), campaign zone/time model, and all security controls. The next phase should be decided following acceptance, rather than assumed complete.

## Phase 11 follow-up fix — GM messages missing from player panel (Nov 13, 2026)
Observed: live campaign had two GM whole-campaign announcements, each with only sender's message copy, zero notification rows and no distinct non-owner player account. The owner also owns an active player character; the announcement sender-exclusion logic therefore caused the player's notification inbox to appear empty. Additionally, the Character screen presented messages in a collapsed details panel.
Changes:
- `docs/sql/phase11_dual_role_announcement_notification_fix.sql`: when a GM sender also owns an active player character in the announcement audience, create the sender's **player-facing** announcement notification. Applies to whole-campaign and zone audience only; private DM recipient restrictions unchanged.
- Backfilled the two existing qualifying announcements, with uniqueness/deduplication; verified 2 live messages and 2 restored notifications.
- `src/CharacterScreen.tsx`: expand Messages & Notifications section by default.
- `scripts/test-campaign-comms-11.mjs`: regression coverage for sender notification, backfill and panel visibility.
Verification: rollback-only test passed for sending an announcement as the GM, receiving a new notification on the same account, reading it from `get_campaign_notification_state` and reading the message via `list_campaign_messages`. No new test records persisted.
Caveat: production TypeScript build, CI status and Cloudflare frontend deployment have not been independently confirmed.
