# Milestone 8.2 — GM Item Catalog & Character Inventory CSV Uploads

## Status
Implemented. This builds on the **Milestone 8.1 GM CSV Templates** downloadable contracts. GM access is required in both the frontend and Supabase functions.

## GM Workflow

1. Open the campaign's **GM Dashboard** and expand **GM CSV Templates** to download a current CSV.
2. Expand **GM CSV Imports**. Select **Item Catalog** or **Character Inventory**.
3. Choose a `.csv` file. The browser validates the header, quoting, row lengths, types, quantities and obvious duplicates. Any local error includes a CSV line number. Invalid files cannot proceed.
4. Choose **Validate & Preview**. Supabase independently checks GM access, campaign records, existing names, item rules, referenced characters, limits and duplicate mappings. No data changes during preview.
5. Review all resolved actions in the preview table, tick the authorization checkbox and choose the explicit **Confirm** button.
6. Supabase validates the batch again and applies it as **one transaction**. If any row fails, the entire batch rolls back. The UI reports successful committed totals and refreshes the current campaign/character view.

**Only the Item Catalog and Character Inventory formats are importable in 8.2.** Shop Stock and Treasure/QR Loot templates remain download-only until 8.3–8.4.

## Supported CSV Formats

**Catalog:** `item_name,category,description,stackable,consumable,two_handed,bonus_attribute,bonus_amount`

- Creates new campaign-specific item definitions; does not replace or mutate existing definitions.
- Names must be unique (case-insensitively) within the CSV and across the campaign + selected ruleset. Conflicts block the batch.
- Supports valid built-in and active custom categories, stackability, consumable flags, optional two-handed weapons and optional attribute bonuses.
- Description up to 3,000 characters is saved on the definition.
- Complex item-use effects, item icon uploads and nested custom JSON metadata are out of scope for this initial import. Existing imported items can be edited through the GM tools.

**Character Inventory:** `character_name,character_id,item_name,item_definition_id,quantity`

- Grants existing item definitions to **existing active characters** in the selected campaign.
- IDs are optional if names uniquely resolve in the campaign. If both are provided, the name and ID must match. Ambiguous or missing matches block the batch.
- A duplicate resolved character/item pair in the same CSV is rejected; combine quantities into one row.
- Grants **add** to existing inventories. They do not replace inventory, equipment or containers; no automatic equipping occurs.
- Reuses the existing inventory grant logic for automatic stacking, separate equipment instances and inventory activity/transaction records.

## Limits

| Safety limit | Catalog | Character Inventory |
|---|---:|---:|
| Maximum CSV file size | 1 MB | 1 MB |
| Maximum rows per import | 100 | 200 |
| Maximum units per row | N/A | 500 |
| Maximum total units | N/A | 10,000 |

## Security & Transaction Guarantees

- SQL functions: `public.gm_import_catalog_csv` and `public.gm_import_character_inventory_csv`. The boolean `p_dry_run` controls preview versus committed import.
- Only the `authenticated` Postgres role has function execute access. Both functions independently validate `auth.uid()` and `app_private.is_gm(p_campaign)`; anonymous and non-GM calls fail.
- `SECURITY DEFINER` is used with an empty fixed `search_path`; all tables and functions are schema-qualified.
- The selected campaign ID comes from GM Dashboard state, not a CSV field. All character and item UUID references are rechecked against that campaign or its ruleset.
- Failed row validation or mutation raises a PostgreSQL exception, reverting all writes from that function call.
- Dry-run calls never insert or update item catalog or inventory rows.
- Catalog imports invoke `create_campaign_custom_item_with_stacking`. Character imports invoke `add_inventory_item`.
- No SQL functions or tables were added for shops, treasure contents or player-to-player uploads.
- These imports run in the foreground. Upload file bytes are parsed in the browser; there is no file upload storage bucket.

## Retry Considerations

If Supabase returns a definitive row validation error, **no rows were imported**. If a network connection drops during confirmation, the GM should check the catalog or affected character inventories before retrying: the server could have committed while its response was lost. An import-journal/idempotency key workflow is a possible future reliability enhancement.

## Acceptance Tests

- Both import modes appear on the GM Dashboard in the separate collapsed **GM CSV Imports** card.
- Blank CSV cannot import without data. Invalid headers, malformed quotes and invalid quantities produce readable errors.
- Valid new catalog item CSV previews its future records without creating them; confirmation creates them with correct description, category and stacking rules.
- A catalog CSV containing an existing name or duplicate row is rejected without creating any items.
- Character import resolves characters and items by names, IDs or consistent combinations; missing/ambiguous names and incorrect IDs are rejected.
- Character import preview does **not** grant any items; confirmed import increases quantities appropriately and logs activity.
- An invalid row in a multi-row import causes **no changes**, even to otherwise valid rows.
- Ordinary player and anonymous sessions cannot access the import screen or call the privileged import functions.
- Shop and Loot CSV templates are still download-only.
- On mobile, the CSV picker and preview table are usable and the confirmation requires an explicit checkbox.

## Verification Notes

The SQL backend was tested with the existing campaign in a transaction that was rolled back. Test cases included dry-run behavior, item creation and description persistence, equipment bonus import, name and UUID inventory resolution, a real character inventory grant, mixed valid/invalid rollback, and authorization denial. No test grants or catalog items were left behind.
