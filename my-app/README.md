# Abhyati Food Customer App

Mobile-first React + Capacitor app with Zoho Books backend integration.

## Frontend setup

```bash
npm install
npm run dev
```

## Admin dashboard (separate React website)

Path: [`admin-dashboard/`](admin-dashboard/). Runs on **port 5174** with a Vite proxy to the backend (`/api` → `http://localhost:4000`).

```bash
npm run admin:dev
# or: cd admin-dashboard && npm install && npm run dev
```

Open `http://localhost:5174` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from [`backend/.env.example`](backend/.env.example) (defaults are `admin@abhyati.com` / `admin` until you change them).

**API URL:** By default the admin UI calls `/api` on the same host and Vite proxies to **`http://localhost:3001`** (override with `VITE_PROXY_TARGET` in [`admin-dashboard/.env.example`](admin-dashboard/.env.example)). To use a **hosted** backend instead (e.g. Render), create `admin-dashboard/.env.local`:

`VITE_API_BASE_URL=https://abhyati-food-customer-app.onrender.com`

Then restart `npm run admin:dev`. Ensure Render `ALLOWED_ORIGINS` includes `http://localhost:5174` if you use CORS restrictions (this repo’s backend uses `cors({ origin: '*' })` so it is usually fine).

The dashboard manages **customers** (Zoho customer + app login), **drivers** (Zoho contact + delivery login), **products** (Zoho items — create / edit / delete, same source as the customer app catalog), **orders & delivery** (same Zoho **sales orders** as the driver app, plus create new sales orders with line items), and a **KPI overview**. Admin actions are appended to `backend/data/admin-audit.jsonl`.

## Backend setup (Zoho Books)

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Backend runs at `http://localhost:4000` by default.

### Test customer login (seeded on first backend start)

After `npm run dev` in `backend/`, a default customer is created if missing (see `AUTH_DEFAULT_*` in `.env.example`). **Self-service signup is disabled**; create customers from the admin dashboard. **Delivery drivers** sign in with email/password against `POST /api/delivery/login` after an admin creates them (Zoho contact + driver record).

### Required backend env values

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_REGION`
- `ZOHO_ORGANIZATION_ID` (optional; auto-selects first org if omitted)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` (admin dashboard + customer/driver JWTs)
- `ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID` (optional; when set, delivery POD reduces stock via Zoho inventory adjustments)
- `DRIVER_ZOHO_CONTACT_TYPE` (`vendor` or `customer`) for new driver contacts in Zoho Books

## Available backend APIs

Base URL (local): `http://localhost:3001`

### Core

- `GET /health`
- `GET /api/zoho/organizations`
- `POST /api/zoho/sync-order` (find/create customer + create invoice)

### Customers / Contacts

- `GET /api/zoho/customers`
- `GET /api/zoho/customers?email=user@example.com`
- `GET /api/zoho/customers/:id`
- `POST /api/zoho/customers`

### Sales

- `GET /api/zoho/quotes`
- `GET /api/zoho/quotes/:id`
- `POST /api/zoho/quotes`
- `GET /api/zoho/sales-orders`
- `GET /api/zoho/sales-orders/:id`
- `POST /api/zoho/sales-orders`
- `GET /api/zoho/invoices`
- `GET /api/zoho/invoices/:id`
- `POST /api/zoho/invoices`
- `GET /api/zoho/recurring-invoices`
- `GET /api/zoho/recurring-invoices/:id`
- `POST /api/zoho/recurring-invoices`
- `GET /api/zoho/delivery-challans`
- `GET /api/zoho/delivery-challans/:id`
- `POST /api/zoho/delivery-challans`
- `GET /api/zoho/payment-links`
- `GET /api/zoho/payment-links/:id`
- `POST /api/zoho/payment-links`
- `GET /api/zoho/payments-received`
- `GET /api/zoho/payments-received/:id`
- `POST /api/zoho/payments-received`
- `GET /api/zoho/sales-returns`
- `GET /api/zoho/sales-returns/:id`
- `POST /api/zoho/sales-returns`
- `GET /api/zoho/credit-notes`
- `GET /api/zoho/credit-notes/:id`
- `POST /api/zoho/credit-notes`

### Items & Inventory

- `GET /api/zoho/items`
- `GET /api/zoho/items/:id`
- `POST /api/zoho/items`
- `GET /api/zoho/price-lists`
- `GET /api/zoho/price-lists/:id`
- `POST /api/zoho/price-lists`
- `GET /api/zoho/inventory-adjustments`
- `GET /api/zoho/inventory-adjustments/:id`
- `POST /api/zoho/inventory-adjustments`
- `GET /api/zoho/shipments`
- `GET /api/zoho/shipments/:id`
- `POST /api/zoho/shipments`
- `GET /api/zoho/transfer-orders`
- `GET /api/zoho/transfer-orders/:id`
- `POST /api/zoho/transfer-orders`

### Purchases

- `GET /api/zoho/vendors`
- `GET /api/zoho/vendors/:id`
- `POST /api/zoho/vendors`
- `GET /api/zoho/purchase-orders`
- `GET /api/zoho/purchase-orders/:id`
- `POST /api/zoho/purchase-orders`
- `GET /api/zoho/bills`
- `GET /api/zoho/bills/:id`
- `POST /api/zoho/bills`
- `GET /api/zoho/recurring-bills`
- `GET /api/zoho/recurring-bills/:id`
- `POST /api/zoho/recurring-bills`
- `GET /api/zoho/vendor-credits`
- `GET /api/zoho/vendor-credits/:id`
- `POST /api/zoho/vendor-credits`
- `GET /api/zoho/expenses`
- `GET /api/zoho/expenses/:id`
- `POST /api/zoho/expenses`

### Time Tracking

- `GET /api/zoho/projects`
- `GET /api/zoho/projects/:id`
- `POST /api/zoho/projects`
- `GET /api/zoho/tasks`
- `GET /api/zoho/tasks/:id`
- `POST /api/zoho/tasks`
- `GET /api/zoho/time-entries`
- `GET /api/zoho/time-entries/:id`
- `POST /api/zoho/time-entries`

### Banking / Accountant

- `GET /api/zoho/bank-accounts`
- `GET /api/zoho/bank-accounts/:id`
- `POST /api/zoho/bank-accounts`
- `GET /api/zoho/bank-transactions`
- `GET /api/zoho/bank-transactions/:id`
- `POST /api/zoho/bank-transactions`
- `GET /api/zoho/journals`
- `GET /api/zoho/journals/:id`
- `POST /api/zoho/journals`

### Reports

- `GET /api/zoho/reports` (returns usage message)
- `GET /api/zoho/reports/:reportName`
  - Example: `/api/zoho/reports/profitandloss?from_date=2025-04-01&to_date=2026-03-31`

### UI-only / Not Exposed as stable public API

- `GET /api/zoho/e-way-bills` -> `501`
- `GET /api/zoho/documents` -> `501`
- `GET /api/zoho/web-tabs` -> `501`

### Common list query params

- `page` (number)
- `per_page` (max 200)
- `search_text` (module support varies in Zoho)

## Google Maps (delivery driver)

Driver maps use the **Maps Embed API**. Set `VITE_GOOGLE_MAPS_API_KEY` in `my-app/.env` (see `my-app/.env.example`) and enable **Maps Embed API** for that key in Google Cloud. The app requests **browser geolocation** when available; with a key it shows **directions** from your position to the stop address, otherwise **place** mode for the destination only. With no key, users still get **Open in Google Maps** (native app) with the same destination and optional `origin` from geolocation.

## Capacitor builds

### Android

Gradle needs **JDK 21 or newer** (the default `java` on some machines is 17 and will fail with `invalid source release: 21`). Point `JAVA_HOME` at your install, then build from the repo root:

```bash
export JAVA_HOME=/Users/m.sharan/Library/Java/JavaVirtualMachines/openjdk-23.0.1/Contents/Home
cd my-app && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```

If you are already inside `my-app/`, use:

```bash
export JAVA_HOME=/Users/m.sharan/Library/Java/JavaVirtualMachines/openjdk-23.0.1/Contents/Home
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```

Debug APK:

`my-app/android/app/build/outputs/apk/debug/Abhyati-food-debug.apk` (from repo root), or `android/app/build/outputs/apk/debug/Abhyati-food-debug.apk` when your current directory is `my-app/`.

### iOS

```bash
npm run build
npx cap sync ios
npx cap open ios
```

Then build/archive from Xcode.
