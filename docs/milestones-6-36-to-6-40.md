# Nexus Multiverse — Milestones 6.36–6.40

Implementation batch for secure item quantity changes and history, using D&D 5e
first but no hardcoded ruleset in the stack transaction. The user requested one
combined browser acceptance test after all five milestones.

## Milestones

**6.36 — Split stack.** Split a positive whole-number quantity below the source
quantity into a new item instance, preserving identical condition, identification,
custom naming and all public/private properties.

**6.37 — Consolidate compatible stacks.** Merge a selected whole-number quantity
into another character-owned stack in the same container. The server requires
identical definition, condition, identification, custom name, public properties
and private properties. Equipped or container item instances cannot be merged.
Full merge deletes the empty source instance.

**6.38 — Move quantities between containers.** Partial moves split the item and
then invoke the already-secured move_character_item_storage RPC, inheriting its
destination ownership, capacity, known-weight and equipped-item checks. Full
moves delegate to the same existing RPC without splitting.

**6.39 — Guarded discard.** The UI requires explicit confirmation including
quantity and item name. The backend rejects equipped items and containers, and
validates quantities before decrement or full deletion. Discard is irreversible.

**6.40 — Inventory activity.** New split/merge/move/discard actions emit audit
transactions; a database trigger captures equipment assignment inserts and
deletes. The secured history reader also includes existing container moves for
items still owned by the selected character. Limited to the last 40 events in
the player UI (maximum 100 per RPC), ordered newest first. Historic changes
before this release may not have complete context.

## Security guarantees

- All write mutations occur in one PostgreSQL transaction with character row
  locking to serialize inventory actions for the same character.
- The RPC checks the signed-in user is a campaign GM or the active owner of the
  selected active character, and that source/target belong to the same campaign
  and character inventory holder. Unauthorized attempts fail 42501.
- The container destination is validated by the existing storage RPC.
- Equipped items and containers are excluded from these quantity operations.
- Only whole-number quantities within the source stack size are allowed.
- Private item properties are preserved on split and compared for equivalence
  on merge. No GM-only item data is revealed to the client.
- No new public tables or broad RLS grants.
- Anonymous EXECUTE is revoked for both stack and history RPCs.
- Each successful action records actor, character and quantity in an existing
  inventory transaction record.

## Verification performed

- Owner split returns new UUID and character activity event; rolled back.
- Owner partial move into backpack with known weight succeeds; rolled back.
- Existing container RPC rejects missing item weight; rolled back.
- Owner partial merge and discard generate correct activity records; rolled back.
- Unauthorized user cannot run stack write.
- Anonymous cannot execute the stack and history RPCs.
- Existing authorized unequip RPC produces equipment_unequipped activity; rolled back.
- New UI and database-source contract regression plus existing suite and build.

## Combined browser acceptance

1. Verify release marker for m6.40-item-stack-and-activity-bundle.
2. Open Inventory → Item stack management.
3. Using a safe expendable test stack of at least three items, split 1 item.
4. Consolidate the split instance into its compatible matching stack.
5. Move part of an eligible known-weight stack to a carried backpack or pouch.
6. Confirm source quantity, destination quantity, storage tag and weight update.
7. Try moving weight beyond capacity and verify no inventory change.
8. Try changing a quantity on an equipped item or a container and verify refusal.
9. Discard only a disposable test item after checking confirmation text.
10. Review Inventory activity for split, merge, move and discard records.
11. Equip/unequip a test item and confirm subsequent history records.
12. Reconfirm normal Equip, Unequip, favorites, Loadout Health and navigation.

Do not test discard on valuable items. Use temporary sample items.
