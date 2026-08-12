import axios from 'axios'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../config/env.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { appendAdminAudit } from '../services/adminAuditService.js'
import { countCustomerAppLoginsInZoho, createCustomerUser, setCustomerContactDisabled, updateCustomerUserByEmail } from '../services/authStore.js'
import {
  createDriverRecord,
  getDriverByEmail,
  getDriverEmailByZohoContactId,
  listDrivers,
  setDriverDisabled,
  setDriverDisabledByContactId,
  deleteDriverRecordByContactId,
  updateDriverRecord
} from '../services/driverStore.js'
import {
  hasCustomerAppLoginNotes,
  hasDriverAppLoginNotes,
  DRV_PW_PREFIX,
  parseDriverPasswordHashFromNotes,
  redactNotesForAdmin
} from '../services/zohoAppCredentialNotes.js'
import {
  createModule,
  createSalesOrder,
  deleteModule,
  ensureCustomerContact,
  ensureDriverContact,
  findCustomerByEmail,
  getInvoiceAttachment,
  getModuleById,
  getOrganizationId,
  listContactsDetailBySearchText,
  listModule,
  markZohoItemInactive,
  updateModule
} from '../services/zohoBooksService.js'
import { signAdminToken } from '../services/jwtService.js'
import { mapDeliveryStopFromSalesOrder } from '../services/zohoDeliveryMap.js'
import { uploadItemImageToZoho } from '../services/zohoItemImageService.js'
import { scanItemsMissingCatalogImage } from '../services/zohoItemImageMeta.js'
import { scanAllItemsProductCategoryCoverage } from '../services/zohoItemProductCategoryScan.js'
import {
  getZohoItemCustomerDisplayFieldId,
  mergeCustomerProductNameIntoItemCustomFields,
  withCustomerProductNameVirtual
} from '../services/zohoItemCustomerDisplay.js'
import {
  getZohoItemMinPurchaseFieldId,
  mergeMinPurchaseIntoItemCustomFields,
  withMinPurchaseCountVirtual
} from '../services/zohoItemMinPurchase.js'
import {
  getZohoItemCategoryFieldId,
  getProductCategoryEnvStatus,
  invalidateProductCategoryCache,
  isProductCategoryConfigured,
  listProductCategories,
  mergeProductCategoryNameIntoItemCustomFields,
  newProductCategoryId,
  saveProductCategoriesFull,
  hydrateItemsListRowsForProductCategoryField,
  withItemProductCategoryVirtual
} from '../services/productCategoryZohoService.js'
import { invalidateItemCategoryIndex } from '../services/itemCategoryIndexCache.js'
import {
  createAssignment,
  getAssignmentById,
  listAssignments,
  listAssignmentsMerged,
  mirrorAssignmentNow
} from '../services/deliveryAssignmentStore.js'
import { clearDriverAssignmentZohoCache } from '../services/deliveryAssignmentResolve.js'
import {
  notifyCustomerDriverAssigned,
  notifyCustomerOrderDelivered,
  notifyCustomerOrderShipped,
  notifyDriverAssignment
} from '../services/notificationService.js'
import { upsertInvoiceAssignmentNote } from '../services/zohoDeliveryAssignmentNotes.js'
import { pricingTiersArraySchema } from '../services/customerPricingMath.js'
import { paymentsByInvoiceIdMap, listPaymentRecordsMerged } from '../services/paymentRecordStore.js'
import {
  addPricingTier,
  deletePricingTier,
  isCustomerPricingConfigured,
  listPricingTiers,
  savePricingTiers,
  resolvePricingTierDisplay,
  setCustomerPricingTier,
  updatePricingTier
} from '../services/customerPricingZohoService.js'
import { isDynamoConfigured, isDynamoReadsEnabled, isDynamoWritesEnabled, getDynamoTablePrefix } from '../services/dynamo/dynamoClient.js'
import { runZohoDynamoSyncNow } from '../services/dynamoSyncScheduler.js'

export const adminRoutes = Router()

const itemImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) {
      cb(null, true)
    } else {
      const err = new Error('Only JPEG, PNG, GIF, and WebP images are allowed')
      err.statusCode = 400
      cb(err, false)
    }
  }
})

function handleItemImageUpload(req, res, next) {
  itemImageUpload.single('image')(req, res, (err) => {
    if (err) return next(err)
    if (!req.file) {
      const e = new Error('Missing image file (multipart field name: image)')
      e.statusCode = 400
      return next(e)
    }
    next()
  })
}

/** Zoho list/detail may expose quantity on the item or under `locations[]`. */
const ZOHO_STOCK_BODY_KEYS = ['stock_on_hand', 'available_stock', 'actual_available_stock', 'opening_stock']

function readZohoItemQuantity(item) {
  if (!item || typeof item !== 'object') return null
  for (const k of ZOHO_STOCK_BODY_KEYS) {
    if (!(k in item)) continue
    const raw = item[k]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  const locs = item.locations
  if (!Array.isArray(locs)) return null
  let fallback = null
  for (const loc of locs) {
    if (!loc || typeof loc !== 'object') continue
    for (const field of ['location_actual_available_stock', 'location_available_stock', 'location_stock_on_hand']) {
      const raw = loc[field]
      if (raw === '' || raw == null) continue
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      if (loc.is_primary === true || loc.is_primary === 'true') return n
      if (fallback === null) fallback = n
    }
  }
  return fallback
}

function extractStockTargetFromBody(body) {
  if (!body || typeof body !== 'object') return null
  for (const k of ZOHO_STOCK_BODY_KEYS) {
    if (!(k in body)) continue
    const raw = body[k]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}

function stripStockFieldsFromBody(body) {
  const clean = { ...body }
  for (const k of ZOHO_STOCK_BODY_KEYS) delete clean[k]
  return clean
}

/** Zoho rejects or mis-handles JSON nulls (e.g. rate: null). */
function omitNullishPayloadFields(obj) {
  if (!obj || typeof obj !== 'object') return {}
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null))
}

/** @param {Record<string, unknown>} body */
async function resolveProductCategoryNameFromAdminBody(body) {
  if (!body || typeof body !== 'object' || !isProductCategoryConfigured()) return null
  if (Object.prototype.hasOwnProperty.call(body, 'product_category_id')) {
    const pid = String(body.product_category_id ?? '').trim()
    if (!pid) return ''
    const cats = await listProductCategories()
    const c = cats.find((x) => String(x.id) === pid)
    return c ? String(c.name).trim() : ''
  }
  if (Object.prototype.hasOwnProperty.call(body, 'product_category_name')) {
    return String(body.product_category_name ?? '').trim()
  }
  return null
}

/**
 * Admin UI sends a small PATCH-like object. Zoho Books (especially India) often still expects
 * `unit`, `hsn_or_sac`, account links, etc. List APIs may omit `unit`, so the dashboard cannot echo it back.
 * Merge from GET /items/:id when those fields are missing or blank.
 * @param {Record<string, unknown>} cleanBody
 * @param {object | null} existingItem
 */
function mergeAdminItemUpdateWithZohoExisting(cleanBody, existingItem) {
  const out = { ...cleanBody }
  for (const k of Object.keys(out)) {
    if (out[k] === '') delete out[k]
  }
  if (!existingItem || typeof existingItem !== 'object') {
    if (out.unit == null || String(out.unit).trim() === '') out.unit = 'unit'
    return out
  }
  const ex = existingItem
  const requestedName = out.name != null ? String(out.name).trim() : ''
  if (requestedName) {
    out.name = requestedName
  } else if (ex.name != null && String(ex.name).trim() !== '') {
    out.name = ex.name
  } else {
    delete out.name
  }
  const fillIfMissing = (key) => {
    const cur = out[key]
    if (cur != null && String(cur).trim() !== '') return
    const v = ex[key]
    if (v != null && String(v).trim() !== '') out[key] = v
  }
  fillIfMissing('unit')
  fillIfMissing('hsn_or_sac')
  fillIfMissing('product_type')
  fillIfMissing('account_id')
  fillIfMissing('inventory_account_id')
  fillIfMissing('purchase_account_id')
  if (out.unit == null || String(out.unit).trim() === '') out.unit = 'unit'
  return out
}

/** Zoho refuses hard-delete when an item is referenced on transactions; we fall back to inactive. */
function shouldFallbackItemDeleteToInactive(zohoBody) {
  if (!zohoBody || typeof zohoBody !== 'object') return false
  const msg = String(zohoBody.message || zohoBody.error || '').toLowerCase()
  if (!msg) return false
  return (
    msg.includes('cannot be deleted') ||
    msg.includes('part of a transaction') ||
    msg.includes('part of transaction') ||
    (msg.includes('transaction') && msg.includes('delete')) ||
    (msg.includes('associated') && msg.includes('transaction'))
  )
}

/**
 * Build `locations[]` for a PUT so primary (or first) row gets `targetQty` on hand.
 * Used together with other item fields in **one** PUT — a second PUT with only `locations`
 * can overwrite name/rate on APIs that treat the body as a full replace.
 */
function buildZohoItemLocationsForStock(existingItem, targetQty) {
  const locs = existingItem?.locations
  if (!Array.isArray(locs) || locs.length === 0) return null
  const primaryIdx = locs.findIndex((l) => l && (l.is_primary === true || l.is_primary === 'true'))
  const idx = primaryIdx >= 0 ? primaryIdx : 0
  return locs.map((loc, j) => {
    if (!loc || typeof loc !== 'object') return { location_id: String(loc.location_id) }
    const base = {
      location_id: String(loc.location_id),
      ...(loc.location_name != null && loc.location_name !== '' ? { location_name: loc.location_name } : {}),
      ...(loc.status != null && loc.status !== '' ? { status: loc.status } : {}),
      ...(loc.is_primary != null ? { is_primary: loc.is_primary } : {})
    }
    if (j === idx) {
      return { ...base, location_stock_on_hand: String(targetQty) }
    }
    const keep = loc.location_stock_on_hand
    return keep != null && keep !== '' ? { ...base, location_stock_on_hand: String(keep) } : base
  })
}

/**
 * Zoho often ignores plain `stock_on_hand` on item PUT when warehousing/locations are used.
 * Prefer inventory adjustment (needs ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID); else merge locations into the same item PUT as `cleanBody`.
 */
async function applyZohoItemStockAndMetadata(id, existingItem, targetQty, cleanBody) {
  const accountId = env.ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID
  const current = readZohoItemQuantity(existingItem)

  if (accountId && current !== null) {
    const data = await updateModule('/items', id, cleanBody)
    const delta = targetQty - current
    if (delta !== 0) {
      const today = new Date().toISOString().slice(0, 10)
      await createModule('/inventoryadjustments', {
        date: today,
        reason: `Admin — stock update (item ${id})`,
        adjustment_type: 'quantity',
        line_items: [
          {
            item_id: String(id),
            quantity_adjusted: String(delta),
            adjustment_account_id: accountId
          }
        ]
      })
    }
    return data
  }

  const newLocs = buildZohoItemLocationsForStock(existingItem, targetQty)
  if (newLocs) {
    return updateModule('/items', id, { ...cleanBody, locations: newLocs })
  }

  return updateModule('/items', id, { ...cleanBody, stock_on_hand: targetQty })
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

const createCustomerBody = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  mobile: z.string().optional()
})

const updateCustomerBody = z.object({
  fullName: z.string().trim().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  mobile: z.string().optional()
})

const updateZohoCustomerByIdBody = z.object({
  fullName: z.string().trim().min(2).optional(),
  email: z.string().email().optional(),
  mobile: z.string().optional(),
  password: z.string().min(6).optional(),
  currentEmail: z.string().email().optional()
})

const createDriverBody = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().email(),
  password: z.string().min(6)
})

const updateDriverBody = z
  .object({
    fullName: z.string().trim().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional()
  })
  .refine((b) => Boolean(b.fullName || b.email || b.password), {
    message: 'Provide at least one of: fullName, email, password'
  })

const assignInvoiceBody = z.object({
  driver_email: z.string().email(),
  invoice_id: z.string().min(1)
})

const emailParam = z.object({
  email: z.string().email()
})

const salesOrderLineSchema = z.object({
  item_id: z.string().min(1),
  quantity: z.number().positive(),
  rate: z.number().nonnegative()
})

const createSalesOrderBody = z.object({
  customer_id: z.string().min(1),
  salesorder_number: z.string().optional(),
  reference_number: z.string().optional(),
  line_items: z.array(salesOrderLineSchema).min(1)
})

const simpleItemCreateSchema = z.object({
  name: z.string().min(1),
  rate: z.coerce.number().nonnegative(),
  sku: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
  product_type: z.enum(['goods', 'service', 'digital_service']).default('goods'),
  /** Zoho Books: sales | inventory | purchases — sales items can be added to invoices without stock. */
  item_type: z.enum(['sales', 'inventory', 'purchases']).optional()
})

adminRoutes.post('/login', (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body)
    const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase()
    if (input.email.trim().toLowerCase() !== adminEmail || input.password !== env.ADMIN_PASSWORD) {
      const err = new Error('Invalid admin email or password')
      err.statusCode = 401
      throw err
    }
    const token = signAdminToken()
    appendAdminAudit({ action: 'admin_login' })
    res.json({ message: 'Login successful', token })
  } catch (error) {
    next(error)
  }
})

adminRoutes.use(requireAdmin)

adminRoutes.get('/zoho-status', async (_req, res, next) => {
  try {
    const orgId = await getOrganizationId()
    // Dynamo reads mean the app is already serving from the mirror — skip a live Zoho list probe.
    if (isDynamoReadsEnabled()) {
      res.json({
        connected: true,
        organizationId: String(orgId || ''),
        message: 'Zoho Books connected',
        dynamodb: {
          configured: isDynamoConfigured(),
          writesEnabled: isDynamoWritesEnabled(),
          readsEnabled: isDynamoReadsEnabled(),
          tablePrefix: getDynamoTablePrefix() || null,
          region: env.AWS_REGION || null
        },
        source: 'dynamodb'
      })
      return
    }
    const probe = await listModule('/items', { per_page: 1, page: 1 })
    const ok = Number(probe?.code) === 0 || Array.isArray(probe?.items)
    res.json({
      connected: ok,
      organizationId: String(orgId || ''),
      message: ok ? 'Zoho Books connected' : 'Zoho Books returned an unexpected response',
      dynamodb: {
        configured: isDynamoConfigured(),
        writesEnabled: isDynamoWritesEnabled(),
        readsEnabled: isDynamoReadsEnabled(),
        tablePrefix: getDynamoTablePrefix() || null,
        region: env.AWS_REGION || null
      }
    })
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/dynamodb/status', (_req, res) => {
  res.json({
    configured: isDynamoConfigured(),
    writesEnabled: isDynamoWritesEnabled(),
    readsEnabled: isDynamoReadsEnabled(),
    tablePrefix: getDynamoTablePrefix() || null,
    region: env.AWS_REGION || null,
    syncCronEnabled: Boolean(env.DYNAMODB_SYNC_CRON_ENABLED),
    design: 'multi-table'
  })
})

adminRoutes.post('/dynamodb/sync', async (_req, res, next) => {
  try {
    const summary = await runZohoDynamoSyncNow('admin-api')
    appendAdminAudit({ action: 'admin_dynamodb_sync', meta: { skipped: summary.skipped || false } })
    res.json(summary)
  } catch (error) {
    next(error)
  }
})

let overviewCache = null
let overviewCacheAt = 0
const OVERVIEW_TTL_MS = 60_000

adminRoutes.get('/overview', async (_req, res, next) => {
  try {
    if (overviewCache && Date.now() - overviewCacheAt < OVERVIEW_TTL_MS) {
      res.json(overviewCache)
      return
    }
    // Avoid full-table invoice/SO scans (10k+ rows). Sample when Dynamo reads are on.
    let invoices = []
    let salesorders = []
    if (isDynamoReadsEnabled()) {
      const { scanLimited } = await import('../services/dynamo/dynamoRepository.js')
      const { tableNameForEntityType } = await import('../services/dynamo/dynamoClient.js')
      const [invItems, soItems] = await Promise.all([
        scanLimited(tableNameForEntityType('invoice'), 100),
        scanLimited(tableNameForEntityType('salesorder'), 100)
      ])
      invoices = invItems.map((i) => i.payload).filter(Boolean)
      salesorders = soItems.map((i) => i.payload).filter(Boolean)
    } else {
      const [invData, soData] = await Promise.all([
        listModule('/invoices', { per_page: 100 }),
        listModule('/salesorders', { per_page: 100 })
      ])
      invoices = Array.isArray(invData.invoices) ? invData.invoices : []
      salesorders = Array.isArray(soData.salesorders) ? soData.salesorders : []
    }
    const revenue = invoices.reduce((s, inv) => s + (Number(inv.total) || 0), 0)
    const payload = {
      invoiceCount: invoices.length,
      salesOrderCount: salesorders.length,
      appCustomerCount: await countCustomerAppLoginsInZoho(),
      revenueApprox: revenue,
      currency: env.ZOHO_DEFAULT_CURRENCY_CODE,
      zohoItemCustomerDisplayFieldConfigured: getZohoItemCustomerDisplayFieldId() !== ''
    }
    overviewCache = payload
    overviewCacheAt = Date.now()
    res.json(payload)
  } catch (error) {
    next(error)
  }
})

/** Whether backend `.env` maps customer-facing item names to a Zoho Books item custom field (no Zoho I/O). */
adminRoutes.get('/item-customer-name-field', (_req, res) => {
  res.json({ configured: getZohoItemCustomerDisplayFieldId() !== '' })
})

/** Whether backend `.env` maps min purchase count to a Zoho Books item custom field (no Zoho I/O). */
adminRoutes.get('/item-min-purchase-field', (_req, res) => {
  res.json({ configured: getZohoItemMinPurchaseFieldId() !== '' })
})

adminRoutes.get('/product-categories', async (_req, res, next) => {
  try {
    const envStatus = getProductCategoryEnvStatus()
    if (!isProductCategoryConfigured()) {
      res.json({ configured: false, envStatus, categories: [] })
      return
    }
    const categories = await listProductCategories()
    res.json({ configured: true, envStatus, categories })
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/product-categories', async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.body)
    invalidateProductCategoryCache()
    invalidateItemCategoryIndex()
    const list = await listProductCategories()
    const id = newProductCategoryId()
    await saveProductCategoriesFull([...list, { id, name: name.trim() }])
    appendAdminAudit({ action: 'admin_create_product_category', meta: { id } })
    res.status(201).json({ category: { id, name: name.trim() } })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/product-categories/:categoryId', async (req, res, next) => {
  try {
    const categoryId = z.string().min(1).parse(req.params.categoryId)
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.body)
    invalidateProductCategoryCache()
    invalidateItemCategoryIndex()
    const list = await listProductCategories()
    const idx = list.findIndex((c) => c.id === categoryId)
    if (idx < 0) {
      const err = new Error('Category not found')
      err.statusCode = 404
      throw err
    }
    const nextList = [...list]
    nextList[idx] = { ...nextList[idx], name: name.trim() }
    await saveProductCategoriesFull(nextList)
    appendAdminAudit({ action: 'admin_update_product_category', meta: { id: categoryId } })
    res.json({ category: nextList[idx] })
  } catch (error) {
    next(error)
  }
})

adminRoutes.delete('/product-categories/:categoryId', async (req, res, next) => {
  try {
    const categoryId = z.string().min(1).parse(req.params.categoryId)
    invalidateProductCategoryCache()
    invalidateItemCategoryIndex()
    const list = await listProductCategories()
    const nextList = list.filter((c) => c.id !== categoryId)
    if (nextList.length === list.length) {
      const err = new Error('Category not found')
      err.statusCode = 404
      throw err
    }
    await saveProductCategoriesFull(nextList)
    appendAdminAudit({ action: 'admin_delete_product_category', meta: { id: categoryId } })
    res.json({ message: 'Category removed from catalog', id: categoryId })
  } catch (error) {
    next(error)
  }
})

const customersListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(8),
  search: z
    .union([z.string(), z.undefined()])
    .optional()
    .transform((s) => (typeof s === 'string' ? s.trim().slice(0, 100) : '') || undefined),
  /** Filter by assigned pricing tier: omit = all, `__none__` = no tier, else tier id. */
  pricing_category_id: z
    .union([z.string(), z.undefined()])
    .optional()
    .transform((s) => {
      const t = typeof s === 'string' ? s.trim().slice(0, 120) : ''
      return t || undefined
    }),
  /** `newest` asks Zoho for contacts sorted by `created_time` (newest first), then re-sorts the enriched page by `created_time`. */
  sort: z.enum(['asc', 'desc', 'newest']).default('asc')
})

const invoicesListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(8),
  sort: z.enum(['asc', 'desc']).default('desc')
})

adminRoutes.get('/customers', async (req, res, next) => {
  try {
    const q = customersListQuery.parse(req.query)
    const tierFilter = q.pricing_category_id

    const listParams =
      q.sort === 'newest'
        ? {
            contact_type: 'customer',
            page: q.page,
            per_page: q.per_page,
            sort_column: 'created_time',
            sort_order: 'D'
          }
        : {
            contact_type: 'customer',
            page: q.page,
            per_page: q.per_page,
            sort_column: 'contact_name',
            sort_order: q.sort === 'desc' ? 'D' : 'A'
          }
    if (q.search) {
      listParams.search_text = q.search
    }

    const data = await listModule('/contacts', listParams)
    const rows = Array.isArray(data?.contacts) ? data.contacts : []

    // With Dynamo reads, mirrored contact payloads are already available from the list scan.
    // Per-row Zoho/Dynamo detail GETs made this endpoint ~7–15s for 8 customers.
    let details
    if (isDynamoReadsEnabled()) {
      details = rows
    } else {
      details = await Promise.all(
        rows.map(async (row) => {
          const id = row?.contact_id
          if (!id) return null
          const d = await getModuleById('/contacts', String(id))
          return d?.contact || d
        })
      )
    }

    let tiersPreload = []
    try {
      if (isCustomerPricingConfigured()) tiersPreload = await listPricingTiers()
    } catch {
      tiersPreload = []
    }

    const customers = []
    for (const full of details) {
      if (!full?.contact_id) continue
      const notes = full.notes
      if (hasDriverAppLoginNotes(notes)) continue
      const hasCust = hasCustomerAppLoginNotes(notes) && !hasDriverAppLoginNotes(notes)
      const safe = redactNotesForAdmin({ ...full })
      const tierFields = resolvePricingTierDisplay(full, tiersPreload)
      const assignedTierId =
        tierFields.pricing_tier_id != null && String(tierFields.pricing_tier_id).trim()
          ? String(tierFields.pricing_tier_id).trim()
          : ''
      if (tierFilter === '__none__' && assignedTierId) continue
      if (tierFilter && tierFilter !== '__none__' && assignedTierId !== tierFilter) continue
      customers.push({
        ...safe,
        has_app_login: Boolean(hasCust),
        disabled: full.is_active === false || full.is_active === 'false',
        ...tierFields
      })
    }

    if (q.sort === 'newest') {
      customers.sort((a, b) => {
        const tb = Date.parse(String(b.created_time || '')) || 0
        const ta = Date.parse(String(a.created_time || '')) || 0
        return tb - ta
      })
    }

    const ctx = data?.page_context || {}
    res.json({
      customers,
      page: q.page,
      per_page: q.per_page,
      total: Number(ctx.total) || customers.length,
      has_more_page: Boolean(ctx.has_more_page)
    })
  } catch (error) {
    next(error)
  }
})

const pricingTierCreateBody = z
  .object({
    id: z.string().min(1).max(80).optional(),
    name: z.string().min(1).max(200),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmountInr: z.number().min(0).optional()
  })
  .refine(
    (b) =>
      (b.discountPercent != null && b.discountPercent > 0) ||
      (b.discountAmountInr != null && b.discountAmountInr > 0),
    { message: 'Provide at least one of discountPercent or discountAmountInr greater than 0' }
  )

const pricingTierPatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmountInr: z.number().min(0).optional()
  })
  .refine((b) => b.name != null || b.discountPercent !== undefined || b.discountAmountInr !== undefined, {
    message: 'Provide at least one field to update'
  })

adminRoutes.get('/customer-pricing-categories', async (_req, res, next) => {
  try {
    const configured = isCustomerPricingConfigured()
    if (!configured) {
      res.json({ configured: false, tiers: [] })
      return
    }
    try {
      const tiers = await listPricingTiers()
      res.json({ configured: true, tiers })
    } catch (error) {
      res.json({
        configured: true,
        tiers: [],
        loadError: error instanceof Error ? error.message : 'Failed to load pricing tiers from Zoho'
      })
    }
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/customer-pricing-categories/catalog', async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : req.body?.tiers
    const tiers = pricingTiersArraySchema.min(1).parse(raw)
    const saved = await savePricingTiers(tiers)
    appendAdminAudit({ action: 'admin_pricing_tier_catalog_replace', meta: { count: saved.length } })
    res.json({ tiers: saved })
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/customer-pricing-categories', async (req, res, next) => {
  try {
    const body = pricingTierCreateBody.parse(req.body)
    const tiers = await addPricingTier(body)
    appendAdminAudit({ action: 'admin_pricing_tier_create', meta: { name: body.name } })
    res.status(201).json({ tiers })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/customer-pricing-categories/:tierId', async (req, res, next) => {
  try {
    const tierId = z.string().min(1).parse(req.params.tierId)
    const body = pricingTierPatchBody.parse(req.body)
    const tiers = await updatePricingTier(tierId, body)
    appendAdminAudit({ action: 'admin_pricing_tier_update', meta: { tierId } })
    res.json({ tiers })
  } catch (error) {
    next(error)
  }
})

adminRoutes.delete('/customer-pricing-categories/:tierId', async (req, res, next) => {
  try {
    const tierId = z.string().min(1).parse(req.params.tierId)
    const tiers = await deletePricingTier(tierId)
    appendAdminAudit({ action: 'admin_pricing_tier_delete', meta: { tierId } })
    res.json({ tiers })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/customers/contact/:contactId/pricing-category', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const body = z
      .object({ tierId: z.union([z.string().max(80), z.null()]).optional() })
      .parse(req.body ?? {})
    const raw = body.tierId
    const tierVal = raw === null || raw === undefined || raw === '' ? null : String(raw).trim()
    await setCustomerPricingTier(contactId, tierVal)
    appendAdminAudit({ action: 'admin_pricing_tier_assign', meta: { contactId, tierId: tierVal } })
    const fresh = await getModuleById('/contacts', contactId)
    res.json({ message: 'Pricing category updated', contact: fresh?.contact || fresh })
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/customers', async (req, res, next) => {
  let contactId
  let zohoCreatedThisRequest = false
  try {
    const input = createCustomerBody.parse(req.body)
    const priorZoho = await findCustomerByEmail(input.email)
    zohoCreatedThisRequest = !priorZoho?.contact_id
    const contact = await ensureCustomerContact({
      fullName: input.fullName,
      email: input.email,
      mobile: input.mobile
    })
    contactId = contact?.contact_id
    if (!contactId) {
      const err = new Error('Zoho did not return a customer contact id')
      err.statusCode = 502
      throw err
    }
    try {
      const user = await createCustomerUser({
        email: input.email,
        password: input.password,
        contactId
      })
      appendAdminAudit({
        action: 'admin_create_customer',
        meta: { email: user.email, zohoContactId: contactId, zohoExisted: !zohoCreatedThisRequest }
      })
      res.status(201).json({
        message: 'Customer created',
        user,
        zoho_contact_id: contactId,
        zoho_contact_created: zohoCreatedThisRequest
      })
    } catch (error) {
      if (zohoCreatedThisRequest) {
        try {
          await deleteOrDeactivateZohoContact(contactId)
        } catch {
          /* best-effort rollback */
        }
      }
      throw error
    }
  } catch (error) {
    next(error)
  }
})

async function deleteOrDeactivateZohoContact(contactId) {
  try {
    await deleteModule('/contacts', contactId)
    return { mode: 'deleted' }
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || 'delete failed'
    try {
      await updateModule('/contacts', contactId, { contact_id: contactId, is_active: false })
      return { mode: 'deactivated', zohoMessage: String(msg) }
    } catch (err2) {
      const err3 = new Error(`Could not delete or deactivate Zoho contact: ${msg}`)
      err3.statusCode = 502
      err3.cause = err2
      throw err3
    }
  }
}

async function findCustomerContactIdByEmail(email) {
  const data = await listModule('/contacts', { email: email.trim().toLowerCase(), per_page: 20 })
  const list = Array.isArray(data.contacts) ? data.contacts : []
  const em = email.trim().toLowerCase()
  const match = list.find(
    (c) =>
      (c.email || '').trim().toLowerCase() === em &&
      String(c.contact_type || '').toLowerCase() === 'customer' &&
      !parseDriverPasswordHashFromNotes(c.notes)
  )
  return match?.contact_id || null
}

adminRoutes.delete('/customers/:email', async (req, res, next) => {
  try {
    const { email } = emailParam.parse({ email: decodeURIComponent(req.params.email) })
    const contactId = await findCustomerContactIdByEmail(email)
    let zohoResult = { mode: 'skipped', reason: 'No Zoho contact for this email' }
    if (contactId) {
      zohoResult = await deleteOrDeactivateZohoContact(contactId)
    }
    appendAdminAudit({
      action: 'admin_delete_customer',
      meta: { email, zohoResult }
    })
    res.json({
      message: contactId ? `Customer removed from Zoho (${zohoResult.mode})` : 'No Zoho contact for this email',
      zoho: zohoResult
    })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/customers/:email', async (req, res, next) => {
  try {
    const { email } = emailParam.parse({ email: decodeURIComponent(req.params.email) })
    const body = updateCustomerBody.parse(req.body)

    const user = await updateCustomerUserByEmail(email, {
      fullName: body.fullName,
      email: body.email,
      password: body.password,
      mobile: body.mobile
    })
    if (!user) {
      const err = new Error('Customer not found')
      err.statusCode = 404
      throw err
    }

    appendAdminAudit({
      action: 'admin_update_customer',
      meta: { email, nextEmail: user.email, zohoUpdated: true }
    })
    res.json({ message: 'Customer updated', user, zohoUpdated: true })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/customers/contact/:contactId', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const body = updateZohoCustomerByIdBody.parse(req.body)

    const lookupEmail = body.currentEmail || body.email
    let user = null
    let loginAction = 'none'
    if (lookupEmail) {
      user = await updateCustomerUserByEmail(lookupEmail, {
        fullName: body.fullName,
        email: body.email,
        password: body.password,
        mobile: body.mobile
      })
      if (user) loginAction = 'updated'
      else if (body.password && body.email && body.fullName) {
        user = await createCustomerUser({
          email: body.email,
          password: body.password,
          contactId
        })
        loginAction = 'created'
      }
    }

    appendAdminAudit({
      action: 'admin_update_customer_contact',
      meta: { contactId, email: body.email, loginAction }
    })
    res.json({ message: 'Customer updated', zohoUpdated: true, loginAction, user })
  } catch (error) {
    next(error)
  }
})

adminRoutes.patch('/customers/contact/:contactId', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const body = z.object({ disabled: z.boolean() }).parse(req.body)
    const ok = await setCustomerContactDisabled(contactId, body.disabled)
    if (!ok) {
      const err = new Error('Customer not found or not a customer contact')
      err.statusCode = 404
      throw err
    }
    appendAdminAudit({
      action: 'admin_patch_customer_contact',
      meta: { contactId, disabled: body.disabled }
    })
    res.json({ message: body.disabled ? 'Customer deactivated' : 'Customer activated' })
  } catch (error) {
    next(error)
  }
})

adminRoutes.delete('/customers/contact/:contactId', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const data = await getModuleById('/contacts', contactId)
    const c = data.contact || data
    if (!c?.contact_id) {
      const err = new Error('Contact not found')
      err.statusCode = 404
      throw err
    }
    if (String(c.contact_type || '').toLowerCase() !== 'customer') {
      const err = new Error('Not a customer contact')
      err.statusCode = 400
      throw err
    }
    if (parseDriverPasswordHashFromNotes(c.notes)) {
      const err = new Error('This contact is a delivery driver — remove them from Deliverers instead')
      err.statusCode = 400
      throw err
    }
    const zohoResult = await deleteOrDeactivateZohoContact(contactId)
    appendAdminAudit({
      action: 'admin_delete_customer',
      meta: { contactId, zohoResult }
    })
    res.json({
      message: `Customer removed from Zoho (${zohoResult.mode})`,
      zoho: zohoResult
    })
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/drivers', async (_req, res, next) => {
  try {
    res.json({ drivers: await listDrivers() })
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/invoices', async (req, res, next) => {
  try {
    const q = invoicesListQuery.parse(req.query)
    const data = await listModule('/invoices', {
      page: q.page,
      per_page: q.per_page,
      sort_column: 'date',
      sort_order: q.sort === 'asc' ? 'A' : 'D'
    })
    const paymentMap = paymentsByInvoiceIdMap()
    const rows = Array.isArray(data?.invoices) ? data.invoices : []
    const invoices = rows.map((inv) => {
      const payment = paymentMap.get(String(inv.invoice_id || '')) || null
      if (!payment) return inv
      return {
        ...inv,
        app_payment: {
          method: payment.method,
          status: payment.status,
          razorpayPaymentId: payment.razorpayPaymentId,
          paidAt: payment.paidAt,
          label: payment.status === 'paid' ? 'Paid online' : payment.status === 'pending' ? 'Pending' : 'Online'
        }
      }
    })
    const ctx = data?.page_context || {}
    res.json({
      ...data,
      invoices,
      page: q.page,
      per_page: q.per_page,
      total: Number(ctx.total) || invoices.length,
      has_more_page: Boolean(ctx.has_more_page)
    })
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/delivery-assignments', async (_req, res, next) => {
  try {
    res.json({ assignments: await listAssignmentsMerged() })
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/payments', async (_req, res, next) => {
  try {
    const payments = (await listPaymentRecordsMerged()).sort((a, b) =>
      String(b.createdAt || b.paidAt || '').localeCompare(String(a.createdAt || a.paidAt || ''))
    )
    res.json({ payments })
  } catch (error) {
    next(error)
  }
})

async function loadAssignmentForProof(id) {
  const { getAssignmentForProofDownload } = await import('../services/deliveryProofHttp.js')
  const row = getAssignmentForProofDownload(id)
  if (!row) {
    const err = new Error('Assignment not found')
    err.statusCode = 404
    throw err
  }
  return row
}

adminRoutes.get('/delivery-assignments/:id/proof', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = await loadAssignmentForProof(id)
    const { resolveProofPhotoResponse } = await import('../services/deliveryProofHttp.js')
    const photo = await resolveProofPhotoResponse(row)
    if (!photo) {
      const err = new Error('Proof photo not found')
      err.statusCode = 404
      throw err
    }
    res.setHeader('Content-Type', photo.contentType)
    res.setHeader('Content-Disposition', `inline; filename="${photo.fileName}"`)
    res.send(photo.data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/delivery-assignments/:id/proof/photo', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = await loadAssignmentForProof(id)
    const { resolveProofPhotoResponse } = await import('../services/deliveryProofHttp.js')
    const photo = await resolveProofPhotoResponse(row)
    if (!photo) {
      const err = new Error('Proof photo not found')
      err.statusCode = 404
      throw err
    }
    res.setHeader('Content-Type', photo.contentType)
    res.setHeader('Content-Disposition', `inline; filename="${photo.fileName}"`)
    res.send(photo.data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/delivery-assignments/:id/proof/signature', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = await loadAssignmentForProof(id)
    if (!row?.proof) {
      const err = new Error('Proof not found for this assignment')
      err.statusCode = 404
      throw err
    }
    const { resolveProofSignatureResponse } = await import('../services/deliveryProofHttp.js')
    const sig = await resolveProofSignatureResponse(row)
    if (!sig) {
      const err = new Error('Signature not found for this assignment')
      err.statusCode = 404
      throw err
    }
    res.setHeader('Content-Type', sig.contentType)
    res.setHeader('Content-Disposition', `inline; filename="${sig.fileName}"`)
    res.send(sig.data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/delivery-assignments/:id/proof/summary', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = await loadAssignmentForProof(id)
    const { buildProofSummary, resolveProofPhotoResponse } = await import('../services/deliveryProofHttp.js')
    const summary = buildProofSummary(row)
    if (summary) {
      res.json({ summary })
      return
    }
    const photo = await resolveProofPhotoResponse(row)
    if (photo) {
      res.json({
        summary: {
          assignmentId: row.id,
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          recipientName: row.proof?.recipientName || '',
          uploadedAt: row.proof?.uploadedAt || row.deliveredAt || null,
          deliveredAt: row.deliveredAt || null,
          fileName: photo.fileName || row.proof?.fileName || 'proof.jpg',
          hasPhoto: true,
          hasSignature: Boolean(row.proof?.signatureDocumentId),
          storedInZoho: true,
          notes: row.proof?.notes || ''
        }
      })
      return
    }
    const err = new Error('Proof not found for this assignment')
    err.statusCode = 404
    throw err
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/delivery-assignments', async (req, res, next) => {
  try {
    const input = assignInvoiceBody.parse(req.body)
    const driver = await getDriverByEmail(input.driver_email)
    if (!driver) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    const invoiceData = await getModuleById('/invoices', input.invoice_id)
    const invoice = invoiceData.invoice || invoiceData
    const assignment = createAssignment({
      driverEmail: driver.email,
      driverName: driver.fullName,
      invoiceId: String(invoice.invoice_id || input.invoice_id),
      invoiceNumber: String(invoice.invoice_number || invoice.reference_number || input.invoice_id),
      customerName: String(invoice.customer_name || ''),
      customerEmail: String(invoice.customer_email || ''),
      amount: Number(invoice.total) || 0,
      address: String(invoice.billing_address?.address || invoice.shipping_address?.address || '')
    })
    clearDriverAssignmentZohoCache(driver.email)
    await mirrorAssignmentNow(assignment)
    try {
      await upsertInvoiceAssignmentNote(assignment.invoiceId, assignment)
    } catch {
      /* assignment still valid in app store; Zoho note is best-effort sync */
    }
    try {
      notifyDriverAssignment({
        driverEmail: driver.email,
        assignmentId: assignment.id,
        invoiceId: assignment.invoiceId,
        invoiceNumber: assignment.invoiceNumber,
        customerName: assignment.customerName,
        address: assignment.address
      })
      if (assignment.customerEmail) {
        notifyCustomerDriverAssigned({
          customerEmail: assignment.customerEmail,
          invoiceId: assignment.invoiceId,
          invoiceNumber: assignment.invoiceNumber,
          driverName: driver.fullName
        })
      }
    } catch {
      /* non-fatal */
    }
    appendAdminAudit({ action: 'admin_assign_invoice', meta: { driver: driver.email, invoice: input.invoice_id } })
    res.status(201).json({ message: 'Invoice assigned to driver', assignment })
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/drivers', async (req, res, next) => {
  let contactId
  let zohoCreatedThisRequest = false
  try {
    const input = createDriverBody.parse(req.body)
    const { contact, createdNew } = await ensureDriverContact({
      fullName: input.fullName,
      email: input.email,
      contactType: env.DRIVER_ZOHO_CONTACT_TYPE
    })
    contactId = contact.contact_id
    zohoCreatedThisRequest = createdNew
    try {
      const driver = await createDriverRecord({
        email: input.email,
        password: input.password,
        zohoContactId: contactId
      })
      appendAdminAudit({
        action: 'admin_create_driver',
        meta: { email: driver.email, zohoContactId: contactId, zohoExisted: !zohoCreatedThisRequest }
      })
      res.status(201).json({
        message: 'Driver created',
        driver,
        zoho_contact_id: contactId,
        zoho_contact_created: zohoCreatedThisRequest
      })
    } catch (error) {
      if (zohoCreatedThisRequest && contactId) {
        try {
          await deleteOrDeactivateZohoContact(contactId)
        } catch {
          /* best-effort rollback */
        }
      }
      throw error
    }
  } catch (error) {
    next(error)
  }
})

adminRoutes.patch('/drivers/zoho/:contactId', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const body = z.object({ disabled: z.boolean() }).parse(req.body)
    const ok = await setDriverDisabledByContactId(contactId, body.disabled)
    if (!ok) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    appendAdminAudit({
      action: 'admin_patch_driver',
      meta: { zohoContactId: contactId, disabled: body.disabled }
    })
    res.json({ message: 'Driver updated' })
  } catch (error) {
    next(error)
  }
})

adminRoutes.patch('/drivers/:email', async (req, res, next) => {
  try {
    const { email } = emailParam.parse({ email: decodeURIComponent(req.params.email) })
    const body = z.object({ disabled: z.boolean() }).parse(req.body)
    const ok = await setDriverDisabled(email, body.disabled)
    if (!ok) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    appendAdminAudit({ action: 'admin_patch_driver', meta: { email, disabled: body.disabled } })
    res.json({ message: 'Driver updated' })
  } catch (error) {
    next(error)
  }
})

/** Prefer this path: contact ids avoid `@` / encoding issues in URLs and intermediaries. */
adminRoutes.put('/drivers/zoho/:contactId', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const currentEmail = await getDriverEmailByZohoContactId(contactId)
    if (!currentEmail) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    const body = updateDriverBody.parse(req.body)
    const driver = await updateDriverRecord(currentEmail, {
      fullName: body.fullName,
      email: body.email,
      password: body.password
    })
    if (!driver) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    appendAdminAudit({
      action: 'admin_update_driver',
      meta: { zohoContactId: contactId, email: currentEmail, nextEmail: driver.email }
    })
    res.json({ message: 'Driver updated', driver })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/drivers/:email', async (req, res, next) => {
  try {
    const { email } = emailParam.parse({ email: decodeURIComponent(req.params.email) })
    const body = updateDriverBody.parse(req.body)
    const driver = await updateDriverRecord(email, {
      fullName: body.fullName,
      email: body.email,
      password: body.password
    })
    if (!driver) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    appendAdminAudit({ action: 'admin_update_driver', meta: { email, nextEmail: driver.email } })
    res.json({ message: 'Driver updated', driver })
  } catch (error) {
    next(error)
  }
})

adminRoutes.delete('/drivers/zoho/:contactId', async (req, res, next) => {
  try {
    const contactId = z.string().min(1).parse(req.params.contactId)
    const email = await getDriverEmailByZohoContactId(contactId)
    if (!email) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    const credRemoved = await deleteDriverRecordByContactId(contactId)
    if (!credRemoved) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    let zohoResult
    try {
      zohoResult = await deleteOrDeactivateZohoContact(contactId)
    } catch (e) {
      zohoResult = { mode: 'credentials_removed', message: String(e?.message || e) }
    }
    appendAdminAudit({
      action: 'admin_delete_driver',
      meta: { email, zohoContactId: contactId, zohoResult }
    })
    const msg =
      zohoResult.mode === 'deleted'
        ? 'Driver removed from Zoho'
        : zohoResult.mode === 'deactivated'
          ? 'Driver app login removed; Zoho contact deactivated (linked to transactions)'
          : 'Driver app login removed'
    res.json({ message: msg, zoho: zohoResult })
  } catch (error) {
    next(error)
  }
})

adminRoutes.delete('/drivers/:email', async (req, res, next) => {
  try {
    const { email } = emailParam.parse({ email: decodeURIComponent(req.params.email) })
    const driver = await getDriverByEmail(email)
    if (!driver) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    const credRemoved = await deleteDriverRecordByContactId(driver.zohoContactId)
    if (!credRemoved) {
      const err = new Error('Driver not found')
      err.statusCode = 404
      throw err
    }
    let zohoResult
    try {
      zohoResult = await deleteOrDeactivateZohoContact(driver.zohoContactId)
    } catch (e) {
      zohoResult = { mode: 'credentials_removed', message: String(e?.message || e) }
    }
    appendAdminAudit({
      action: 'admin_delete_driver',
      meta: { email, zohoContactId: driver.zohoContactId, zohoResult }
    })
    const msg =
      zohoResult.mode === 'deleted'
        ? 'Driver removed from Zoho'
        : zohoResult.mode === 'deactivated'
          ? 'Driver app login removed; Zoho contact deactivated (linked to transactions)'
          : 'Driver app login removed'
    res.json({ message: msg, zoho: zohoResult })
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/deliveries', async (req, res, next) => {
  try {
    const query = z.object({}).passthrough().parse(req.query)
    const data = await listModule('/salesorders', {
      per_page: 200,
      sort_column: 'date',
      sort_order: 'D',
      ...query
    })
    const orders = Array.isArray(data.salesorders) ? data.salesorders : []
    orders.sort((a, b) => (Date.parse(String(b?.date || '')) || 0) - (Date.parse(String(a?.date || '')) || 0))
    const stops = orders.map((order, index) => mapDeliveryStopFromSalesOrder(order, index))
    res.json({ deliveries: stops, salesorders: orders })
  } catch (error) {
    next(error)
  }
})

/** Zoho Books customers (contacts) — for sales order create + delivery address in Zoho */
adminRoutes.get('/zoho/customer-contacts', async (req, res, next) => {
  try {
    const query = z.object({}).passthrough().parse(req.query)
    const data = await listModule('/contacts', { contact_type: 'customer', per_page: 200, ...query })
    res.json(data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/sales-orders', async (req, res, next) => {
  try {
    const query = z.object({}).passthrough().parse(req.query)
    const data = await listModule('/salesorders', { per_page: 200, ...query })
    res.json(data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/sales-orders/:id', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const query = z.object({}).passthrough().parse(req.query)
    const data = await getModuleById('/salesorders', id, query)
    res.json(data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/sales-orders', async (req, res, next) => {
  try {
    const input = createSalesOrderBody.parse(req.body)
    const data = await createSalesOrder({
      customer_id: input.customer_id,
      currency_code: env.ZOHO_DEFAULT_CURRENCY_CODE,
      ...(input.salesorder_number ? { salesorder_number: input.salesorder_number } : {}),
      ...(input.reference_number ? { reference_number: input.reference_number } : {}),
      line_items: input.line_items.map((l) => ({
        item_id: l.item_id,
        quantity: l.quantity,
        rate: l.rate
      }))
    })
    appendAdminAudit({
      action: 'admin_create_sales_order',
      meta: { customer_id: input.customer_id, reference_number: input.reference_number }
    })
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/sales-orders/:id', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const body = z.record(z.unknown()).parse(req.body)
    const data = await updateModule('/salesorders', id, body)
    appendAdminAudit({ action: 'admin_update_sales_order', meta: { id } })
    res.json(data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/items/catalog-missing-images', async (req, res, next) => {
  try {
    const q = z
      .object({
        search_text: z.string().optional(),
        max_pages: z.coerce.number().int().min(1).max(80).optional(),
        verify_image: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
        probe_concurrency: z.coerce.number().int().min(1).max(32).optional()
      })
      .parse(req.query)
    const verifyImage = q.verify_image === '1' || q.verify_image === 'true'
    const { missing, scanned } = await scanItemsMissingCatalogImage({
      maxPages: q.max_pages ?? 50,
      perPage: 200,
      searchText: q.search_text,
      verifyImage,
      probeConcurrency: q.probe_concurrency ?? 4
    })
    let rows = getZohoItemCustomerDisplayFieldId()
      ? missing.map((row) => withCustomerProductNameVirtual(row))
      : missing
    if (getZohoItemMinPurchaseFieldId()) {
      rows = rows.map((row) => withMinPurchaseCountVirtual(row))
    }
    if (isProductCategoryConfigured()) {
      try {
        const cats = await listProductCategories()
        rows = rows.map((row) => withItemProductCategoryVirtual(row, cats))
      } catch {
        /* ignore */
      }
    }
    res.json({
      items: rows,
      scanned_count: scanned,
      missing_count: missing.length,
      verify_image: verifyImage
    })
  } catch (error) {
    next(error)
  }
})

/** Full-catalog walk: resolve display category per item (detail GET when list omits `custom_fields`). */
adminRoutes.get('/items/catalog-product-categories', async (req, res, next) => {
  try {
    const q = z
      .object({
        search_text: z.string().optional(),
        max_pages: z.coerce.number().int().min(1).max(80).optional(),
        hydrate_concurrency: z.coerce.number().int().min(1).max(32).optional()
      })
      .parse(req.query)
    const summary = await scanAllItemsProductCategoryCoverage({
      maxPages: q.max_pages ?? 50,
      perPage: 200,
      searchText: q.search_text,
      hydrateConcurrency: q.hydrate_concurrency ?? 4
    })
    res.json(summary)
  } catch (error) {
    next(error)
  }
})

adminRoutes.get('/items', async (req, res, next) => {
  try {
    const query = z.object({}).passthrough().parse(req.query)
    let data = await listModule('/items', query)
    if (data?.items && Array.isArray(data.items)) {
      const needsHydration =
        getZohoItemCustomerDisplayFieldId() ||
        getZohoItemMinPurchaseFieldId() ||
        isProductCategoryConfigured()
      if (needsHydration) {
        const { items: hydrated } = await hydrateItemsListRowsForProductCategoryField(data.items, {
          concurrency: 4
        })
        data = { ...data, items: hydrated }
      }
    }
    if (getZohoItemCustomerDisplayFieldId() && data?.items && Array.isArray(data.items)) {
      data = { ...data, items: data.items.map((row) => withCustomerProductNameVirtual(row)) }
    }
    if (getZohoItemMinPurchaseFieldId() && data?.items && Array.isArray(data.items)) {
      data = { ...data, items: data.items.map((row) => withMinPurchaseCountVirtual(row)) }
    }
    if (isProductCategoryConfigured() && data?.items && Array.isArray(data.items)) {
      try {
        const cats = await listProductCategories()
        data = { ...data, items: data.items.map((row) => withItemProductCategoryVirtual(row, cats)) }
      } catch {
        /* ignore */
      }
    }
    res.json(data)
  } catch (error) {
    next(error)
  }
})

/** Full item for admin edit (list rows may omit `custom_fields`, breaking category / customer-name virtuals). */
adminRoutes.get('/items/:id', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const fresh = await getModuleById('/items', id)
    const rawItem = fresh?.item ?? fresh
    if (!rawItem || typeof rawItem !== 'object' || rawItem.item_id == null) {
      const err = new Error('Item not found')
      err.statusCode = 404
      throw err
    }
    let virt = rawItem
    if (getZohoItemCustomerDisplayFieldId()) {
      virt = withCustomerProductNameVirtual(rawItem)
    } else {
      virt = { ...rawItem }
    }
    if (getZohoItemMinPurchaseFieldId()) {
      virt = withMinPurchaseCountVirtual(virt)
    }
    if (isProductCategoryConfigured()) {
      try {
        const cats = await listProductCategories()
        virt = withItemProductCategoryVirtual(virt, cats)
      } catch {
        /* ignore */
      }
    }
    res.json({ item: virt })
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/items', async (req, res, next) => {
  try {
    const raw = req.body
    let payload
    if (raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name.trim() && 'rate' in raw) {
      const parsed = simpleItemCreateSchema.parse(raw)
      // Default to sales-type goods so newly created catalog items can be invoiced immediately
      // (inventory items often fail checkout until accounts/stock are configured).
      const itemType = parsed.item_type || 'inventory'
      // Zoho org may require SKU as a mandatory field — auto-generate when admin leaves it blank.
      const sku =
        parsed.sku?.trim() ||
        `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      payload = {
        name: parsed.name.trim(),
        rate: parsed.rate,
        product_type: parsed.product_type,
        // Prefer inventory (matches existing sellable catalog items). Plain "sales" items can
        // inherit an org-default GST that is expired and blocks invoice creation.
        item_type: itemType,
        unit: parsed.unit?.trim() || 'unit',
        sku,
        ...(parsed.description?.trim() ? { description: parsed.description.trim() } : {})
      }
    } else {
      payload = z.record(z.unknown()).parse(raw)
    }
    const data = await createModule('/items', payload)
    appendAdminAudit({ action: 'admin_create_item', meta: { item: data?.item?.item_id } })
    invalidateItemCategoryIndex()
    const newId = data?.item?.item_id != null ? String(data.item.item_id) : ''
    // New Zoho items inherit org-default GST12 preferences which are expired in this org and
    // block invoice creation. Align new items to zero-rate GST0/IGST0 used by sellable catalog items.
    if (newId) {
      try {
        await updateModule('/items', newId, {
          item_tax_preferences: [
            { tax_specification: 'intra', tax_id: '2179961000000028364' }, // GST0
            { tax_specification: 'inter', tax_id: '2179961000000028304' } // IGST0
          ]
        })
      } catch {
        /* non-fatal — checkout may still fail until taxes are fixed in Zoho */
      }
    }
    if (newId && raw && typeof raw === 'object') {
      try {
        const fresh = await getModuleById('/items', newId)
        let ex = fresh?.item ?? fresh
        if (ex && typeof ex === 'object') {
          let cfs = null
          const catName = await resolveProductCategoryNameFromAdminBody(raw)
          if (catName !== null && catName !== '' && getZohoItemCategoryFieldId()) {
            cfs = mergeProductCategoryNameIntoItemCustomFields(ex, catName)
            if (cfs) ex = { ...ex, custom_fields: cfs }
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'min_purchase_count') && getZohoItemMinPurchaseFieldId()) {
            cfs = mergeMinPurchaseIntoItemCustomFields(ex, raw.min_purchase_count)
            if (cfs) ex = { ...ex, custom_fields: cfs }
          }
          if (cfs) {
            const zohoBody = mergeAdminItemUpdateWithZohoExisting({ custom_fields: cfs }, ex)
            await updateModule('/items', newId, zohoBody)
            const again = await getModuleById('/items', newId)
            let virt = again?.item ?? again
            if (virt && getZohoItemCustomerDisplayFieldId()) virt = withCustomerProductNameVirtual(virt)
            if (virt && getZohoItemMinPurchaseFieldId()) virt = withMinPurchaseCountVirtual(virt)
            if (virt && isProductCategoryConfigured()) {
              try {
                const cats = await listProductCategories()
                virt = withItemProductCategoryVirtual(virt, cats)
              } catch {
                /* ignore */
              }
            }
            if (virt && again?.item) {
              res.status(201).json({ ...again, item: virt })
              return
            }
            if (virt) {
              res.status(201).json(virt)
              return
            }
            res.status(201).json(again)
            return
          }
        }
      } catch {
        /* fall through */
      }
    }
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
})

adminRoutes.post('/items/:id/image', handleItemImageUpload, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const f = req.file
    await uploadItemImageToZoho(id, {
      buffer: f.buffer,
      mimetype: f.mimetype,
      originalname: f.originalname || 'image.jpg'
    })
    appendAdminAudit({ action: 'admin_upload_item_image', meta: { id } })
    res.json({ message: 'Image uploaded', item_id: id })
  } catch (error) {
    next(error)
  }
})

adminRoutes.put('/items/:id', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const body = z.record(z.unknown()).parse(req.body)
    const targetStock = extractStockTargetFromBody(body)
    const cleanBody = omitNullishPayloadFields(stripStockFieldsFromBody(body))

    let existingItem = null
    try {
      const existing = await getModuleById('/items', id)
      existingItem = existing?.item ?? existing
    } catch {
      existingItem = null
    }

    if (Object.prototype.hasOwnProperty.call(body, 'customer_product_name')) {
      const fid = getZohoItemCustomerDisplayFieldId()
      if (fid && existingItem) {
        cleanBody.custom_fields = mergeCustomerProductNameIntoItemCustomFields(
          existingItem,
          String(body.customer_product_name ?? '').trim()
        )
      }
      delete cleanBody.customer_product_name
    }

    if (Object.prototype.hasOwnProperty.call(body, 'min_purchase_count')) {
      if (getZohoItemMinPurchaseFieldId() && existingItem) {
        const virtualItem = {
          ...existingItem,
          custom_fields: Array.isArray(cleanBody.custom_fields)
            ? cleanBody.custom_fields
            : existingItem.custom_fields
        }
        const mergedMin = mergeMinPurchaseIntoItemCustomFields(virtualItem, body.min_purchase_count)
        if (mergedMin) cleanBody.custom_fields = mergedMin
      }
      delete cleanBody.min_purchase_count
    }

    const catName = await resolveProductCategoryNameFromAdminBody(body)
    if (catName !== null && existingItem && getZohoItemCategoryFieldId()) {
      const virtualItem = {
        ...existingItem,
        custom_fields: Array.isArray(cleanBody.custom_fields) ? cleanBody.custom_fields : existingItem.custom_fields
      }
      const mergedCat = mergeProductCategoryNameIntoItemCustomFields(virtualItem, catName)
      if (mergedCat) cleanBody.custom_fields = mergedCat
    }
    delete cleanBody.product_category_id
    delete cleanBody.product_category_name

    const zohoBody = mergeAdminItemUpdateWithZohoExisting(cleanBody, existingItem)

    let data
    if (targetStock != null && existingItem) {
      data = await applyZohoItemStockAndMetadata(id, existingItem, targetStock, zohoBody)
    } else if (targetStock != null) {
      data = await updateModule('/items', id, { ...zohoBody, stock_on_hand: targetStock })
    } else {
      data = await updateModule('/items', id, zohoBody)
    }
    appendAdminAudit({ action: 'admin_update_item', meta: { id } })
    invalidateItemCategoryIndex()

    try {
      const fresh = await getModuleById('/items', id)
      const rawItem = fresh?.item ?? fresh
      let virt = rawItem
      if (rawItem && getZohoItemCustomerDisplayFieldId()) {
        virt = withCustomerProductNameVirtual(rawItem)
      } else if (rawItem) {
        virt = { ...rawItem }
      }
      if (virt && getZohoItemMinPurchaseFieldId()) {
        virt = withMinPurchaseCountVirtual(virt)
      }
      if (virt && isProductCategoryConfigured()) {
        try {
          const cats = await listProductCategories()
          virt = withItemProductCategoryVirtual(virt, cats)
        } catch {
          /* ignore */
        }
      }
      if (virt && fresh?.item) res.json({ ...fresh, item: virt })
      else if (virt) res.json(virt)
      else res.json(fresh)
    } catch {
      res.json(data)
    }
  } catch (error) {
    next(error)
  }
})

adminRoutes.delete('/items/:id', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    try {
      const data = await deleteModule('/items', id)
      appendAdminAudit({ action: 'admin_delete_item', meta: { id } })
      invalidateItemCategoryIndex()
      return res.json(data)
    } catch (err) {
      if (!axios.isAxiosError(err)) throw err
      const zohoBody = err.response?.data
      if (shouldFallbackItemDeleteToInactive(zohoBody)) {
        const data = await markZohoItemInactive(id)
        appendAdminAudit({ action: 'admin_deactivate_item', meta: { id, reason: 'zoho_refused_delete' } })
        invalidateItemCategoryIndex()
        const hint =
          typeof zohoBody?.message === 'string' && zohoBody.message.trim()
            ? `${zohoBody.message.trim()} It was marked inactive in Zoho instead.`
            : 'This item cannot be deleted while it is linked to transactions. It was marked inactive in Zoho instead.'
        return res.json({
          ...data,
          deactivated_instead_of_delete: true,
          message: hint
        })
      }
      throw err
    }
  } catch (error) {
    next(error)
  }
})
