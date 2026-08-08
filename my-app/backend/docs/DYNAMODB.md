# DynamoDB + Zoho Books (multi-table)

## Architecture

- **One DynamoDB table per entity** (not a single shared table).
- Prefix `Abhyati` → tables like `Abhyati_contacts`, `Abhyati_items`, `Abhyati_invoices`, …
- **Writes:** Zoho Books first, then mirror into the matching Dynamo table.
- **Reads:** When `DYNAMODB_READS=true`, list/get use Dynamo (Zoho fallback on miss/error).
- **List performance:** Full-table scans are cached in-process (~5 min, `DYNAMODB_SCAN_CACHE_TTL_MS`). Admin/customer item lists skip Zoho per-row hydration when Dynamo reads are on. Boot warms `items` + `contacts` only (invoice/SO tables are large and load on demand).
- **Daily sync:** `node-cron` on Render at **18:00 Asia/Kolkata**.
- **Item custom fields:** Set `ZOHO_SYNC_ITEM_DETAILS=true` (once or on cron) so item mirrors include `custom_fields` for admin virtuals without per-row Zoho GETs.
- **Contact details:** Set `ZOHO_SYNC_CONTACT_DETAILS=true` so customer/driver notes land in Dynamo for app-login detection.

## Tables

| Table | Contents | Indexes |
|-------|----------|---------|
| `Abhyati_contacts` | Zoho contacts | GSI1 email |
| `Abhyati_items` | Catalog items | — |
| `Abhyati_invoices` | Invoices | GSI2 customer |
| `Abhyati_salesorders` | Sales orders | GSI2 customer |
| `Abhyati_customerpayments` | Payments | GSI2 customer |
| `Abhyati_inventoryadjustments` | Stock adjustments | — |
| `Abhyati_deliverychallans` | Delivery challans | — |
| `Abhyati_users` | Zoho users | — |
| `Abhyati_bankaccounts` | Bank accounts | — |
| `Abhyati_assignments` | Delivery assignments | GSI1 driver |
| `Abhyati_payment_records` | Razorpay payment records | — |
| `Abhyati_notifications` | In-app notifications | GSI1 recipient |
| `Abhyati_audit` | Admin audit | — |

Each item uses partition key `id` and stores the Zoho/app JSON in `payload`.

## Setup

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
DYNAMODB_TABLE_PREFIX=Abhyati
DYNAMODB_ENABLED=true
DYNAMODB_READS=true
DYNAMODB_SYNC_CRON_ENABLED=true
# optional: DYNAMODB_SCAN_CACHE_TTL_MS=60000
# optional: ZOHO_SYNC_ITEM_DETAILS=true
```

```bash
npm run dynamo:create-table
npm run dynamo:sync
npm run dynamo:migrate-json   # optional
```

Restart the backend after sync (reads default on).

## Admin API

- `GET /api/admin/dynamodb/status`
- `POST /api/admin/dynamodb/sync`
