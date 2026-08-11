import {
  createInvoice,
  ensureCustomerContact,
  getModuleById,
  listModule,
  resolveDefaultSalespersonFieldsForTransactions
} from './zohoBooksService.js'
import { createInventoryAdjustmentsForDeliveredLines } from './zohoInventoryPodService.js'
import {
  applyCustomerPrice,
  getActiveTierForCustomerEmail
} from './customerPricingZohoService.js'
import { buildZohoDeliveryAddressBlock, buildZohoInvoiceCheckoutAddress } from '../util/customerMapsLink.js'

export async function resolveCustomerContactForCheckout(customer) {
  const contact = await ensureCustomerContact({
    fullName: customer.fullName,
    email: customer.email
  })
  const customerId = String(contact?.contact_id || '')
  if (!customerId) {
    const err = new Error('Unable to resolve customer contact in Zoho')
    err.statusCode = 502
    throw err
  }
  let fullContact = contact
  try {
    const data = await getModuleById('/contacts', customerId)
    fullContact = data?.contact || data || contact
  } catch {
    /* use list contact if detail fetch fails */
  }
  const deliveryAddressBlock = buildZohoDeliveryAddressBlock(fullContact)
  return { contact: fullContact, customerId, deliveryAddressBlock }
}

export async function resolveCheckoutLineItems(lineItems, customerEmail) {
  const tier = await getActiveTierForCustomerEmail(customerEmail)
  return Promise.all(
    lineItems.map(async (line) => {
      const itemId = line.item_id
      if (!itemId) {
        const err = new Error(`Cart line "${line.name || 'item'}" is missing a Zoho item id`)
        err.statusCode = 400
        throw err
      }
      let itemData
      try {
        itemData = await getModuleById('/items', String(itemId))
      } catch (err) {
        const zohoMsg =
          err?.response?.data?.message ||
          (err instanceof Error ? err.message : 'Unknown error')
        const friendly = new Error(
          `Product "${line.name || itemId}" could not be loaded from Zoho (${zohoMsg}). Re-add it from the catalog.`
        )
        friendly.statusCode = 400
        throw friendly
      }
      const item = itemData?.item || itemData
      if (!item || item.item_id == null) {
        const err = new Error(`Product "${line.name || itemId}" was not found in Zoho Books`)
        err.statusCode = 400
        throw err
      }
      const status = String(item.status || '').toLowerCase()
      if (status === 'inactive') {
        const err = new Error(`Product "${item.name || line.name || itemId}" is inactive and cannot be ordered`)
        err.statusCode = 400
        throw err
      }
      const base = Number(item?.rate ?? item?.sales_rate ?? line.rate ?? 0)
      if (!Number.isFinite(base) || base < 0) {
        const err = new Error(`Product "${item.name || line.name || itemId}" has an invalid rate`)
        err.statusCode = 400
        throw err
      }
      const rate = applyCustomerPrice(base, tier)
      return {
        item_id: String(itemId),
        quantity: line.quantity,
        rate,
        ...(line.name ? { name: line.name } : item?.name ? { name: String(item.name) } : {}),
        ...(line.description
          ? { description: line.description }
          : item?.description
            ? { description: String(item.description) }
            : {})
      }
    })
  )
}

export function computeLineItemsTotalInr(resolvedLines) {
  return resolvedLines.reduce((sum, line) => {
    const qty = Number(line.quantity) || 0
    const rate = Number(line.rate) || 0
    return sum + qty * rate
  }, 0)
}

/**
 * Find an existing invoice for this customer with the same reference_number (idempotent retries).
 */
export async function findExistingInvoiceByReference(customerId, referenceNumber) {
  const ref = String(referenceNumber || '').trim()
  const cid = String(customerId || '').trim()
  if (!ref || !cid) return null
  try {
    const data = await listModule('/invoices', {
      customer_id: cid,
      reference_number: ref,
      per_page: 25
    })
    const rows = Array.isArray(data?.invoices) ? data.invoices : []
    const match =
      rows.find((inv) => String(inv?.reference_number || '').trim() === ref) ||
      rows.find((inv) => String(inv?.reference_number || '').includes(ref)) ||
      null
    return match
  } catch {
    return null
  }
}

/**
 * Create a Zoho Books invoice for checkout.
 * Sales orders are intentionally not created here — creating both looked like duplicate orders
 * in Zoho/admin and raced when Promise.all partially succeeded.
 */
export async function createZohoOrderAndInvoice({
  customerId,
  resolvedLines,
  referenceNumber,
  deliveryAddressBlock = null
}) {
  const invoicePayload = {
    customer_id: customerId,
    line_items: resolvedLines
  }
  if (referenceNumber) {
    invoicePayload.reference_number = referenceNumber
  }
  if (deliveryAddressBlock && typeof deliveryAddressBlock === 'object') {
    const { billing_address, mapsNote } = buildZohoInvoiceCheckoutAddress(deliveryAddressBlock)
    if (billing_address) {
      invoicePayload.billing_address = billing_address
      invoicePayload.shipping_address = billing_address
    }
    if (mapsNote) {
      invoicePayload.notes = mapsNote
    }
  }
  const spFields = await resolveDefaultSalespersonFieldsForTransactions()
  if (spFields) {
    Object.assign(invoicePayload, spFields)
  }

  const invoiceData = await createInvoice(invoicePayload)
  const invoice = invoiceData?.invoice || invoiceData
  return {
    salesOrderData: null,
    invoice,
    salesorder: null
  }
}

export async function adjustInventoryForCheckout(resolvedLines, refLabel) {
  return createInventoryAdjustmentsForDeliveredLines(resolvedLines, refLabel, 'Checkout')
}
