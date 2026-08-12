import {
  getAssignmentById,
  listAssignmentsForDriver,
  upsertAssignmentRow
} from './deliveryAssignmentStore.js'
import { getAppRecord, listAssignmentsByDriver } from './dynamo/appDataDynamo.js'
import { listAssignmentsFromZohoForDriver } from './zohoDeliveryAssignmentNotes.js'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('delivery')
const zohoCache = new Map()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/** Prefer newest row per invoice (and per assignment id). */
function mergeAssignmentRows(rows) {
  const byInvoice = new Map()
  for (const row of rows) {
    if (!row?.invoiceId || !row?.driverEmail) continue
    const inv = String(row.invoiceId)
    const prev = byInvoice.get(inv)
    if (!prev) {
      byInvoice.set(inv, row)
      continue
    }
    const newer =
      String(row.updatedAt || row.createdAt || '') >= String(prev.updatedAt || prev.createdAt || '')
    if (newer) byInvoice.set(inv, row)
  }
  return [...byInvoice.values()]
}

export function clearDriverAssignmentZohoCache(driverEmail) {
  const key = normalizeEmail(driverEmail)
  if (key) zohoCache.delete(key)
  else zohoCache.clear()
}

/**
 * Merge local JSON + Dynamo GSI (same email). Fall back to Zoho invoice notes when both empty.
 * Matching is always by normalized driver email (JWT / login email).
 */
export async function resolveAssignmentsForDriver(driverEmail) {
  const key = normalizeEmail(driverEmail)
  if (!key) return []

  const fromFile = listAssignmentsForDriver(key)

  let fromDynamo = []
  try {
    const rows = await listAssignmentsByDriver(key)
    if (Array.isArray(rows)) fromDynamo = rows
  } catch (err) {
    log.warn('Dynamo assignment query failed', serializeError(err))
  }

  let merged = mergeAssignmentRows([...fromFile, ...fromDynamo]).filter(
    (r) => normalizeEmail(r.driverEmail) === key
  )

  // Keep local file in sync with Dynamo (multi-instance / restart).
  for (const row of fromDynamo) {
    if (normalizeEmail(row.driverEmail) !== key) continue
    upsertAssignmentRow(row, { allowReplace: true })
  }

  if (merged.length > 0) {
    return merged
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  }

  const now = Date.now()
  const cached = zohoCache.get(key)
  let fromZoho =
    cached && now - cached.at < 60_000
      ? cached.rows
      : await listAssignmentsFromZohoForDriver(key, { maxDetail: 40 })
  zohoCache.set(key, { at: now, rows: fromZoho })

  for (const row of fromZoho) {
    upsertAssignmentRow(row, { allowReplace: true })
  }

  return fromZoho
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

/**
 * Resolve a single assignment by id — local JSON, Dynamo, then driver list (Zoho hydrate).
 * Keeps accept/status/proof working on multi-instance Render where list hydrated from Dynamo.
 */
export async function resolveAssignmentById(id, driverEmail) {
  const key = String(id || '').trim()
  if (!key) return null

  let row = getAssignmentById(key)
  if (row) return row

  try {
    const fromDynamo = await getAppRecord('assignment', key)
    if (fromDynamo?.id) {
      upsertAssignmentRow(fromDynamo, { allowReplace: true })
      return fromDynamo
    }
  } catch (err) {
    log.warn('Dynamo assignment get failed', serializeError(err))
  }

  const email = normalizeEmail(driverEmail)
  if (email) {
    const all = await resolveAssignmentsForDriver(email)
    row = all.find((a) => String(a.id) === key) || null
    if (row) {
      upsertAssignmentRow(row, { allowReplace: true })
      return row
    }
  }

  return null
}
