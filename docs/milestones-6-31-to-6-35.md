# Nexus Multiverse milestones 6.31–6.35

A single implementation and acceptance batch. This work is exclusively client-side
and reads the already authorized inventory payload from the character view.
No new Supabase APIs, tables, RLS policies or inventory mutations were added.

## 6.31 Quick inventory views
One-click presets for all items, equipped, favorites, stored and unknown-weight
items. Selecting a quick view resets the other inventory filters for clarity.

## 6.32 Group results
Choose storage location, item category or flat list. Works with search, category,
location and status filters; container View contents still uses the location filter.

## 6.33 Filtered known-weight summary
Show the total quantity of currently visible items and sum their known item
unit weights multiplied by quantity. Unknown weights are not treated as zero
for completeness claims and are counted separately. The known-weight subtotal
is not the authoritative carrying capacity check, which remains unchanged.

## 6.34 Print-friendly inventory report
A read-only printable snapshot of visible inventory items, category, quantity,
carried/stored/equipped state and the incomplete-weight warning. Printing occurs
only after a click; no export to a server or extra data disclosure.

## 6.35 Saved session view
Save and restore the current search, item category, location, status, sort and
grouping settings within the current browser component session. This is explicitly
not a persisted account-level preference. Closing the page clears it.

## Preserved behavior
- User-requested item comparison stays removed.
- Pouch remains a true capacity-bearing container and Component Pouch a focus.
- All access control continues through the existing character inventory readers.
- Existing authorized Equip, Unequip, storage move and GM workflows are untouched.
- Fixed bottom navigation and mobile-friendly cards remain unchanged.

## Combined acceptance
1. Verify 6.31 quick views.
2. Toggle grouping by location, type and flat.
3. Filter an item with known weight and confirm weighted units.
4. Filter an unknown-weight item and confirm caution.
5. Open report and print preview; ensure only visible items appear.
6. Save a filtered grouped view, change filters, restore it in-session.
7. Verify Equip, Unequip, Pouch View contents and bottom navigation.
8. Verify comparison controls remain absent.

CI runs scripts/test-inventory-milestones-6-31-to-6-35.mjs plus existing checks.
