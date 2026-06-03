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

  /** MSG91 OTP (customer app login / signup). Template from MSG91 OTP widget / flow. */
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  MSG91_COUNTRY_CODE: z.string().default('91'),
  MSG91_OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  MSG91_OTP_EXPIRY_MIN: z.coerce.number().int().min(1).max(30).default(10),
  /** Dev only: allow OTP send/verify without MSG91 (verify with MSG91_DEV_OTP). */
  MSG91_DEV_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  MSG91_DEV_OTP: z.string().default('123456')
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
