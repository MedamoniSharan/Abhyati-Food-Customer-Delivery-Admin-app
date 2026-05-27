import { Router } from 'express'
import { z } from 'zod'
import { requireActiveCustomer, requireCustomer } from '../middleware/requireCustomer.js'
import { listAssignments } from '../services/deliveryAssignmentStore.js'
import {
  ensureCustomerContact,
  getInvoiceAttachment,
  getModuleById,
  listModule
} from '../services/zohoBooksService.js'
import {
  applyTierToItemsResponse,
  applyTierToSingleItemResponse,
  getActiveTierForCustomerEmail
} from '../services/customerPricingZohoService.js'
import {
  adjustInventoryForCheckout,
  createZohoOrderAndInvoice,
  resolveCheckoutLineItems,
  resolveCustomerContactForCheckout
} from '../services/orderCheckoutService.js'
import { compareOrderDateDesc, mapInvoiceToOrder } from '../services/orderMapping.js'
import {
  enrichCustomerItemsResponse,
  enrichCustomerSingleItemResponse,
  getItemCatalogCategoryForCustomerFilter,
  hydrateItemsListRowsForProductCategoryField,
  isProductCategoryConfigured,
  listProductCategories
} from '../services/productCategoryZohoService.js'

const lineItemSchema = z.object({
  item_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative()
})

const createOrderSchema = z.object({
  line_items: z.array(lineItemSchema).min(1),
  reference_number: z.string().optional()
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(200).optional(),
  /** When set (and not "All Items"), server filters items by display category name (custom field or Zoho native). */
  category_name: z.string().max(200).optional()
})

const idParamSchema = z.object({
  id: z.string().min(1)
})

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

/** Zoho list payloads sometimes omit `customer_email`; `customer_id` is reliable after checkout. */
function invoiceBelongsToAppCustomer(invoice, customerEmail, zohoCustomerId) {
  const email = normalizeEmail(customerEmail)
  const invEmail = normalizeEmail(invoice?.customer_email)
  if (invEmail && invEmail === email) return true
  const zid = String(zohoCustomerId || '').trim()
  if (zid && String(invoice?.customer_id || '').trim() === zid) return true
  return false
}

function normalizeCategoryNameQuery(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  if (s.toLowerCase() === 'all items') return ''
  return s
}

function itemMatchesCategoryNameFilter(item, filterRaw) {
  const want = String(filterRaw || '').trim().toLowerCase()
  if (!want) return true
  return getItemCatalogCategoryForCustomerFilter(item).toLowerCase() === want
}

const MAX_ZOHO_PAGES_FOR_CATEGORY = 40
const ZOHO_ITEMS_PAGE_FOR_FILTER = 200
/** Parallel Zoho list calls per round-trip (Zoho has no category filter on /items). */
const CATEGORY_ZOHO_FETCH_CONCURRENCY = 3
/** Detail GETs to fill `custom_fields` when Zoho list rows omit them (bounded per list page). */
const CATEGORY_HYDRATE_CONCURRENCY = 14

/**
 * List items for the customer app. Supports optional `category_name` (query) by scanning Zoho pages
 * until enough matching rows exist for the requested app page (Zoho does not filter by our custom field).
 */
async function listCustomerItemsForApp(query, customerEmail) {
  const pageNum = query.page && query.page > 0 ? query.page : 1
  const perPage = query.per_page && query.per_page > 0 ? Math.min(query.per_page, 200) : 20
  const categoryFilter = normalizeCategoryNameQuery(query.category_name)
  const tier = await getActiveTierForCustomerEmail(customerEmail)

  if (!categoryFilter) {
    const data = await listModule('/items', { page: pageNum, per_page: perPage })
    const batch = Array.isArray(data?.items) ? data.items : []
    const { items: hydratedList } = await hydrateItemsListRowsForProductCategoryField(batch, {
      concurrency: CATEGORY_HYDRATE_CONCURRENCY
    })
    let out = applyTierToItemsResponse({ ...data, items: hydratedList }, tier)
    if (isProductCategoryConfigured()) out = enrichCustomerItemsResponse(out)
    return out
  }

  const wantTotal = pageNum * perPage
  const accum = []
  let zohoPage = 1
  let lastHasMore = false
  while (accum.length < wantTotal && zohoPage <= MAX_ZOHO_PAGES_FOR_CATEGORY) {
    const chunkEnd = Math.min(
      zohoPage + CATEGORY_ZOHO_FETCH_CONCURRENCY - 1,
      MAX_ZOHO_PAGES_FOR_CATEGORY
    )
    const pageNums = []
    for (let p = zohoPage; p <= chunkEnd; p++) pageNums.push(p)
    const results = await Promise.all(
      pageNums.map((p) => listModule('/items', { page: p, per_page: ZOHO_ITEMS_PAGE_FOR_FILTER }))
    )

    let pagesConsumed = 0
    for (const data of results) {
      pagesConsumed += 1
      const batch = Array.isArray(data?.items) ? data.items : []
      const { items: hydratedBatch } = await hydrateItemsListRowsForProductCategoryField(batch, {
        concurrency: CATEGORY_HYDRATE_CONCURRENCY
      })
      for (const it of hydratedBatch) {
        if (itemMatchesCategoryNameFilter(it, categoryFilter)) accum.push(it)
        if (accum.length >= wantTotal) break
      }
      lastHasMore = Boolean(data?.page_context?.has_more_page)
      if (accum.length >= wantTotal) break
      if (!lastHasMore) break
    }
    zohoPage += pagesConsumed
    if (!lastHasMore) break
    if (accum.length >= wantTotal) break
  }

  const start = (pageNum - 1) * perPage
  const slice = accum.slice(start, start + perPage)
  let out = applyTierToItemsResponse({ code: 0, message: 'success', items: slice }, tier)
  if (isProductCategoryConfigured()) out = enrichCustomerItemsResponse(out)
  const hasMorePage = accum.length > pageNum * perPage || lastHasMore

  return {
    code: 0,
    message: 'success',
    items: out.items || [],
    page_context: {
      page: pageNum,
      per_page: perPage,
      has_more_page: hasMorePage
    }
  }
}

export const customerRoutes = Router()

customerRoutes.use(requireCustomer, requireActiveCustomer)

/** Catalog category names for customer app filters (same list as admin, when Zoho is configured). */
customerRoutes.get('/product-categories', async (_req, res, next) => {
  try {
    if (!isProductCategoryConfigured()) {
      res.json({ configured: false, categories: [] })
      return
    }
    const categories = await listProductCategories()
    res.json({ configured: true, categories })
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/items', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query)
    const data = await listCustomerItemsForApp(query, req.customer.email)
    res.json(data)
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/items/:id', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const data = await getModuleById('/items', id)
    const tier = await getActiveTierForCustomerEmail(req.customer.email)
    let out = applyTierToSingleItemResponse(data, tier)
    if (isProductCategoryConfigured()) out = enrichCustomerSingleItemResponse(out)
    res.json(out)
  } catch (error) {
    next(error)
  }
})

customerRoutes.post('/orders', async (req, res, next) => {
  try {
    const body = createOrderSchema.parse(req.body)
    const customer = req.customer
    const { customerId } = await resolveCustomerContactForCheckout(customer)
    const resolvedLines = await resolveCheckoutLineItems(body.line_items, customer.email)

    const { salesOrderData, invoice, salesorder } = await createZohoOrderAndInvoice({
      customerId,
      resolvedLines,
      referenceNumber: body.reference_number
    })

    const order = invoice ? mapInvoiceToOrder(invoice, null) : null
    const refLabel =
      String(
        invoice?.invoice_number || invoice?.reference_number || body.reference_number || 'app-order'
      ).trim() || 'app-order'
    const inventory_adjustments = await adjustInventoryForCheckout(resolvedLines, refLabel)

    res.status(201).json({
      message: 'Order created',
      salesorder,
      invoice,
      inventory_adjustments,
      ...(order ? { order } : {})
    })
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/orders', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query)
    const email = normalizeEmail(req.customer.email)
    const contact = await ensureCustomerContact({
      fullName: req.customer.fullName,
      email: req.customer.email
    })
    const zohoCustomerId = String(contact?.contact_id || '')
    const data = await listModule('/invoices', { per_page: 200, ...query })
    const rows = Array.isArray(data?.invoices) ? data.invoices : []
    const invoices = rows.filter((invoice) => invoiceBelongsToAppCustomer(invoice, email, zohoCustomerId))
    const assignmentsByInvoice = new Map(listAssignments().map((row) => [String(row.invoiceId), row]))
    const orders = invoices
      .map((invoice) => mapInvoiceToOrder(invoice, assignmentsByInvoice.get(String(invoice.invoice_id))))
      .sort(compareOrderDateDesc)
    res.json({ orders })
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/invoices', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query)
    const email = normalizeEmail(req.customer.email)
    const contact = await ensureCustomerContact({
      fullName: req.customer.fullName,
      email: req.customer.email
    })
    const zohoCustomerId = String(contact?.contact_id || '')
    const data = await listModule('/invoices', { per_page: 200, ...query })
    const invoices = (Array.isArray(data?.invoices) ? data.invoices : []).filter((invoice) =>
      invoiceBelongsToAppCustomer(invoice, email, zohoCustomerId)
    )
    res.json({ ...data, invoices })
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/invoices/:id', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const data = await getModuleById('/invoices', id)
    const invoice = data?.invoice || data
    const contact = await ensureCustomerContact({
      fullName: req.customer.fullName,
      email: req.customer.email
    })
    const zohoCustomerId = String(contact?.contact_id || '')
    if (!invoiceBelongsToAppCustomer(invoice, req.customer.email, zohoCustomerId)) {
      const err = new Error('Invoice not found')
      err.statusCode = 404
      throw err
    }
    res.json(data)
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/orders/:id/proof', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const data = await getModuleById('/invoices', id)
    const invoice = data?.invoice || data
    const contact = await ensureCustomerContact({
      fullName: req.customer.fullName,
      email: req.customer.email
    })
    const zohoCustomerId = String(contact?.contact_id || '')
    if (!invoiceBelongsToAppCustomer(invoice, req.customer.email, zohoCustomerId)) {
      const err = new Error('Order proof not found')
      err.statusCode = 404
      throw err
    }
    const assignment = listAssignments().find((row) => String(row.invoiceId) === id)
    if (!assignment?.proof) {
      const err = new Error('Proof is not available yet')
      err.statusCode = 404
      throw err
    }
    const attachment = await getInvoiceAttachment(id)
    if (attachment.contentDisposition) {
      res.setHeader('Content-Disposition', attachment.contentDisposition)
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${assignment.proof.fileName || 'proof.jpg'}"`)
    }
    res.setHeader('Content-Type', attachment.contentType)
    res.send(attachment.data)
  } catch (error) {
    next(error)
  }
})
