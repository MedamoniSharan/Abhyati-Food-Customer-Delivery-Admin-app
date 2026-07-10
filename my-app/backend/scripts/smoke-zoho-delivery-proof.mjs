/**
 * Smoke: delivery proof stored only in Zoho Books (no local delivery-proofs files).
 * Usage: node scripts/smoke-zoho-delivery-proof.mjs
 * Requires: backend on SMOKE_API_BASE (default http://localhost:3001), Zoho + admin/driver in .env
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.SMOKE_API_BASE || 'http://localhost:3001'
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROOFS_DIR = join(__dirname, '..', 'data', 'delivery-proofs')

/** Minimal valid 1x1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function j(path, opts = {}) {
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${String(text).slice(0, 800)}`)
    err.body = body
    err.status = res.status
    throw err
  }
  return body
}

function countProofFilesOnDisk() {
  if (!existsSync(PROOFS_DIR)) return 0
  let n = 0
  for (const entry of readdirSync(PROOFS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = join(PROOFS_DIR, entry.name)
      for (const f of readdirSync(sub)) {
        if (!f.startsWith('.')) n += 1
      }
    } else if (!entry.name.startsWith('.')) {
      n += 1
    }
  }
  return n
}

async function multipartProof(stopId, token) {
  const form = new FormData()
  form.append('recipient_name', 'Smoke Test Recipient')
  form.append('notes', 'Zoho-only proof smoke test')
  form.append('photo', new Blob([TINY_PNG], { type: 'image/png' }), 'smoke-invoice.png')
  form.append('signature', new Blob([TINY_PNG], { type: 'image/png' }), 'smoke-signature.png')

  const res = await fetch(`${base}/api/delivery/assignments/${encodeURIComponent(stopId)}/proof`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  if (!res.ok) {
    const err = new Error(`Proof upload HTTP ${res.status}: ${String(text).slice(0, 800)}`)
    err.body = body
    throw err
  }
  return body
}

async function fetchBinary(path, token) {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return { size: buf.length, contentType: res.headers.get('content-type') || '' }
}

async function main() {
  const filesBefore = countProofFilesOnDisk()
  console.log('1) Health')
  await j('/health')

  console.log('2) Admin login')
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@abhyati.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin'
  const adminTok = (await j('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  })).token

  const stamp = Date.now()
  const drvEmail = process.env.SMOKE_DRIVER_EMAIL || `smoke.proof.driver.${stamp}@example.com`
  const drvPass = 'TestPass123'
  const custEmail = process.env.SMOKE_CUSTOMER_EMAIL || `smoke.proof.cust.${stamp}@example.com`
  const custPass = 'TestPass123'

  console.log('3) Create driver + customer (admin)')
  await j('/api/admin/drivers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ fullName: `Proof Smoke Driver ${stamp}`, email: drvEmail, password: drvPass })
  })
  await j('/api/admin/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({
      fullName: `Proof Smoke Customer ${stamp}`,
      email: custEmail,
      password: custPass,
      mobile: '9999999999'
    })
  })

  console.log('4) Customer login + place order')
  const custTok = (
    await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: custEmail, password: custPass }) })
  ).token
  const items = await j('/api/customer/items?per_page=5', {
    headers: { Authorization: `Bearer ${custTok}` }
  })
  const first = items?.items?.[0]
  if (!first?.item_id) throw new Error('No Zoho items for customer checkout')
  const orderRes = await j('/api/customer/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      line_items: [{ item_id: String(first.item_id), quantity: 1, rate: Number(first.rate) || 1 }]
    })
  })
  const invoiceId = String(orderRes?.invoice?.invoice_id || orderRes?.order?.invoiceId || '')
  if (!invoiceId) throw new Error('No invoice_id from checkout')

  console.log('5) Assign to driver')
  const assignRes = await j('/api/admin/delivery-assignments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ driver_email: drvEmail, invoice_id: invoiceId })
  })
  const assignmentId = assignRes.assignment?.id
  if (!assignmentId) throw new Error('No assignment id')

  const drvTok = (
    await j('/api/delivery/login', { method: 'POST', body: JSON.stringify({ email: drvEmail, password: drvPass }) })
  ).token
  const driverAssignmentsAfterAssign = await j('/api/delivery/assignments', {
    headers: { Authorization: `Bearer ${drvTok}` }
  })
  const pendingForDriver = (driverAssignmentsAfterAssign.assignments || []).find(
    (row) => String(row.id) === String(assignmentId)
  )
  if (!pendingForDriver) throw new Error('Driver cannot see assigned order after admin assign')
  console.log('   driver sees assignment, status:', pendingForDriver.status)

  console.log('6) Driver accept + upload proof (Zoho only)')
  await j(`/api/delivery/assignments/${encodeURIComponent(assignmentId)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${drvTok}` }
  })
  const proofRes = await multipartProof(assignmentId, drvTok)
  const sigDocId = proofRes.assignment?.proof?.signatureDocumentId
  if (!sigDocId) throw new Error('proof.signatureDocumentId missing — signature not stored in Zoho')
  console.log('   signatureDocumentId', sigDocId)

  const filesAfter = countProofFilesOnDisk()
  if (filesAfter > filesBefore) {
    throw new Error(
      `Local delivery-proofs grew (${filesBefore} → ${filesAfter}). Proof must not write to disk.`
    )
  }
  console.log('   local delivery-proofs file count unchanged:', filesAfter)

  console.log('7) Admin fetch proof from Zoho via API')
  const photo = await fetchBinary(
    `/api/admin/delivery-assignments/${encodeURIComponent(assignmentId)}/proof/photo`,
    adminTok
  )
  const sig = await fetchBinary(
    `/api/admin/delivery-assignments/${encodeURIComponent(assignmentId)}/proof/signature`,
    adminTok
  )
  if (photo.size < 50) throw new Error(`Photo too small (${photo.size} bytes)`)
  if (sig.size < 50) throw new Error(`Signature too small (${sig.size} bytes)`)
  console.log('   photo bytes', photo.size, 'signature bytes', sig.size)

  console.log('8) Customer proof summary + photo')
  const custProofTok = (
    await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: custEmail, password: custPass }) })
  ).token
  const summary = await j(`/api/customer/orders/${encodeURIComponent(invoiceId)}/proof/summary`, {
    headers: { Authorization: `Bearer ${custProofTok}` }
  })
  if (!summary.summary?.hasSignature) throw new Error('Customer summary missing hasSignature')
  const custPhoto = await fetchBinary(
    `/api/customer/orders/${encodeURIComponent(invoiceId)}/proof/photo`,
    custProofTok
  )
  console.log('   customer photo bytes', custPhoto.size)

  console.log('9) Admin assignment list shows delivered')
  const adminAssignments = await j('/api/admin/delivery-assignments', {
    headers: { Authorization: `Bearer ${adminTok}` }
  })
  const adminRow = (adminAssignments.assignments || []).find((row) => String(row.id) === String(assignmentId))
  if (!adminRow) throw new Error('Assignment missing from admin delivery-assignments list')
  if (String(adminRow.status).toLowerCase() !== 'delivered') {
    throw new Error(`Admin assignment status expected delivered, got ${adminRow.status}`)
  }
  console.log('   admin assignment status:', adminRow.status, 'driver:', adminRow.driverEmail || adminRow.driver_email)

  console.log('10) Customer orders list shows Delivered')
  const customerOrders = await j('/api/customer/orders', {
    headers: { Authorization: `Bearer ${custProofTok}` }
  })
  const customerOrder = (customerOrders.orders || []).find((row) => String(row.invoiceId || row.id) === invoiceId)
  if (!customerOrder) throw new Error('Order missing from customer orders list')
  if (customerOrder.status !== 'Delivered') {
    throw new Error(`Customer order status expected Delivered, got ${customerOrder.status}`)
  }
  if (!customerOrder.proofAvailable) throw new Error('Customer order proofAvailable should be true')
  console.log('   customer order status:', customerOrder.status, 'proofAvailable:', customerOrder.proofAvailable)

  console.log('\nPASS — full delivery flow: order → assign → accept → proof → admin + customer updated')
}

main().catch((e) => {
  console.error('\nFAIL:', e.message)
  if (e.body) console.error(JSON.stringify(e.body, null, 2).slice(0, 1200))
  process.exit(1)
})
