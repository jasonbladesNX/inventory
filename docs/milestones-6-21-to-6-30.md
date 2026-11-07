# Nexus Multiverse — Milestones 6.21–6.30

Inventory exploration and quality-of-life milestones implemented as one batch, with the originally delivered comparison feature subsequently removed at user request. Browser
acceptance is intentionally deferred to a single end-of-batch test. Automated, SQL
authorization, regression and build checks remain required at every release.

| Milestone | Capability | Contract |
| --- | --- | --- |
| 6.21 | Inventory name search | Client-side case-insensitive filtering over authorized item names |
| 6.22 | Inventory sorting | Name, quantity and known unit weight ascending/descending; unknown weights last |
| 6.23 | Category counts and combined filters | Item type counts and location filter over existing character-owned items |
| 6.24 | Saved favorites | Per-authenticated-user, per-character, per-item bookmarks using protected RPCs |
| 6.25 | Status and favorites filters | Favorites, equipped, unequipped, stored and missing-weight filters combine with search |
| 6.26 | Condition and unit weight display | Authorized read-only inventory-indicator RPC; unknown items conceal definition-derived weight |
| 6.27 | Container utilization | Existing container usage data, fullness meter, 90% warning and unknown-weight caution |
| 6.28 | Item comparison (withdrawn) | Removed from the Inventory UI at user request; may be revisited later |
| 6.29 | Inventory overview | Counts item entries, combined units, stored items and saved favorites |
| 6.30 | Filtered CSV export | Downloads only visible item entries, with UTF-8, quoting and spreadsheet-formula escaping |

## Design and security constraints

- Approved iPhone-oriented UI, bottom navigation, campaign roles and character
  selection remain unchanged.
- Existing equipped-slot choices, dependency-warning logic and authorized equip
  and unequip transactions are reused. No new inventory mutation APIs.
- Existing container movement/weight validation is unchanged.
- Favorites are the only new persisted user preference. They are private to each
  signed-in account, not shared between campaign members.
- Favorites are stored in app_private.character_item_favorites, with RLS on,
  no direct client table grants and only character-authorized SECURITY DEFINER
  readers/writers. Foreign items are rejected before adding a favorite.
- Character inventory indicators are read-only and require existing character
  ownership or GM access. Unknown/unidentified items never expose their hidden
  definition-derived weight through this function.
- The UI uses only the current character's authorized inventory feed. Comparison
  and CSV exports never request another character's items.
- CSV export is a manual browser action, not a server upload or scheduled process.
- Unknown weights and capacities are displayed as unknown rather than guessed.
- Container status and fullness are advisory. Authoritative capacity checks remain
  in the existing transactional inventory movement RPCs.

## Deferred features and limits

- Search filters current item display names, not full descriptions or unrevealed metadata.
- Item comparison was removed at user request. No comparison controls remain.
- Favorites refer to item instances, not globally published catalog definitions.
- CSV uses the current filter state; it is not a complete backup and does not
  include hidden GM-only attributes or unpublished item effects.
- Shop and Craft remain separate future feature streams; they are not enabled by
  this batch.

## Verification

1. SQL owner test adds a temporary favorite and reads it back inside a transaction.
2. SQL rejects cross-account character favorites and non-owned item IDs.
3. Anon cannot invoke the new functions; authenticated cannot read or insert into
   the private favorites table directly.
4. Authorized inventory indicators return condition and known unit weight.
5. Existing GitHub Actions inventory/page-navigation tests still pass.
6. New ten-milestone regression and server-render smoke tests pass.
7. One combined browser acceptance test follows deployment of the bundle.
