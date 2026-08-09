import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'
import { putAssignment } from './dynamo/appDataDynamo.js'

const log = createLogger('delivery')

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '..', 'data', 'delivery-assignments.json')

const assignments = new Map()

function mirrorAssignment(row) {
  if (!row?.id) return
  void putAssignment(row).catch((err) => log.error('Dynamo assignment mirror failed', serializeError(err)))
}

/** Await Dynamo write so driver GSI is ready before admin response returns. */
export async function mirrorAssignmentNow(row) {
  if (!row?.id) return
  try {
    await putAssignment(row)
  } catch (err) {
    log.error('Dynamo assignment mirror failed', serializeError(err))
  }
}

/** Re-read persisted rows so other API processes (or restarts) see assignments created elsewhere. */
function reloadAssignmentsFromDisk() {
  assignments.clear()
  load()
}

function persist(changedRow) {
  try {
    const dir = dirname(FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(FILE, JSON.stringify([...assignments.values()]), 'utf8')
  } catch (err) {
    log.error('Assignment persist failed', serializeError(err))
  }
  if (changedRow) mirrorAssignment(changedRow)
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

export function upsertAssignmentRow(row, { allowReplace = false } = {}) {
  reloadAssignmentsFromDisk()
  const id = String(row?.id || '').trim()
  const invoiceId = String(row?.invoiceId || '').trim()
  const driverEmail = String(row?.driverEmail || '').trim().toLowerCase()
  if (!id || !invoiceId || !driverEmail) return null

  const patchFrom = (base) => {
    const next = {
      ...base,
      ...row,
      id: String(base.id || id),
      driverEmail,
      invoiceId,
      driverName: String(row.driverName || base.driverName || 'Driver'),
      invoiceNumber: String(row.invoiceNumber || base.invoiceNumber || invoiceId),
      customerName: String(row.customerName || base.customerName || 'Customer'),
      customerEmail: String(row.customerEmail || base.customerEmail || '')
        .trim()
        .toLowerCase(),
      amount: Number(row.amount ?? base.amount) || 0,
      address: String(row.address || base.address || ''),
      status: String(row.status || base.status || 'assigned'),
      acceptedAt: row.acceptedAt !== undefined ? row.acceptedAt : base.acceptedAt ?? null,
      deliveredAt: row.deliveredAt !== undefined ? row.deliveredAt : base.deliveredAt ?? null,
      proof: row.proof !== undefined ? row.proof : base.proof ?? null,
      createdAt: String(base.createdAt || row.createdAt || new Date().toISOString()),
      updatedAt: String(row.updatedAt || new Date().toISOString())
    }
    // Drop other local rows for the same invoice (old driver after reassignment).
    for (const [k, a] of [...assignments.entries()]) {
      if (String(a.invoiceId) === invoiceId && String(a.id) !== String(next.id)) {
        assignments.delete(k)
      }
    }
    assignments.set(String(next.id), next)
    persist(next)
    return next
  }

  const existingById = assignments.get(id)
  if (existingById) {
    if (!allowReplace) return existingById
    return patchFrom(existingById)
  }
  const existingByInvoice = [...assignments.values()].find((a) => String(a.invoiceId) === invoiceId)
  if (existingByInvoice) {
    if (!allowReplace) return existingByInvoice
    return patchFrom(existingByInvoice)
  }
  return patchFrom({
    id,
    acceptedAt: null,
    deliveredAt: null,
    proof: null,
    createdAt: String(row.createdAt || new Date().toISOString())
  })
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
  const inv = String(invoiceId)
  const email = String(driverEmail).trim().toLowerCase()
  const existing = [...assignments.values()].find((a) => String(a.invoiceId) === inv)

  // Reassign same invoice to the new driver instead of creating duplicates.
  if (existing) {
    const row = {
      ...existing,
      driverEmail: email,
      driverName: String(driverName || existing.driverName || 'Driver'),
      invoiceNumber: String(invoiceNumber || existing.invoiceNumber || inv),
      customerName: String(customerName || existing.customerName || 'Customer'),
      customerEmail: String(customerEmail || existing.customerEmail || '')
        .trim()
        .toLowerCase(),
      amount: Number(amount ?? existing.amount) || 0,
      address: String(address || existing.address || ''),
      status: existing.status === 'delivered' ? 'delivered' : 'assigned',
      acceptedAt: existing.status === 'delivered' ? existing.acceptedAt : null,
      deliveredAt: existing.status === 'delivered' ? existing.deliveredAt : null,
      proof: existing.status === 'delivered' ? existing.proof : null,
      updatedAt: new Date().toISOString()
    }
    for (const [k, a] of [...assignments.entries()]) {
      if (String(a.invoiceId) === inv && String(a.id) !== String(row.id)) {
        assignments.delete(k)
      }
    }
    assignments.set(String(row.id), row)
    persist(row)
    return row
  }

  const id = `asg_${Date.now()}_${Math.round(Math.random() * 1000)}`
  const row = {
    id,
    driverEmail: email,
    driverName: String(driverName || 'Driver'),
    invoiceId: inv,
    invoiceNumber: String(invoiceNumber || inv),
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
  persist(row)
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
  persist(next)
  return next
}
