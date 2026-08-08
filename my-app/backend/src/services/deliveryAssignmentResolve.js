import { listAssignmentsForDriver, upsertAssignmentRow } from './deliveryAssignmentStore.js'
import { listAssignmentsFromZohoForDriver } from './zohoDeliveryAssignmentNotes.js'

const zohoCache = new Map()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/**
 * Merge file-backed assignments with Zoho invoice notes (survives multi-instance / ephemeral disk).
 * When local assignments already exist, skip the expensive Zoho invoice scan.
 */
export async function resolveAssignmentsForDriver(driverEmail) {
  const key = normalizeEmail(driverEmail)
  const fromFile = listAssignmentsForDriver(key)

  // Local store is the hot path for delivery app — avoid scanning all invoices when we already have rows.
  if (fromFile.length > 0) {
    return fromFile.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  }

  const now = Date.now()
  const cached = zohoCache.get(key)
  let fromZoho =
    cached && now - cached.at < 60_000
      ? cached.rows
      : await listAssignmentsFromZohoForDriver(key, { maxDetail: 30 })
  zohoCache.set(key, { at: now, rows: fromZoho })

  for (const row of fromZoho) {
    upsertAssignmentRow(row)
  }

  return fromZoho.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}
