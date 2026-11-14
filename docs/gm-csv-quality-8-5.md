# Milestone 8.5 — Unified GM CSV Validation, Duplicate Resolution, and Reporting

## Status
Implemented for the four existing GM CSV import formats:
- Item Catalog
- Character Inventory
- Shop Inventory
- Treasure & QR Loot

The import permissions, existing RPCs, atomic transaction guarantees, and current CSV header templates remain unchanged. This milestone adds review and reporting, not new import types.

## Duplicate handling

When the uploaded CSV contains repeated logical row keys, the GM sees a **Duplicate Resolution** section before requesting a server preview. By default, duplicates are **rejected**. The GM must select an alternative deliberately.

| Choice | Behavior |
| --- | --- |
| Reject duplicates (default) | Show duplicate groups and their original CSV lines; do not preview or import until corrected or resolved |
| Keep first occurrence | Keep the earliest CSV row for each duplicated key; exclude later copies |
| Keep last occurrence | Keep the latest CSV row for each duplicated key; exclude earlier copies |
| Combine item quantities | For Character Inventory and Treasure & Loot item rows: sum quantities when the combined result stays in the existing 1–500 unit-per-row limit. **Loot currency duplicates take the last amount**, not the sum |

- For Item Catalog, duplicate detection is case-insensitive by item name.
- For Character Inventory, duplicates are keyed by character (UUID if supplied, otherwise name) and item definition (UUID if supplied, otherwise name).
- For Shop Inventory, duplicates are keyed by merchant, item definition and currency.
- For Treasure & Loot, duplicates are keyed by container, entry type and item definition or currency.
- Where one row uses a UUID and another uses a name for the same entity, the browser may not recognize them as a duplicate. The database remains authoritative and will reject ambiguous or repeated resolved identities; GMs can correct the CSV and reupload.
- All decisions are enumerated in the UI with original CSV line numbers. The raw upload file is **not changed**. Only the explicitly reviewed normalized rows are sent to the server.
- If combining would create a quantity above 500, validation fails. This is **not automatically split** into multiple rows (which would violate server duplicate rules).
- Invalid values and reference errors remain blocking even after duplicate resolution. No “ignore errors” or partial-import mode exists.

## Unified error reporting

- Existing local syntax and type validation runs on each CSV. The original file's physical line numbers are preserved, including after multiline quoted fields.
- On a failed full-batch Supabase preview, the app retains the original error and requests independent server dry-run diagnostics through `gm_csv_diagnose_rows`. This reports multiple independently invalid records with source CSV line numbers instead of only the first failed row.
- Server diagnostics **do not replace** the original atomic preview and cannot authorize a write. Cross-row ambiguity is still caught by the original batch RPC.
- A **Download Validation Report** button exports a UTF-8 CSV with source filename, import type, CSV line, error/resolution message, and recommended action.
- Exported reports escape CSV quoting and neutralize spreadsheet formula-leading cells such as `=...`, `+...`, `-...`, and `@...`. No raw QR tokens or credentials are included in reports.
- After the server confirms a successful import, **Download Import Receipt** records committed row actions and source CSV lines. A receipt is shown only after success is reported; if a response is lost, the GM should verify actual records before retrying.
- The UI can re-run server validation after references are corrected elsewhere in the GM Dashboard without forcing a CSV reupload.

## Server diagnostic API

`public.gm_csv_diagnose_rows(p_campaign uuid, p_kind text, p_rows jsonb)`

- Requires authenticated current campaign GM via `app_private.is_gm(p_campaign)`.
- Supports only the four approved CSV import types.
- Validates at most 200 rows (100 for Item Catalog).
- Calls **existing per-type import functions with `p_dry_run=true`**, one row at a time, and captures SQL error messages and row indices.
- No writes, no table changes, no automatic item/currency creation, and no relaxed permissions.
- `SECURITY DEFINER` with a fixed empty search path, schema-qualified references, `PUBLIC` and `anon` execution revoked.
- All confirmed imports still use the same previously accepted SQL RPCs and their transaction/preview checks.

## Acceptance test plan

1. All four CSV types are still available, including the previously accepted template downloads.
2. Duplicate Item Catalog names are shown with their original CSV line numbers, defaulting to **Reject duplicates**.
3. Choosing Keep First or Keep Last shows excluded lines, changes the planned action count and still requires a fresh server preview and confirmation.
4. Duplicate Character Inventory items can be **combined** into one quantity; combined values greater than 500 are blocked.
5. Duplicate Shop Inventory listings can use Keep First/Keep Last; the preview still shows the resulting replace-stock semantics.
6. Treasure & Loot item duplicates can combine quantities; duplicated currency denominations use the **last** amount, never summing currency.
7. Other malformed headers, invalid quantities, unknown items/currencies and ambiguous names remain blocking, even after duplicate resolution.
8. A CSV containing multiple unknown server references produces multiple line-specific errors instead of only the first, when the diagnostic call succeeds.
9. **Download Validation Report** includes all errors and decisions with original CSV lines, opens correctly in a spreadsheet and does not execute formula-looking strings.
10. After confirmation, **Download Import Receipt** contains committed actions. The original file stays unchanged.
11. Changing duplicate strategy after a preview clears that preview and its confirmation; no import occurs before explicit GM approval.
12. A non-GM cannot access server diagnostics. Existing imported data integrity, GM authorization, rollback behavior and shop/loot stale-preview checks still work.

## Verification notes
The diagnostic RPC was tested using a transaction rolled back against the existing test campaign. It collected errors for more than one invalid Loot row, identified the correct failed row numbers, and denied a different/non-GM identity. Existing import RPCs were not changed.
