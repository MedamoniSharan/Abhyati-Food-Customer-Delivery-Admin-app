import { getModuleById } from './zohoBooksService.js'

function invoiceNeedsLineItemHydration(invoice) {
  const lines = invoice?.line_items
  return !Array.isArray(lines) || lines.length === 0
}

/**
 * Zoho invoice list rows often omit line_items; fetch detail for those rows.
 * @param {unknown[]} invoices
 * @param {{ concurrency?: number }} [opts]
 */
export async function hydrateInvoicesWithLineItems(invoices, { concurrency = 4 } = {}) {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return { invoices: [], detail_fetches: 0 }
  }

  const needIdx = []
  for (let i = 0; i < invoices.length; i += 1) {
    if (invoiceNeedsLineItemHydration(invoices[i])) needIdx.push(i)
  }
  if (needIdx.length === 0) return { invoices, detail_fetches: 0 }

  const out = invoices.slice()
  const n = Math.max(1, Math.min(16, Number(concurrency) || 4))
  let cursor = 0

  async function worker() {
    while (true) {
      const j = cursor++
      if (j >= needIdx.length) return
      const i = needIdx[j]
      const row = out[i]
      const id = String(row?.invoice_id || '').trim()
      if (!id) continue
      try {
        const data = await getModuleById('/invoices', id)
        const full = data?.invoice || data
        const lineItems = Array.isArray(full?.line_items) ? full.line_items : []
        if (lineItems.length > 0) {
          out[i] = { ...row, line_items: lineItems }
        }
      } catch {
        /* keep list row */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(n, needIdx.length) }, () => worker()))
  return { invoices: out, detail_fetches: needIdx.length }
}
