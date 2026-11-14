# Nexus Multiverse — Phase 15 Consolidated Verification

Date: 2026-11-14
Repository: `jasonbladesNX/inventory` (`main`)

## Scope

Phase 15 comprises campaign game sessions, individual/party banks, GM party management, player party creation/join/leave, invitations and join approvals, leader configuration and leadership transfer, private party messaging, player party combat board, GM multi-recipient loot distribution, player loot requests with leader/GM approval, GM-controlled party bank withdrawal policy, and currency withdrawal requests and approvals.

## Automated verification performed during development

| Capability | Completed database rollback checks |
|---|---|
| Party invitations / join policy | Direct join prevented for approval parties; legitimate join requests and invitations accepted; non-organizers denied; active sessions lock changes |
| Party configuration | Current organizer/GM authorization; rename and bank label preservation; member removal; running-session guard |
| Leadership transfer | Creator auto-assignment, A→B→C transfers, former leader immediately denied settings/invites/member management, leave restrictions, running-session protection |
| Party messaging | Member and GM read/post; nonmember and departed member denied; invalid messages rejected |
| Party combat board | Party member and GM read only; cross-character impersonation blocked; authoritative zone initiative round and acting character projected correctly |
| GM batch loot distribution | Dry run nonmutating; stock preconditions and over-allocation rejected; 10-stack split 3/4/3; GM-only and session locks |
| Player item requests | Player submit, GM/leader review, transactional inventory movement, double approval prevented, leader handoff instantly changes approval rights |
| Withdrawal policy | Default direct; GM approval policy blocks both direct item and currency withdrawals; item approval still works; policy updates session-locked |
| Currency requests | 20-unit bank balance → 7.25 approved payout → 12.75 remaining; self-approval and repeat approval blocked; denomination precision, duplicate requests and session locks enforced |
| Currency leadership and failure cases | Old leader denied, new leader approved outstanding request, insufficient balance cannot approve, failed request stays pending and may be cancelled, outsider account denied |

These tests used transactional `BEGIN`/`ROLLBACK` and preserved permanent campaign and character data.

## Database access checks (2026-11-14)

- `party_currency_requests`: no direct SELECT/INSERT access for authenticated clients, no direct SELECT for anonymous users.
- `list_party_currency_requests` and `manage_party_currency_request`: authenticated execute permitted; anonymous execute denied.
- Supabase security advisors detected RLS-without-direct-policies and authenticated SECURITY DEFINER RPC access for these tables/functions. Those are intentional within the server-authorized RPC architecture. Per-RPC ownership, leader/GM, campaign and session checks were verified in the above rollback tests.

## Regression suite and CI

11 Phase 15 regression scripts exist in `scripts/` and are registered in the push-triggered `.github/workflows/build.yml`:

- `test-phase15-party-banks.mjs`
- `test-player-party-self-service.mjs`
- `test-phase15-party-approvals.mjs`
- `test-phase15-party-configuration.mjs`
- `test-phase15-party-leadership.mjs`
- `test-phase15-party-chat.mjs`
- `test-phase15-party-combat-board.mjs`
- `test-phase15-party-batch-loot.mjs`
- `test-phase15-party-loot-requests.mjs`
- `test-phase15-party-bank-withdrawal-policy.mjs`
- `test-phase15-party-currency-requests.mjs`

The CI workflow runs syntax, contracts, TypeScript checks, regressions and a Vite build after install. Script registration and source consistency were independently checked; **a successful CI run, full frontend compile, and live deployment smoke test were not confirmed** by the available environment. The local container could not resolve `github.com` for a checkout.

## End-of-phase review (deferred as requested)

Review the fully deployed app once at the end of Phase 15 using real player, leader and GM accounts:

1. Party creation, join policies, invitations, transfer of leadership and immediate privilege revocation.
2. Private messaging and party combat view with live GM initiative changes.
3. Party shared-bank item and currency withdrawals in both Direct and Approval Required modes.
4. Party loot and currency requests, leader/GM approvals, cancellation, declines, double-approval protection, sufficient funds and correct inventory/wallet results.
5. Group loot distribution quantities and preservation of bank audit history.
6. Active game session locks, cross-party isolation, responsive mobile layout and user-friendly errors.
7. Confirm green latest Actions build and deployed frontend before phase acceptance.

**Status:** Backend functionality implemented and database rollback tests passed. Phase 15 is ready for consolidated review; not yet declared browser/deployment accepted.

## Next step

After consolidated Phase 15 review, resolve any findings and transition to Phase 16 planning. Do not require per-milestone manual acceptance unless the user requests it.
