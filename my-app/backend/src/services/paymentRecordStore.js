import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('payments')

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '..', 'data', 'payment-records.json')

const records = new Map()

function reloadFromDisk() {
  records.clear()
  load()
}

function persist() {
  try {
    const dir = dirname(FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(FILE, JSON.stringify([...records.values()]), 'utf8')
  } catch (err) {
    log.error('Payment record persist failed', serializeError(err))
  }
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
  persist()
  return row
}

export function updatePaymentRecord(id, patch) {
  reloadFromDisk()
  const row = records.get(String(id))
  if (!row) return null
  const next = { ...row, ...patch, updatedAt: new Date().toISOString() }
  records.set(String(id), next)
  persist()
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
