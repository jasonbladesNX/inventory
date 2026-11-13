# Milestone 8.3 — GM Shop Inventory CSV Uploads

## Status and scope
Implemented in **GM Dashboard → GM CSV Imports → Shop Inventory**.

This extends the validated **8.2 import workflow** with a third CSV type, without changing the approved Item Catalog and Character Inventory import modes. **Treasure / QR Loot imports remain deferred to 8.4.**

## Supported template (unchanged headers)
Download **GM CSV Templates → Shop Inventory & Prices** (blank or example). The required CSV headers, in any order, are:

`merchant_name,merchant_id,item_name,item_definition_id,currency_code,unit_price,buyback_price,quantity,buys_from_players`

- `merchant_name` / `merchant_id`: supply either a unique existing merchant name (case-insensitive) or that merchant's UUID. If both are given, the names must match. Merchants must belong to the selected campaign. Inactive merchants may be stocked by a GM, but they remain closed to players.
- `item_name` / `item_definition_id`: supply either a unique existing item definition name or UUID, from the selected campaign or its ruleset. Both fields must agree if supplied.
- `currency_code`: an existing campaign currency denomination, e.g. GP, CP. Its configured `precision_digits` determines valid price decimals.
- `unit_price` / `buyback_price`: zero to 1,000,000,000 inclusive, nonnegative, up to six decimal places; must respect the currency's actual precision.
- `quantity`: **absolute stock** (0–1,000,000 inclusive); zero means out of stock.
- `buys_from_players`: `true` or `false`.

The example merchant names are illustrative: create or select actual merchants and configure campaign currencies before previewing or importing. The example was adjusted to use integral GP prices because many campaigns configure zero decimal places for GP.

## Import semantics: **Replace matching listings**
A listing is identified by **merchant + item definition + currency**.

- **Existing listing:** replace *that listing's* selling price, buyback price, stock quantity, and `buys_from_players`. Stock is NOT added/incremented.
- **New merchant/item/currency combination:** create a new listing with the supplied settings.
- **Other merchant merchandise not in the CSV:** unchanged.
- **Duplicate listing** (even when referred to once by name and once by UUID): entire import is rejected.
- No merchants, item definitions, or currencies are created by 8.3.

The server uses the existing `public.save_merchant_listing` function, preserving the established merchant listing uniqueness and validation.

## User workflow
1. Open GM Dashboard and expand **GM CSV Imports**.
2. Choose **Shop Inventory** and select a completed `.csv` (max 1 MB; 1–200 data rows).
3. Fix any local parse, malformed header, invalid price, quantity, boolean, or duplicate-row errors.
4. Click **Validate & Preview**. The server resolves merchant/item/currency records, checks GM authorization and rules, and reports each row as **Create** or **Replace** with *current versus proposed* stock, price, buyback price, and buyback eligibility. **No writes occur during preview.**
5. Explicitly tick the GM approval checkbox and click **Confirm & Replace Shop Listings**. The request includes the preview snapshot.
6. The server re-checks all rows, locks existing listings, and compares current values against the preview. If anything changed since review, it rejects the batch and requires a new preview.
7. If all rows validate and the preview is still current, the entire set of listing upserts commits as **one PostgreSQL transaction**. Any failing row rolls back the full batch. The GM receives created/updated totals and the merchant editor refreshes.

## Security and database
- Supabase function: `public.gm_import_shop_stock_csv(p_campaign uuid,p_rows jsonb,p_dry_run boolean,p_expected jsonb)`.
- Only an authenticated, **authorized GM** of the specific campaign can call it. Function execution is revoked from `public` and `anon`; `app_private.is_gm(p_campaign)` is checked before any preview or mutation.
- `SECURITY DEFINER` with empty fixed `search_path`, schema-qualified references, campaign-scoped resolutions for merchants, currency and items.
- File parsing and obvious row errors happen in the browser; the server **independently validates** every field and all campaign references, even for direct RPC calls.
- Preview rows are canonical server-generated JSON. The confirmed import requires the exact preview array in `p_expected` and revalidates the data; stale or missing preview is rejected.
- The application never writes directly to `merchant_listings` from the browser and never uploads the original CSV file to file storage.
- If a network connection is interrupted during confirmation, **verify the shop's actual stock before retrying**, because the server may have committed even if the response was lost.

## 8.3 limits
| Constraint | Limit |
| --- | --- |
| CSV file size | 1 MB |
| Rows per import | 1–200 |
| Stock per listing | 0–1,000,000 units |
| Selling and buyback prices | 0–1,000,000,000, according to currency precision |
| Duplicate merchant/item/currency | Rejected |
| Existing stock updates | Replaced (not incremented) |
| Missing merchants, items, currencies | Rejected (no implicit creation) |

## Acceptance testing

1. GM Dashboard imports contain a third **Shop Inventory** mode; earlier Catalog/Character modes and all CSV template downloads still work.
2. A valid shop CSV passes local validation and renders a server-resolved **Create/Replace** preview without modifying inventory.
3. The preview clearly shows old/new stock, selling price, buyback and buyback eligibility and identifies the merchant, item and currency.
4. Confirming a new listing creates that shop merchandise, showing up in Campaign Merchants.
5. Confirming an existing listing replaces stock/prices/buyback settings; other shop merchandise is unchanged.
6. A quantity of **0** sets the listing out of stock. Non-numeric/negative/over-limit stock is rejected.
7. Invalid currency code or excessive decimal precision, missing/ambiguous merchant/item names, inconsistent IDs, duplicate lines and an invalid buyback flag block import.
8. A mixed valid/invalid CSV makes no changes (atomic rollback).
9. A listing modified between preview and confirmation causes the import to fail as stale, requiring re-preview.
10. A player or anonymous session cannot import listings, and a GM from a different campaign cannot target another campaign's merchants.
11. Shop UI automatically refreshes after successful import; mobile file selection and horizontally scrollable preview work.

## Database verification performed
The import RPC was exercised in an explicit test transaction with an existing test merchant. Checked dry-run no-write behavior, replacement of an existing listing, creation of a new merchant/item/currency listing, duplicate and currency-precision rejection, stale-preview protection, and unauthenticated denial. The transaction was **rolled back**, so no test stock changes remain.
