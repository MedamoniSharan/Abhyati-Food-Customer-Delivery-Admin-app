/**
 * E2E smoke: admin creates customer → customer creates Razorpay order → verify signature endpoint rejects bad sig.
 * Usage: node scripts/smoke-razorpay-order.mjs
 * Requires: backend running (default http://localhost:3001), RAZORPAY_* in .env, Zoho configured
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
    const err = new Error(`HTTP ${res.status}: ${String(text).slice(0, 800)}`)
    err.body = body
    err.status = res.status
    throw err
  }
  return body
}

async function main() {
  const stamp = Date.now()
  const custEmail = `e2e.rzp.${stamp}@example.com`
  const custPass = 'TestPass123'

  console.log('1) Health')
  await j('/health')
  console.log('   OK')

  console.log('2) Admin login')
  const adminTok = (
    await j('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL || 'admin@abhyati.com',
        password: process.env.ADMIN_PASSWORD || 'admin'
      })
    })
  ).token
  console.log('   admin token OK')

  console.log('3) Create test customer')
  await j('/api/admin/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({
      fullName: `E2E Razorpay Customer ${stamp}`,
      email: custEmail,
      password: custPass,
      mobile: '9876543210'
    })
  })
  console.log('  ', custEmail)

  console.log('4) Customer login')
  const custTok = (
    await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: custEmail, password: custPass }) })
  ).token
  console.log('   customer token OK')

  console.log('5) Fetch catalog item')
  const items = await j('/api/customer/items?per_page=5', { headers: { Authorization: `Bearer ${custTok}` } })
  const list = items.items || []
  if (!list.length) throw new Error('No Zoho items in /api/customer/items')
  const item = list[0]
  const itemId = String(item.item_id || '')
  const rate = Number(item.rate || item.sales_rate || 100)
  console.log('   item', itemId, 'rate', rate)

  console.log('6) POST /api/customer/payments/razorpay/order')
  const rzp = await j('/api/customer/payments/razorpay/order', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custTok}` },
    body: JSON.stringify({
      line_items: [{ item_id: itemId, quantity: 1, rate }]
    })
  })
  if (!rzp.key_id || !rzp.order_id || !rzp.amount) {
    throw new Error('Razorpay order response missing key_id/order_id/amount: ' + JSON.stringify(rzp))
  }
  console.log('   order_id', rzp.order_id, 'amount_paise', rzp.amount, 'key_id', rzp.key_id.slice(0, 12) + '...')

  console.log('7) POST verify with bad signature (expect 401)')
  try {
    await j('/api/customer/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custTok}` },
      body: JSON.stringify({
        razorpay_order_id: rzp.order_id,
        razorpay_payment_id: 'pay_fake',
        razorpay_signature: 'invalid_signature'
      })
    })
    throw new Error('Expected 401 for invalid signature')
  } catch (e) {
    if (e.status !== 401) throw e
    console.log('   correctly rejected invalid signature')
  }

  console.log('8) Pay later checkout still works')
  const order = await j('/api/customer/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custTok}` },
    body: JSON.stringify({
      line_items: [{ item_id: itemId, quantity: 1, rate }]
    })
  })
  if (!order.invoice && !order.order) throw new Error('Pay later order missing invoice/order')
  console.log('   invoice', order.invoice?.invoice_number || order.order?.invoiceNumber || 'created')

  console.log('\nAll Razorpay smoke checks passed.')
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  if (e.body) console.error(JSON.stringify(e.body, null, 2))
  process.exit(1)
})
