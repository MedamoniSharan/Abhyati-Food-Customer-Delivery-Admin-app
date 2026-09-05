import dotenv from 'dotenv'
import { z } from 'zod'
import { createLogger } from '../util/logger.js'

dotenv.config()

const log = createLogger('config')

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173', 'http://localhost:5174', '*'),

  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  ZOHO_REFRESH_TOKEN: z.string().min(1),
  ZOHO_REGION: z.enum(['in', 'com', 'eu', 'com.au', 'jp', 'com.cn']).default('in'),
  ZOHO_ORGANIZATION_ID: z.string().optional(),
  /** Optional static access token (dev only). Prefer refresh-token flow via ZOHO_REFRESH_TOKEN. */
  ZOHO_ACCESS_TOKEN: z.string().optional(),

  ZOHO_DEFAULT_CURRENCY_CODE: z.string().default('INR'),
  ZOHO_DEFAULT_PAYMENT_TERMS: z.string().default('Due on Receipt'),
  AUTH_DEFAULT_CUSTOMER_EMAIL: z.string().email().default('customer@abhyati.com'),
  AUTH_DEFAULT_CUSTOMER_PASSWORD: z.string().min(6).default('Abhyati@123'),
  /** When true, seeds default customer on startup (off by default in production). */
  AUTH_SEED_DEFAULT_CUSTOMER: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  /** Admin dashboard + /api/admin/* (override in production) */
  ADMIN_EMAIL: z.string().email().default('admin@abhyati.com'),
  ADMIN_PASSWORD: z.string().min(5).default('admin'),
  JWT_SECRET: z.string().min(16).default('dev-jwt-secret-change-in-prod-32'),

  DRIVER_ZOHO_CONTACT_TYPE: z.enum(['vendor', 'customer']).default('vendor'),

  /** Chart account id for quantity inventory adjustments when customers check out */
  ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID: z.string().optional(),

  /** When Zoho requires a salesperson on invoices/sales orders, set explicitly or leave unset to auto-pick first active org user */
  ZOHO_DEFAULT_SALESPERSON_ID: z.string().optional(),
  ZOHO_DEFAULT_SALESPERSON_NAME: z.string().optional(),

  /**
   * Customer pricing tiers stored in Zoho Books (see .env.example).
   * All three must be set for tier CRUD + per-customer discounts; otherwise pricing features are disabled.
   */
  ZOHO_PRICING_TIERS_CONTACT_ID: z.string().optional(),
  /** Contact custom field id on the catalog contact holding JSON array of tiers */
  ZOHO_CUSTOM_FIELD_TIERS_JSON_ID: z.string().optional(),
  /** Contact custom field id on each customer contact holding the active tier id (or empty) */
  ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID: z.string().optional(),
  /**
   * Item custom field id for the customer-facing product title (optional).
   * When set, GET /api/customer/items replaces `name` with this value for the app catalog; admin edit saves here and keeps Zoho `name` read-only.
   */
  ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID: z.string().optional(),
  /**
   * Item custom field id for minimum purchase / order quantity (optional).
   * When set, admin can edit `min_purchase_count`; customer app uses it as MOQ.
   */
  ZOHO_CUSTOM_FIELD_ITEM_MIN_PURCHASE_ID: z.string().optional(),

  /**
   * Product categories (separate from customer pricing tiers): JSON array on a Zoho contact
   * `[{ "id": "...", "name": "..." }]` plus item custom field for each product's category label.
   */
  ZOHO_PRODUCT_CATEGORIES_CONTACT_ID: z.string().optional(),
  ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID: z.string().optional(),
  ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID: z.string().optional(),

  /** Razorpay online payments (optional — required for Pay now checkout) */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  /** Zoho Books bank account for recording Razorpay customer payments */
  ZOHO_PAYMENT_ACCOUNT_ID: z.string().optional(),

  /** MSG91 phone OTP for customer signup (optional — required to send/verify OTP) */
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  MSG91_OTP_LENGTH: z.coerce.number().int().min(4).max(9).default(6),
  /** MSG91 OTP Widget (preferred). Server calls widget APIs so browser IPs are not blocked. */
  MSG91_WIDGET_ID: z.string().optional(),
  MSG91_WIDGET_AUTH_TOKEN: z.string().optional(),

  /** AWS DynamoDB (optional until configured — without table name, Zoho-only behavior remains) */
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),
  /** Multi-table prefix, e.g. Abhyati → Abhyati_contacts, Abhyati_items, ... */
  DYNAMODB_TABLE_PREFIX: z.string().optional(),
  /** Legacy single-table name; treated as prefix (AbhyatiApp → Abhyati) if PREFIX unset */
  DYNAMODB_TABLE_NAME: z.string().optional(),
  /** When false, skip dual-write even if table is set */
  DYNAMODB_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? true : v === 'true' || v === '1')),
  /** When false, GETs still hit Zoho (writes may still dual-write). Defaults to true when configured. */
  DYNAMODB_READS: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? true : v === 'true' || v === '1')),
  /** Daily Zoho → DynamoDB sync at 18:00 Asia/Kolkata (default on when Dynamo configured) */
  DYNAMODB_SYNC_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? true : v === 'true' || v === '1'))
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  log.error('Invalid environment configuration', {
    fieldErrors: parsed.error.flatten().fieldErrors
  })
  process.exit(1)
}

const regionHosts = {
  in: { accounts: 'accounts.zoho.in', books: 'www.zohoapis.in' },
  com: { accounts: 'accounts.zoho.com', books: 'www.zohoapis.com' },
  eu: { accounts: 'accounts.zoho.eu', books: 'www.zohoapis.eu' },
  'com.au': { accounts: 'accounts.zoho.com.au', books: 'www.zohoapis.com.au' },
  jp: { accounts: 'accounts.zoho.jp', books: 'www.zohoapis.jp' },
  'com.cn': { accounts: 'accounts.zoho.com.cn', books: 'www.zohoapis.com.cn' }
}

export const env = {
  ...parsed.data,
  ALLOWED_ORIGINS: parsed.data.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
  ZOHO_ACCOUNTS_BASE_URL: `https://${regionHosts[parsed.data.ZOHO_REGION].accounts}`,
  ZOHO_BOOKS_BASE_URL: `https://${regionHosts[parsed.data.ZOHO_REGION].books}/books/v3`
}
