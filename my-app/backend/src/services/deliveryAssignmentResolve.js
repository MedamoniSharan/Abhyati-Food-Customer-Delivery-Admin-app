import { listAssignmentsForDriver, upsertAssignmentRow } from './deliveryAssignmentStore.js'
import { listAssignmentsFromZohoForDriver } from './zohoDeliveryAssignmentNotes.js'

const zohoCache = new Map()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/** Merge file-backed assignments with Zoho invoice notes (survives multi-instance / ephemeral disk). */
export async function resolveAssignmentsForDriver(driverEmail) {
  const key = normalizeEmail(driverEmail)
  const fromFile = listAssignmentsForDriver(key)
  const now = Date.now()
  const cached = zohoCache.get(key)
  const zohoOpts = { maxDetail: fromFile.length === 0 ? 30 : 10 }
  let fromZoho =
    cached && now - cached.at < 45_000
      ? cached.rows
      : await listAssignmentsFromZohoForDriver(key, zohoOpts)
  zohoCache.set(key, { at: now, rows: fromZoho })

  const merged = new Map()
  for (const row of fromZoho) merged.set(String(row.invoiceId), row)
  for (const row of fromFile) merged.set(String(row.invoiceId), row)

  for (const row of fromZoho) {
    const invoiceId = String(row.invoiceId)
    const hasLocal = fromFile.some((local) => String(local.invoiceId) === invoiceId)
    if (!hasLocal) upsertAssignmentRow(row)
  }

  return [...merged.values()].sort(
    (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  )
}
