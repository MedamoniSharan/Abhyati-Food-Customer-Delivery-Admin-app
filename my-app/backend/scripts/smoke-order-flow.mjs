/**
 * E2E: admin creates customer + driver → customer checkout → admin assigns invoice → driver sees assignment.
 * Usage: node scripts/smoke-order-flow.mjs
 * Requires: backend running (default http://localhost:3001), Zoho configured, ADMIN_EMAIL/PASSWORD in .env
 */
const base = process.env.SMOKE_API_BASE || 'http://localhost:3001'

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
    const err = new Error(`HTTP ${res.status}: ${String(text).slice(0, 600)}`)
    err.body = body
    err.status = res.status
    throw err
  }
  return body
}

async function main() {
  const stamp = Date.now()
  const custEmail = `e2e.customer.${stamp}@example.com`
  const drvEmail = `e2e.driver.${stamp}@example.com`
  const custPass = 'TestPass123'
  const drvPass = 'TestPass123'

  console.log('1) Health')
  const h = await j('/health')
  console.log('   OK', JSON.stringify(h).slice(0, 160))

  console.log('2) Admin login')
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@abhyati.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin'
  const adminTok = (
    await j('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    })
  ).token
  console.log('   admin token length', adminTok.length)

  console.log('3) Create test customer')
  await j('/api/admin/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({
      fullName: `E2E Flow Customer ${stamp}`,
      email: custEmail,
      password: custPass,
      mobile: '9999999999'
    })
  })
  console.log('   ', custEmail)

  console.log('4) Create test driver')
  await j('/api/admin/drivers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ fullName: `E2E Flow Driver ${stamp}`, email: drvEmail, password: drvPass })
  })
  console.log('   ', drvEmail)

  console.log('5) Customer login')
  const custTok = (
    await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: custEmail, password: custPass }) })
  ).token

  console.log('6) Fetch catalog item')
  const items = await j('/api/customer/items?per_page=5', { headers: { Authorization: `Bearer ${custTok}` } })
  const list = items.items || []
  if (!list.length) throw new Error('No Zoho items in /api/customer/items')
  const item = list[0]
  const itemId = String(item.item_id)
  const rate = Number(item.rate) || 1
  console.log('   ', itemId, item.name, 'rate', rate)

  console.log('7) Checkout')
  const orderRes = await j('/api/customer/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custTok}` },
    body: JSON.stringify({
      line_items: [{ item_id: itemId, name: String(item.name || 'Item'), quantity: 1, rate }],
      reference_number: `e2e-${stamp}`
    })
  })
  const inv = orderRes.invoice
  const invoiceId = inv && String(inv.invoice_id || '')
  if (!invoiceId) throw new Error(`No invoice in response: ${JSON.stringify(orderRes).slice(0, 500)}`)
  console.log('   invoice_id', invoiceId, 'invoice_number', inv.invoice_number)

  console.log('8) Admin assign to driver')
  const assignRes = await j('/api/admin/delivery-assignments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ driver_email: drvEmail, invoice_id: invoiceId })
  })
  console.log('   assignment', assignRes.assignment?.id)

  console.log('9) Driver sees assignment')
  const drvTok = (
    await j('/api/delivery/login', { method: 'POST', body: JSON.stringify({ email: drvEmail, password: drvPass }) })
  ).token
  const das = await j('/api/delivery/assignments', { headers: { Authorization: `Bearer ${drvTok}` } })
  const mine = (das.assignments || []).filter((a) => String(a.invoiceId) === invoiceId)
  if (!mine.length) {
    throw new Error(`Driver list missing invoice ${invoiceId}: ${JSON.stringify(das).slice(0, 500)}`)
  }
  console.log('   ', mine[0].id, 'status', mine[0].status)

  console.log('\nPASS — full flow exercised against', base)
}

main().catch((e) => {
  console.error('\nFAIL:', e.message)
  if (e.body) console.error(e.body)
  process.exit(1)
})
