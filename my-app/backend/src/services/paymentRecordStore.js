import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'
import { listAppRecords, putPaymentRecord } from './dynamo/appDataDynamo.js'

const log = createLogger('payments')

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '..', 'data', 'payment-records.json')

const records = new Map()

function mirrorPayment(row) {
  if (!row?.id) return
  void putPaymentRecord(row).catch((err) => log.error('Dynamo payment mirror failed', serializeError(err)))
}

function reloadFromDisk() {
  records.clear()
  load()
}

function persist(changedRow) {
  try {
    const dir = dirname(FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(FILE, JSON.stringify([...records.values()]), 'utf8')
  } catch (err) {
    log.error('Payment record persist failed', serializeError(err))
  }
  if (changedRow) mirrorPayment(changedRow)
}

function load() {
  if (!existsSync(FILE)) return
  try {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'))
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (!row?.id) continue
      records.set(String(row.id), row)
    }
  } catch (err) {
    log.error('Payment record load failed', serializeError(err))
  }
}

load()

export function listPaymentRecords() {
  reloadFromDisk()
  return [...records.values()]
}

function paymentFreshness(row) {
  if (!row) return ''
  const paid = row.paidAt || ''
  const updated = row.updatedAt || row.createdAt || ''
  return `${paid}|${updated}`
}

function preferPaymentRow(a, b) {
  if (!a) return b
  if (!b) return a
  return paymentFreshness(a) >= paymentFreshness(b) ? a : b
}

function upsertPaymentRow(row) {
  if (!row?.id) return null
  reloadFromDisk()
  const id = String(row.id)
  const existing = records.get(id)
  const next = existing
    ? { ...existing, ...row, updatedAt: String(row.updatedAt || new Date().toISOString()) }
    : { ...row, id }
  records.set(id, next)
  persist(next)
  return next
}

/**
 * Local JSON can lag multi-instance / crash mid-write. Merge Dynamo payloads so
 * admin payments survive Render redeploys and cross-instance reads.
 */
export async function listPaymentRecordsMerged() {
  const local = listPaymentRecords()
  let remote = []
  try {
    const rows = await listAppRecords('payment')
    if (Array.isArray(rows)) remote = rows.filter((r) => r?.id)
  } catch (err) {
    log.warn('Dynamo payment list failed', serializeError(err))
  }

  const byId = new Map()
  for (const row of [...local, ...remote]) {
    const id = String(row.id)
    byId.set(id, preferPaymentRow(byId.get(id), row))
  }

  for (const row of byId.values()) {
    const localRow = local.find((r) => String(r.id) === String(row.id))
    if (!localRow || paymentFreshness(row) > paymentFreshness(localRow)) {
      upsertPaymentRow(row)
    }
  }

  return [...byId.values()]
}

export function getPaymentRecordById(id) {
  reloadFromDisk()
  return records.get(String(id)) || null
}

export function getPaymentRecordByRazorpayOrderId(razorpayOrderId) {
  reloadFromDisk()
  const key = String(razorpayOrderId || '').trim()
  return [...records.values()].find((r) => String(r.razorpayOrderId) === key) || null
}

export function getPaymentRecordByInvoiceId(invoiceId) {
  reloadFromDisk()
  const key = String(invoiceId || '').trim()
  return [...records.values()].find((r) => String(r.invoiceId) === key) || null
}

export function createPendingPaymentRecord({
  customerEmail,
  customerId,
  razorpayOrderId,
  amountInr,
  lineItems,
  referenceNumber
}) {
  reloadFromDisk()
  const id = `pay_${Date.now()}_${Math.round(Math.random() * 1000)}`
  const row = {
    id,
    razorpayOrderId: String(razorpayOrderId),
    razorpayPaymentId: null,
    customerEmail: String(customerEmail || '').trim().toLowerCase(),
    customerId: String(customerId || ''),
    invoiceId: null,
    invoiceNumber: null,
    amountInr: Number(amountInr) || 0,
    method: 'razorpay',
    status: 'pending',
    paidAt: null,
    referenceNumber: referenceNumber || null,
    lineItems: lineItems || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  records.set(id, row)
  persist(row)
  return row
}

export function updatePaymentRecord(id, patch) {
  reloadFromDisk()
  const row = records.get(String(id))
  if (!row) return null
  const next = { ...row, ...patch, updatedAt: new Date().toISOString() }
  records.set(String(id), next)
  persist(next)
  return next
}

export function paymentsByInvoiceIdMap() {
  reloadFromDisk()
  const map = new Map()
  for (const row of records.values()) {
    if (row.invoiceId) map.set(String(row.invoiceId), row)
  }
  return map
}
