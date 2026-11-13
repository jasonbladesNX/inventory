# Milestone 8.1 — GM CSV Templates (contract v1)

**Status:** Download-only templates and examples implemented on the GM Dashboard. **No uploads or imports are performed by 8.1.**

## Location

Sign in as a GM, open a campaign, and expand **GM CSV Templates** (collapsed by default). For each data type, download either **Blank CSV** (one header row and no data) or **Example CSV** (sample rows). Expand **View columns and instructions** for field-level guidance.

Templates are generated client-side by `src/gmCsvTemplateSpecs.ts` and downloaded as UTF-8 CSV with an Excel-friendly BOM, comma delimiter, properly escaped quotes and CRLF line endings.

## Template types

| File base name | Purpose | Phase that will consume it |
| --- | --- | --- |
| `nexus-gm-catalog` | Create campaign-specific item definitions | 8.2 |
| `nexus-gm-character-inventory` | Grant catalog items to existing characters | 8.2 |
| `nexus-gm-shop-stock` | Set merchant listings, quantities and buyback prices | 8.3 |
| `nexus-gm-loot-contents` | Configure physical items and currency across QR loot containers | 8.4 |

Every base name is available as `-blank.csv` and `-example.csv`. Example names such as "Example Trading Post" are **illustrative**; they are not automatically created as campaign records.

### 1. Item catalog

`item_name,category,description,stackable,consumable,two_handed,bonus_attribute,bonus_amount`

- `item_name` and `category` are required. Category must be a known built-in category code or an active custom category for the current campaign.
- `stackable` and `consumable` are required true/false values.
- `two_handed` is an optional true/false flag for weapons.
- `bonus_attribute` / `bonus_amount` are an optional pair for passive equipment bonuses.
- `description` is an optional stored-definition field; the current manual creation RPC does not expose it. Milestone 8.2 must explicitly support writing it.
- **Compatibility:** consumables must be stackable; equipment (including weapons, armor and rings) cannot stack. A consumable cannot also be a passive-equipment bonus item.

Not included in v1: complex use effects, nested JSON properties, icon/image attachments and the custom-category creation workflow. These will be separate decisions, not silently guessed by the importer.

### 2. Character inventory

`character_name,character_id,item_name,item_definition_id,quantity`

- Reference a character with an existing campaign-local UUID or a uniquely matching name.
- Reference an item with an existing campaign/ruleset definition UUID or a uniquely matching name.
- `quantity` is a positive whole number. The current interactive bulk-grant function allows **1–25 distinct items and a maximum of 1,000,000 total units per transaction**. The future importer will need to batch safely and report each batch.
- Existing inventory stacking, equipment-instance separation, campaign membership permissions and activity history must be respected.

### 3. Shop stock

`merchant_name,merchant_id,item_name,item_definition_id,currency_code,unit_price,buyback_price,quantity,buys_from_players`

- Merchant and currency must exist in the chosen campaign; item must be available in the campaign/ruleset.
- `currency_code` is an existing campaign denomination. Numeric prices must satisfy the denomination's precision.
- `unit_price` and `buyback_price`: 0–1,000,000,000; `quantity`: integer 0–1,000,000.
- `buys_from_players`: true or false.
- Current listing identity is merchant + item definition + currency. A future preview must clearly state whether an import updates current stock or adjusts it incrementally.

### 4. Treasure / QR loot contents

`container_name,container_id,entry_type,item_name,item_definition_id,quantity,currency_code,currency_amount`

- Each row has `entry_type` set to **item** or **currency**.
- Item rows require item reference plus a quantity (currently 1–500 per `add_qr_loot_item` operation); leave currency fields empty.
- Currency rows require `currency_code` and positive `currency_amount` compatible with configured precision; leave item fields empty.
- Multiple rows may share a `container_name`. `container_id` can target a specific existing container. The future import must preview whether absent containers should be created.
- **Security:** only GMs can change loot; only active and unclaimed containers may be edited. A CSV must never contain QR bearer tokens, claim URLs, player secrets or credentials. QR codes are issued separately after contents are reviewed.

## Draft import resolution principles for Phases 8.2–8.5

These are contract directions, **not functionality in 8.1**:

1. The selected GM campaign supplies the campaign ID; do not put campaign IDs in CSV rows.
2. UUID (when supplied) wins as the explicit identity; supplied names must match that record. Without a UUID, a name must resolve **unambiguously** within the authorized campaign and its ruleset.
3. Do not silently create unknown characters, ruleset items, currency codes or merchant listings. Any future creation mode must be explicit in the import preview.
4. Reject unexpected headers, ambiguous names, invalid enum/boolean/numeric values and excess quantities with **row-specific errors** before any writes.
5. The GM must review totals, duplicates, existing-record matches and update-vs-append mode. No CSV file should update campaign data merely by selecting it.
6. Preserve full transaction and GM audit history. A partial failure must be reported precisely; imports must be idempotent or have safe retry design.
7. Protect against formula injection in any future exports or spreadsheet-generated error reports.

## Browser/UI acceptance for Milestone 8.1

- GM Dashboard includes a collapsed **GM CSV Templates** card.
- Each of the four cards downloads a **blank** CSV containing only the correct header row.
- Each of the four cards downloads an **example** CSV with matching columns and sample rows.
- Blank/example CSV files open correctly in Excel, Google Sheets and a plain text editor (quoted commas preserved).
- Field guides mark required vs optional/conditional columns and explain expected values.
- No Upload, Import, Submit or database mutation button is present at this stage.
- Test the download interaction on both desktop browsers and iOS Safari when possible.

The next milestone after acceptance is **8.2 — GM Catalog and Character Inventory CSV Uploads**.
