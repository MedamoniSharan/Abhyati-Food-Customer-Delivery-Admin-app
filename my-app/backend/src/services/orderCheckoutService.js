import {
  createInvoice,
  createSalesOrder,
  ensureCustomerContact,
  getModuleById,
  resolveDefaultSalespersonFieldsForTransactions
} from './zohoBooksService.js'
import { createInventoryAdjustmentsForDeliveredLines } from './zohoInventoryPodService.js'
import {
  applyCustomerPrice,
  getActiveTierForCustomerEmail
} from './customerPricingZohoService.js'

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
  return { contact, customerId }
}

export async function resolveCheckoutLineItems(lineItems, customerEmail) {
  const tier = await getActiveTierForCustomerEmail(customerEmail)
  return Promise.all(
    lineItems.map(async (line) => {
      const itemId = line.item_id
      if (!itemId) return line
      const itemData = await getModuleById('/items', String(itemId))
      const item = itemData?.item || itemData
      const base = Number(item?.rate ?? item?.sales_rate ?? line.rate ?? 0)
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

export async function createZohoOrderAndInvoice({
  customerId,
  resolvedLines,
  referenceNumber
}) {
  const salesOrderPayload = {
    customer_id: customerId,
    reference_number: referenceNumber,
    line_items: resolvedLines
  }
  const invoicePayload = {
    customer_id: customerId,
    reference_number: referenceNumber,
    line_items: resolvedLines
  }
  const spFields = await resolveDefaultSalespersonFieldsForTransactions()
  if (spFields) {
    Object.assign(salesOrderPayload, spFields)
    Object.assign(invoicePayload, spFields)
  }

  const [salesOrderData, invoiceData] = await Promise.all([
    createSalesOrder(salesOrderPayload),
    createInvoice(invoicePayload)
  ])

  const invoice = invoiceData?.invoice || invoiceData
  return {
    salesOrderData,
    invoice,
    salesorder: salesOrderData?.salesorder || salesOrderData
  }
}

export async function adjustInventoryForCheckout(resolvedLines, refLabel) {
  return createInventoryAdjustmentsForDeliveredLines(resolvedLines, refLabel, 'Checkout')
}
