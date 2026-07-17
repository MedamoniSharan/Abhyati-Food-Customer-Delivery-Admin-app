import { getModuleById } from './zohoBooksService.js'
import { hydrateInvoicesWithLineItems } from './orderInvoiceHydrate.js'
import { normalizeMapsLink, pickMapsLinkFromZohoAddressBlock, resolveMapsQuery, pickMapsLinkFromInvoice } from '../util/customerMapsLink.js'

const invoiceCache = new Map()
const CACHE_TTL_MS = 60_000

function cacheGet(invoiceId) {
  const row = invoiceCache.get(String(invoiceId))
  if (!row) return null
  if (Date.now() - row.at > CACHE_TTL_MS) {
    invoiceCache.delete(String(invoiceId))
    return null
  }
  return row.invoice
}

function cacheSet(invoiceId, invoice) {
  invoiceCache.set(String(invoiceId), { at: Date.now(), invoice })
}

/**
 * Fetch Zoho invoice detail for driver assignment hydration (cached briefly).
 * @param {string} invoiceId
 */
export async function fetchInvoiceForAssignment(invoiceId) {
  const id = String(invoiceId || '').trim()
  if (!id) return null
  const cached = cacheGet(id)
  if (cached) return cached
  try {
    const data = await getModuleById('/invoices', id)
    const invoice = data?.invoice || data
    if (!invoice || typeof invoice !== 'object') return null
    const { invoices } = await hydrateInvoicesWithLineItems([invoice], { concurrency: 1 })
    const hydrated = invoices[0] || invoice
    cacheSet(id, hydrated)
    return hydrated
  } catch {
    return null
  }
}

function pickPhone(invoice) {
  const shipping = invoice?.shipping_address || {}
  const billing = invoice?.billing_address || {}
  const phone = shipping.phone || billing.phone || invoice?.contact?.phone || ''
  return String(phone || '').trim()
}

function pickDriverNote(invoice) {
  const notes = String(invoice?.notes || '').trim()
  const terms = String(invoice?.terms || '').trim()
  const shipping = invoice?.shipping_address || {}
  const shipNotes = String(shipping.notes || shipping.description || '').trim()
  const parts = [notes, terms, shipNotes].filter(Boolean)
  if (parts.length === 0) return 'Handle package with care.'
  return parts.join(' · ')
}

function mapLineItems(invoice) {
  const lineItems = Array.isArray(invoice?.line_items) ? invoice.line_items : []
  return lineItems.map((item) => ({
    name: item?.name || item?.description || 'Item',
    sku: String(item?.sku || item?.item_id || '').trim(),
    qty: Number(item?.quantity) || 1,
    unit: String(item?.unit || 'unit').trim() || 'unit',
    image: ''
  }))
}

function pickAddressLines(invoice) {
  const shipping = invoice?.shipping_address || {}
  const billing = invoice?.billing_address || {}
  const cityStateZip = [shipping.city, shipping.state, shipping.zip].filter(Boolean).join(', ')
  const addressLine1 = String(shipping.address || billing.address || '').trim() || 'Address unavailable'
  const addressLine2 = cityStateZip || String(shipping.country || billing.country || '').trim()
  const mapsLink = pickMapsLinkFromInvoice(invoice)
  const addressText = [addressLine1, addressLine2].filter(Boolean).join(', ')
  const mapsQuery = resolveMapsQuery({ mapsLink, addressText })
  const contactName = String(shipping.attention || invoice?.customer_name || 'Customer').trim()
  return { addressLine1, addressLine2, mapsQuery, mapsLink, contactName }
}

/**
 * Enrich a file/Zoho assignment row with invoice phone, notes, and line items.
 * @param {object} assignment
 */
export async function hydrateAssignmentFromInvoice(assignment) {
  if (!assignment || typeof assignment !== 'object') return assignment
  const invoiceId = String(assignment.invoiceId || '').trim()
  if (!invoiceId) return assignment

  const invoice = await fetchInvoiceForAssignment(invoiceId)
  if (!invoice) return assignment

  const { addressLine1, addressLine2, mapsQuery, mapsLink, contactName } = pickAddressLines(invoice)
  const phone = pickPhone(invoice)
  const items = mapLineItems(invoice)
  const driverNote = pickDriverNote(invoice)
  const address =
    String(assignment.address || '').trim() ||
    [addressLine1, addressLine2].filter(Boolean).join(', ') ||
    'Address not available'

  return {
    ...assignment,
    address,
    customerName: String(assignment.customerName || invoice.customer_name || contactName).trim(),
    phone,
    contactLine: contactName ? `Main Contact: ${contactName}` : '',
    driverNote,
    arrivalWindow: String(invoice.date || invoice.invoice_date || assignment.createdAt || 'Today').slice(0, 10),
    items,
    mapsQuery: mapsQuery || address,
    mapsLink: mapsLink || undefined,
    addressLine1,
    addressLine2
  }
}

/**
 * @param {object[]} assignments
 * @param {{ concurrency?: number }} [opts]
 */
export async function hydrateAssignmentsFromInvoices(assignments, { concurrency = 4 } = {}) {
  if (!Array.isArray(assignments) || assignments.length === 0) return []
  const n = Math.max(1, Math.min(8, Number(concurrency) || 4))
  const out = assignments.slice()
  let cursor = 0

  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= out.length) return
      out[i] = await hydrateAssignmentFromInvoice(out[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(n, out.length) }, () => worker()))
  return out
}
