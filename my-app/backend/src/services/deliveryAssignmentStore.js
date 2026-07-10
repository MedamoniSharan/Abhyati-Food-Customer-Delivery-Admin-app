import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('delivery')

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '..', 'data', 'delivery-assignments.json')

const assignments = new Map()

/** Re-read persisted rows so other API processes (or restarts) see assignments created elsewhere. */
function reloadAssignmentsFromDisk() {
  assignments.clear()
  load()
}

function persist() {
  try {
    const dir = dirname(FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(FILE, JSON.stringify([...assignments.values()]), 'utf8')
  } catch (err) {
    log.error('Assignment persist failed', serializeError(err))
  }
}

function load() {
  if (!existsSync(FILE)) return
  try {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'))
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (!row?.id || !row?.driverEmail || !row?.invoiceId) continue
      assignments.set(String(row.id), row)
    }
  } catch (err) {
    log.error('Assignment load failed', serializeError(err))
  }
}

load()

export function listAssignments() {
  reloadAssignmentsFromDisk()
  return [...assignments.values()]
}

export function listAssignmentsForDriver(driverEmail) {
  reloadAssignmentsFromDisk()
  const key = String(driverEmail || '').trim().toLowerCase()
  return [...assignments.values()].filter((a) => String(a.driverEmail).toLowerCase() === key)
}

export function upsertAssignmentRow(row) {
  reloadAssignmentsFromDisk()
  const id = String(row?.id || '').trim()
  const invoiceId = String(row?.invoiceId || '').trim()
  const driverEmail = String(row?.driverEmail || '').trim().toLowerCase()
  if (!id || !invoiceId || !driverEmail) return null
  const existingById = assignments.get(id)
  if (existingById) return existingById
  const existingByInvoice = [...assignments.values()].find((a) => String(a.invoiceId) === invoiceId)
  if (existingByInvoice) return existingByInvoice
  const next = {
    ...row,
    id,
    driverEmail,
    invoiceId,
    driverName: String(row.driverName || 'Driver'),
    invoiceNumber: String(row.invoiceNumber || invoiceId),
    customerName: String(row.customerName || 'Customer'),
    customerEmail: String(row.customerEmail || '').trim().toLowerCase(),
    amount: Number(row.amount) || 0,
    address: String(row.address || ''),
    status: String(row.status || 'assigned'),
    acceptedAt: row.acceptedAt ?? null,
    deliveredAt: row.deliveredAt ?? null,
    proof: row.proof ?? null,
    createdAt: String(row.createdAt || new Date().toISOString()),
    updatedAt: String(row.updatedAt || row.createdAt || new Date().toISOString())
  }
  assignments.set(id, next)
  persist()
  return next
}

export function createAssignment({
  driverEmail,
  driverName,
  invoiceId,
  invoiceNumber,
  customerName,
  customerEmail,
  amount,
  address
}) {
  reloadAssignmentsFromDisk()
  const id = `asg_${Date.now()}_${Math.round(Math.random() * 1000)}`
  const row = {
    id,
    driverEmail: String(driverEmail).trim().toLowerCase(),
    driverName: String(driverName || 'Driver'),
    invoiceId: String(invoiceId),
    invoiceNumber: String(invoiceNumber || invoiceId),
    customerName: String(customerName || 'Customer'),
    customerEmail: String(customerEmail || '').trim().toLowerCase(),
    amount: Number(amount) || 0,
    address: String(address || ''),
    status: 'assigned',
    acceptedAt: null,
    deliveredAt: null,
    proof: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  assignments.set(id, row)
  persist()
  return row
}

export function getAssignmentById(id) {
  reloadAssignmentsFromDisk()
  return assignments.get(String(id)) || null
}

export function updateAssignment(id, patch) {
  reloadAssignmentsFromDisk()
  const row = assignments.get(String(id))
  if (!row) return null
  const next = { ...row, ...patch, updatedAt: new Date().toISOString() }
  assignments.set(String(id), next)
  persist()
  return next
}
