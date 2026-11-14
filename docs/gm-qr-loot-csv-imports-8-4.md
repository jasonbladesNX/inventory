# Milestone 8.4 — GM Treasure & QR Loot CSV Uploads

## Status
Implemented under **GM Dashboard → GM CSV Imports → Treasure & Loot**. Uses the unchanged **Treasure & QR Loot Contents** template from Milestone 8.1. The existing Catalog, Character Inventory, and Shop Inventory modes remain available.

This milestone configures **physical item rewards and currency rewards** for campaign QR loot sources. It does **not** issue or distribute claim QR codes. After importing, the GM opens **QR Loot Containers** to review contents and generate a one-use claim link.

## Approved CSV columns
`container_name,container_id,entry_type,item_name,item_definition_id,quantity,currency_code,currency_amount`

- `container_name`: required when `container_id` is blank; 2–120 characters. A matching existing **unique** container name resolves to that container; a new name creates a new container.
- `container_id`: optional UUID identifying an existing loot source in the **selected campaign**, overriding name-based resolution. If a name is also given, it must match.
- `entry_type`: `item` or `currency`.
- For **item** rows, supply a uniquely resolving existing `item_name` or `item_definition_id`, and `quantity` from 1 to 500. Leave all currency fields blank.
- For **currency** rows, supply a configured `currency_code` and a strictly positive `currency_amount` no greater than 1,000,000,000, with at most 6 decimal places and respecting that campaign denomination's precision. Leave item fields and quantity blank.
- A single CSV can contain multiple rows for one container and several distinct containers.
- Duplicate *resolved* container/item pairs and duplicate container/currency pairs are rejected. Combine same-item quantities into one row. An item's name and UUID must agree if both are supplied.
- Examples use illustrative names and may require suitable campaign items/currencies before the server preview succeeds.

## Import semantics

| Case | Behavior |
|---|---|
| New container name | Create an active, `first_claim` / `instant` QR loot container after successful confirmation |
| Existing active, unclaimed first-claim QR container with no usable QR tokens | Add the specified rewards |
| Existing physical item definition in target container | **ADD** CSV quantity to its current total, preserving automatic stacking/equipment-instance separation |
| Existing currency denomination | **SET/REPLACE** that denomination's amount, not increment it |
| Existing items/currencies omitted from the CSV | Leave them unchanged |
| Existing inactive, claimed, unsupported-mode or token-issued container | Reject the entire import; use a new container |
| New QR claim token | **Never generated during CSV import**; GM generates it separately after reviewing the loaded contents |

**The CSV must not contain any bearer QR tokens or player credentials.** Importing a container does not automatically award loot.

## Flow

1. Select **Treasure & Loot** in GM CSV Imports and choose a completed `.csv` file.
2. Local parsing checks column headers, quoting, row lengths, item/currency field exclusivity, positive quantities/amounts, UUID format, and duplicate obvious pairs.
3. Click **Validate & Preview**. Supabase verifies the GM, campaign, source eligibility, item definitions, currency precision, duplicate resolved identities, and active QR tokens. **Preview never changes loot.**
4. The preview displays container names, whether each is being created, items vs. currency, current quantity/amount and resulting quantity/amount.
5. Tick the approval checkbox and select **Confirm & Import Loot**. The confirmation includes the exact preview snapshot.
6. Supabase revalidates and rejects changed/stale snapshots. Existing sources are locked; new sources and their rewards are created within **one atomic database transaction**.
7. Successful import shows counts of new containers, item rows and currency rows; QR Loot Containers refreshes. The GM may then review rewards and manually generate claim QR codes.

## Limits & guarantees

- CSV size **up to 1 MB**.
- **1–200 reward rows** per CSV.
- **Up to 50 new containers** in one import.
- Item quantity **1–500 per row**, maximum **10,000 total item units** per file.
- Currency amount must be **positive and ≤1,000,000,000**, with valid denomination precision.
- Names/UUIDs resolve only to the selected campaign or its ruleset.
- Only **authenticated campaign GMs** can use the import RPC. Server validates GM authorization even when called outside the UI.
- Server function: `public.gm_import_qr_loot_csv(p_campaign uuid,p_rows jsonb,p_dry_run boolean,p_expected jsonb)`.
- The existing `public.add_qr_loot_item`, `public.set_qr_loot_currency`, and `public.create_qr_loot_container` functions handle actual writes, preserving existing item stacking and loot business logic.
- Function execution revoked from `anon` and `PUBLIC`. A fixed empty `search_path` and schema-qualified tables/functions are used.
- Preview and confirmation use the same canonical server plan, including old quantities and currency amounts. Any changed target row requires a new preview.
- On a failed SQL operation, **no partial items, currency or containers remain**. On a lost network response, a GM should verify the container's actual contents before retrying.

## Database verification
Completed in explicit `BEGIN ... ROLLBACK` test transactions against the existing test campaign:

- Preview for a new container and existing container, with both item and currency rows, without writing.
- Atomic confirmed creation of a new container with physical and currency rewards; added physical items to an existing container.
- Existing currency replacement rather than increment, and detection of a changed amount after preview.
- Denial of claimed/inactive containers and of containers with active one-use QR tokens.
- Rejection of stale or missing snapshots, invalid currency codes and unauthorized/non-GM requests.
- Every test transaction was rolled back: **no testing loot or QR tokens were left behind**.

## Acceptance testing (browser/iOS)
1. GM Dashboard CSV Imports has **Treasure & Loot** alongside earlier three import modes.
2. Blank and example Treasure & QR Loot CSV files download with the approved eight columns.
3. Valid mixed item/currency CSV previews container creation and modifications without writes.
4. The preview distinguishes item **ADD** from currency **SET**, shows current and proposed quantities and source status.
5. Confirming a new container creates a visible QR loot container with all specified items and currency; no QR token appears until separately issued.
6. Confirming an existing active/unclaimed container adds item quantities and replaces only the specified currency denomination.
7. Other container contents and other campaign containers are unchanged.
8. Invalid amounts/precision/quantity, missing or ambiguous item/currency names, duplicate entries, or malformed CSV produce errors and no partial writes.
9. Claimed, inactive or active-token containers cannot be imported into.
10. A stale preview rejects changes and prompts re-preview.
11. A non-GM or anonymous account cannot import; the picker/preview remain usable on iPhone and desktop.

**Next:** Milestone 8.5 — Unified CSV Import Validation, Duplicate Resolution & Error Reporting.
