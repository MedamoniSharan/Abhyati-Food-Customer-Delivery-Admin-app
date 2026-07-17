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
import { hydrateInvoicesWithLineItems } from '../services/orderInvoiceHydrate.js'
import { notifyCustomerOrderPlaced } from '../services/notificationService.js'
import {
  countUnreadForRecipient,
  listNotificationsForRecipient,
  markAllNotificationsRead,
  markNotificationRead
} from '../services/notificationStore.js'
import {
  enrichCustomerItemsResponse,
  enrichCustomerSingleItemResponse,
  hydrateItemsListRowsForProductCategoryField,
  isProductCategoryConfigured,
  listProductCategories
} from '../services/productCategoryZohoService.js'
import {
  listIndexedItemsByCategory,
  warmItemCategoryIndex
} from '../services/itemCategoryIndexCache.js'
import { enrichMinPurchaseOnItemResponse, enrichMinPurchaseOnItemsListResponse, getZohoItemMinPurchaseFieldId } from '../services/zohoItemMinPurchase.js'

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

function invoiceContactEmails(invoice) {
  const emails = new Set()
  const primary = normalizeEmail(invoice?.customer_email)
  if (primary) emails.add(primary)
  const billing = invoice?.billing_address
  if (billing && typeof billing === 'object') {
    const be = normalizeEmail(billing.email)
    if (be) emails.add(be)
  }
  const contacts = invoice?.contact_persons
  if (Array.isArray(contacts)) {
    for (const person of contacts) {
      const pe = normalizeEmail(person?.email)
      if (pe) emails.add(pe)
    }
  }
  return emails
}

/** Zoho list payloads sometimes omit `customer_email`; `customer_id` is reliable after checkout. */
function invoiceBelongsToAppCustomer(invoice, customerEmail, zohoCustomerId) {
  const email = normalizeEmail(customerEmail)
  const invEmail = normalizeEmail(invoice?.customer_email)
  if (invEmail && invEmail === email) return true
  if (invoiceContactEmails(invoice).has(email)) return true
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

const CATEGORY_HYDRATE_CONCURRENCY = 4

/**
 * List items for the customer app. Category filters use an in-memory index (built once per TTL)
 * so chip taps do not re-scan Zoho on every request.
 */
async function listCustomerItemsForApp(query, customerEmail) {
  const pageNum = query.page && query.page > 0 ? query.page : 1
  const perPage = query.per_page && query.per_page > 0 ? Math.min(query.per_page, 200) : 20
  const categoryFilter = normalizeCategoryNameQuery(query.category_name)
  const tier = await getActiveTierForCustomerEmail(customerEmail)

  if (!categoryFilter) {
    // Warm category index in the background so the next chip tap is fast.
    warmItemCategoryIndex()
    const data = await listModule('/items', { page: pageNum, per_page: perPage })
    const batch = Array.isArray(data?.items) ? data.items : []
    const { items: hydratedList } = await hydrateItemsListRowsForProductCategoryField(batch, {
      concurrency: CATEGORY_HYDRATE_CONCURRENCY,
      hydrateCategory: true,
      hydrateCustomerName: true
    })
    let out = applyTierToItemsResponse({ ...data, items: hydratedList }, tier)
    if (isProductCategoryConfigured()) out = enrichCustomerItemsResponse(out)
    if (getZohoItemMinPurchaseFieldId()) out = enrichMinPurchaseOnItemsListResponse(out)
    return out
  }

  if (!isProductCategoryConfigured()) {
    // No Zoho category CF configured — fall back to empty filter result rather than a full catalog scan.
    return {
      code: 0,
      message: 'success',
      items: [],
      page_context: { page: pageNum, per_page: perPage, has_more_page: false }
    }
  }

  const indexed = await listIndexedItemsByCategory(categoryFilter, { page: pageNum, perPage })
  let out = applyTierToItemsResponse(
    { code: 0, message: 'success', items: indexed.items, page_context: indexed.page_context },
    tier
  )
  if (isProductCategoryConfigured()) out = enrichCustomerItemsResponse(out)
  if (getZohoItemMinPurchaseFieldId()) out = enrichMinPurchaseOnItemsListResponse(out)
  if ((out.items || []).length === 0 && indexed.total_matched === 0) {
    const { createLogger } = await import('../util/logger.js')
    createLogger('customer-items').info('Category filter returned no items', {
      categoryFilter,
      page: pageNum
    })
  }
  return {
    code: 0,
    message: 'success',
    items: out.items || [],
    page_context: indexed.page_context,
    ...(indexed.total_matched != null ? { category_total_matched: indexed.total_matched } : {})
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
    warmItemCategoryIndex()
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
    if (getZohoItemMinPurchaseFieldId()) out = enrichMinPurchaseOnItemResponse(out)
    res.json(out)
  } catch (error) {
    next(error)
  }
})

customerRoutes.post('/orders', async (req, res, next) => {
  try {
    const body = createOrderSchema.parse(req.body)
    const customer = req.customer
    const { customerId, deliveryAddressBlock } = await resolveCustomerContactForCheckout(customer)
    const resolvedLines = await resolveCheckoutLineItems(body.line_items, customer.email)

    const { salesOrderData, invoice, salesorder } = await createZohoOrderAndInvoice({
      customerId,
      resolvedLines,
      referenceNumber: body.reference_number,
      deliveryAddressBlock
    })

    const order = invoice ? mapInvoiceToOrder(invoice, null) : null
    const refLabel =
      String(
        invoice?.invoice_number || invoice?.reference_number || body.reference_number || 'app-order'
      ).trim() || 'app-order'
    const inventory_adjustments = await adjustInventoryForCheckout(resolvedLines, refLabel)

    try {
      notifyCustomerOrderPlaced({
        customerEmail: customer.email,
        invoiceId: invoice?.invoice_id,
        invoiceNumber: invoice?.invoice_number || invoice?.reference_number || body.reference_number,
        amountInr: invoice?.total
      })
    } catch {
      /* non-fatal */
    }

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
    const { invoices: hydratedInvoices } = await hydrateInvoicesWithLineItems(invoices)
    const assignmentsByInvoice = new Map(listAssignments().map((row) => [String(row.invoiceId), row]))
    const orders = hydratedInvoices
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

async function customerOrderProofContext(invoiceId, customerEmail, customerFullName) {
  const data = await getModuleById('/invoices', invoiceId)
  const invoice = data?.invoice || data
  const contact = await ensureCustomerContact({
    fullName: customerFullName,
    email: customerEmail
  })
  const zohoCustomerId = String(contact?.contact_id || '')
  if (!invoiceBelongsToAppCustomer(invoice, customerEmail, zohoCustomerId)) {
    const err = new Error('Order proof not found')
    err.statusCode = 404
    throw err
  }
  const assignment = listAssignments().find((row) => String(row.invoiceId) === invoiceId)
  if (!assignment?.proof) {
    const err = new Error('Proof is not available yet')
    err.statusCode = 404
    throw err
  }
  return { invoice, assignment }
}

customerRoutes.get('/orders/:id/proof', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const { assignment } = await customerOrderProofContext(id, req.customer.email, req.customer.fullName)
    const { resolveProofPhotoResponse } = await import('../services/deliveryProofHttp.js')
    const photo = await resolveProofPhotoResponse(assignment)
    if (!photo) {
      const err = new Error('Proof photo not available')
      err.statusCode = 404
      throw err
    }
    res.setHeader('Content-Type', photo.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${photo.fileName}"`)
    res.send(photo.data)
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/orders/:id/proof/photo', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const { assignment } = await customerOrderProofContext(id, req.customer.email, req.customer.fullName)
    const { resolveProofPhotoResponse } = await import('../services/deliveryProofHttp.js')
    const photo = await resolveProofPhotoResponse(assignment)
    if (!photo) {
      const err = new Error('Proof photo not available')
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

customerRoutes.get('/orders/:id/proof/signature', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const { assignment } = await customerOrderProofContext(id, req.customer.email, req.customer.fullName)
    const { resolveProofSignatureResponse } = await import('../services/deliveryProofHttp.js')
    const sig = await resolveProofSignatureResponse(assignment)
    if (!sig) {
      const err = new Error('Signature not available')
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

customerRoutes.get('/orders/:id/proof/summary', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const { invoice, assignment } = await customerOrderProofContext(
      id,
      req.customer.email,
      req.customer.fullName
    )
    const { buildProofSummary } = await import('../services/deliveryProofHttp.js')
    res.json({
      summary: {
        ...buildProofSummary(assignment),
        invoiceNumber: String(invoice?.invoice_number || assignment.invoiceNumber || id),
        total: Number(invoice?.total) || Number(assignment.amount) || 0
      }
    })
  } catch (error) {
    next(error)
  }
})

customerRoutes.get('/notifications', async (req, res, next) => {
  try {
    const notifications = listNotificationsForRecipient('customer', req.customer.email)
    res.json({
      notifications,
      unreadCount: countUnreadForRecipient('customer', req.customer.email)
    })
  } catch (error) {
    next(error)
  }
})

customerRoutes.post('/notifications/read-all', async (req, res, next) => {
  try {
    const updated = markAllNotificationsRead('customer', req.customer.email)
    res.json({ message: 'All notifications marked read', updated })
  } catch (error) {
    next(error)
  }
})

customerRoutes.post('/notifications/:id/read', async (req, res, next) => {
  try {
    const { id } = idParamSchema.parse(req.params)
    const row = markNotificationRead(id, 'customer', req.customer.email)
    if (!row) {
      const err = new Error('Notification not found')
      err.statusCode = 404
      throw err
    }
    res.json({ notification: row })
  } catch (error) {
    next(error)
  }
})
