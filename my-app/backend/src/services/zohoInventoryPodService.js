import { createModule } from './zohoBooksService.js'
import { env } from '../config/env.js'

/**
 * Reduce on-hand stock in Zoho Books for each line with `item_id` (quantity adjustments).
 * Used when a customer checks out; optional legacy delivery flows may pass a different `reasonTag`.
 * @param {Array<{ item_id?: string, quantity?: number }>} lineItems
 * @param {string} referenceLabel invoice / order reference for Zoho adjustment notes
 * @param {string} [reasonTag='Checkout'] label prefixed in the adjustment reason
 * @returns {{ created: unknown[], skipped: string[], errors: Array<{ item_id: string, message: string }> }}
 */
export async function createInventoryAdjustmentsForDeliveredLines(
  lineItems,
  referenceLabel,
  reasonTag = 'Checkout'
) {
  const accountId = env.ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID
  const result = { created: [], skipped: [], errors: [] }

  if (!accountId) {
    result.skipped.push('ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID is not set')
    return result
  }

  const today = new Date().toISOString().slice(0, 10)
  const withIds = (Array.isArray(lineItems) ? lineItems : []).filter((l) => l && l.item_id)

  for (const item of withIds) {
    const qty = Number(item.quantity) || 0
    if (qty <= 0) continue
    const itemId = String(item.item_id)
    const payload = {
      date: today,
      reason: `${reasonTag} — ${referenceLabel}`,
      adjustment_type: 'quantity',
      line_items: [
        {
          item_id: itemId,
          quantity_adjusted: String(-Math.abs(qty)),
          adjustment_account_id: accountId
        }
      ]
    }
    try {
      const data = await createModule('/inventoryadjustments', payload)
      result.created.push(data)
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Unknown error'
      result.errors.push({ item_id: itemId, message: String(message) })
    }
  }

  return result
}
