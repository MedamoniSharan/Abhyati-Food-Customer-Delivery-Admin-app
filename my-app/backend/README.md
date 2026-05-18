# Abhyati Food Backend (Zoho Books)

Node/Express backend to integrate customer orders with Zoho Books.

## Setup

1. Install dependencies:
   - `cd backend`
   - `npm install`
2. Create env file:
   - `cp .env.example .env`
3. Fill Zoho credentials in `.env`.
4. Run server:
   - `npm run dev`

## Endpoints

- `GET /health`
- `GET /api/zoho/organizations`
- `GET /api/zoho/customers?email=user@example.com`
- `POST /api/zoho/customers`
- `POST /api/zoho/invoices`
- `POST /api/zoho/sales-orders`
- `POST /api/zoho/sync-order` (create/find customer + create invoice)

## Example payloads

### `POST /api/zoho/customers`

```json
{
  "contact_name": "Mahesh Sharan",
  "email": "mahesh@example.com",
  "mobile": "9876543210"
}
```

### `POST /api/zoho/sync-order`

```json
{
  "customer_name": "Mahesh Sharan",
  "customer_email": "mahesh@example.com",
  "customer_phone": "9876543210",
  "invoice_number": "INV-1001",
  "reference_number": "ORD-83210",
  "line_items": [
    {
      "description": "Bio-Degradable 9 inch Dinner Plates",
      "quantity": 10,
      "rate": 3199
    }
  ]
}
```

## Notes

- Uses OAuth refresh token flow; no manual token handling needed.
- Default currency is `INR` (configurable via env).
