import { getModuleById, listModule, updateModule } from './zohoBooksService.js'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('delivery')

export const ASG_PREFIX = '__abh_asg_v1:'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function buildAssignmentNoteLine(row) {
  const payload = JSON.stringify({
    id: String(row.id || ''),
    driverEmail: normalizeEmail(row.driverEmail),
    driverName: String(row.driverName || 'Driver'),
    status: String(row.status || 'assigned'),
    createdAt: String(row.createdAt || new Date().toISOString()),
    updatedAt: String(row.updatedAt || row.createdAt || new Date().toISOString())
  })
  return `${ASG_PREFIX}${payload}`
}

export function parseAssignmentFromNotes(notes) {
  const text = String(notes || '')
  const idx = text.indexOf(ASG_PREFIX)
  if (idx === -1) return null
  const rest = text.slice(idx + ASG_PREFIX.length)
  const end = rest.indexOf('\n')
  const json = (end === -1 ? rest : rest.slice(0, end)).trim()
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function stripAssignmentLines(notes) {
  return String(notes || '')
    .split('\n')
    .filter((line) => !line.includes(ASG_PREFIX))
    .join('\n')
    .trim()
}

export async function upsertInvoiceAssignmentNote(invoiceId, row) {
  const id = String(invoiceId || '').trim()
  if (!id || !row?.id) return
  const data = await getModuleById('/invoices', id)
  const invoice = data?.invoice || data
  const cleaned = stripAssignmentLines(invoice?.notes)
  const line = buildAssignmentNoteLine(row)
  const notes = cleaned ? `${cleaned}\n${line}` : line
  await updateModule('/invoices', id, { notes })
}

function zohoInvoiceToAssignmentRow(inv, marker) {
  const invoiceId = String(inv.invoice_id || '').trim()
  if (!invoiceId) return null
  return {
    id: String(marker.id || `asg_zoho_${invoiceId}`),
    driverEmail: normalizeEmail(marker.driverEmail),
    driverName: String(marker.driverName || 'Driver'),
    invoiceId,
    invoiceNumber: String(inv.invoice_number || invoiceId),
    customerName: String(inv.customer_name || 'Customer'),
    customerEmail: String(inv.customer_email || '').trim().toLowerCase(),
    amount: Number(inv.total) || 0,
    address: String(inv.billing_address?.address || inv.shipping_address?.address || ''),
    status: String(marker.status || 'assigned'),
    acceptedAt: null,
    deliveredAt: null,
    proof: null,
    createdAt: String(marker.createdAt || new Date().toISOString()),
    updatedAt: String(marker.updatedAt || marker.createdAt || new Date().toISOString())
  }
}

export async function listAssignmentsFromZohoForDriver(driverEmail, opts = {}) {
  const key = normalizeEmail(driverEmail)
  if (!key) return []
  const maxDetail = Number(opts.maxDetail) > 0 ? Number(opts.maxDetail) : 40
  /** List payloads often omit `notes`; budget a few detail GETs so assignments are not invisible. */
  let detailBudget = Number(opts.detailBudget) >= 0 ? Number(opts.detailBudget) : Math.min(12, maxDetail)
  try {
    const data = await listModule('/invoices', {
      per_page: Math.min(maxDetail, 200),
      sort_column: 'last_modified_time',
      sort_order: 'D'
    })
    const invoices = Array.isArray(data.invoices) ? data.invoices.slice(0, maxDetail) : []
    const rows = []
    for (const inv of invoices) {
      const invoiceId = String(inv.invoice_id || '').trim()
      if (!invoiceId) continue
      let full = inv
      let marker = parseAssignmentFromNotes(inv.notes)
      if (!marker && detailBudget > 0) {
        detailBudget -= 1
        try {
          const detailData = await getModuleById('/invoices', invoiceId)
          full = detailData?.invoice || detailData || inv
          marker = parseAssignmentFromNotes(full?.notes)
        } catch {
          /* keep list shape */
        }
      }
      if (!marker || normalizeEmail(marker.driverEmail) !== key) continue
      const row = zohoInvoiceToAssignmentRow(full, marker)
      if (row) rows.push(row)
    }
    return rows
  } catch (err) {
    log.warn('Zoho assignment list failed', serializeError(err))
    return []
  }
}
