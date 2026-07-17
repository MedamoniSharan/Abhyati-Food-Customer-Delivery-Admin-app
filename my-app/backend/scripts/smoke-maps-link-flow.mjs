/**
 * E2E: customer maps link → checkout on invoice → driver sees mapsLink.
 * Usage: node scripts/smoke-maps-link-flow.mjs
 */
const base = process.env.SMOKE_API_BASE || 'http://localhost:3001'
const MAPS_LINK = 'https://maps.app.goo.gl/e2e-test-pin-abc123'

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
  const custEmail = `e2e.maps.${stamp}@example.com`
  const drvEmail = `e2e.maps.driver.${stamp}@example.com`
  const pass = 'TestPass123!'

  console.log('1) Admin login')
  const adminTok = (
    await j('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@abhyati.com', password: 'admin' })
    })
  ).token

  console.log('2) Create customer + driver')
  await j('/api/admin/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({
      fullName: `Maps Flow Customer ${stamp}`,
      email: custEmail,
      password: pass,
      mobile: '9876543210'
    })
  })
  await j('/api/admin/drivers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({
      fullName: `Maps Flow Driver ${stamp}`,
      email: drvEmail,
      password: pass
    })
  })

  console.log('3) Customer login + save address + maps link')
  let custTok = (
    await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: custEmail, password: pass }) })
  ).token
  const profile = await j('/api/auth/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${custTok}` },
    body: JSON.stringify({
      fullName: `Maps Flow Customer ${stamp}`,
      email: custEmail,
      mobile: '9876543210',
      deliveryAddress: '456 Maps Test Lane, Hyderabad, Telangana 500032',
      mapsLink: MAPS_LINK
    })
  })
  if (profile.user?.mapsLink !== MAPS_LINK) {
    throw new Error(`Profile mapsLink missing after save: ${JSON.stringify(profile.user)}`)
  }
  console.log('   profile mapsLink OK')

  console.log('4) Fetch catalog item + checkout')
  const items = await j('/api/customer/items?per_page=5', { headers: { Authorization: `Bearer ${custTok}` } })
  const item = items.items?.[0]
  if (!item?.item_id) throw new Error('No catalog items')
  const rate = Number(item.rate || item.sales_rate || 95)
  const orderRes = await j('/api/customer/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${custTok}` },
    body: JSON.stringify({
      line_items: [{ item_id: String(item.item_id), name: item.name, quantity: 1, rate }],
      reference_number: `maps-e2e-${stamp}`
    })
  })
  const invoiceId = String(orderRes.invoice?.invoice_id || '')
  const invNum = orderRes.invoice?.invoice_number
  if (!invoiceId) throw new Error('No invoice from checkout')

  const billStreet2 = orderRes.invoice?.billing_address?.street2 || orderRes.invoice?.shipping_address?.street2
  const notes = String(orderRes.invoice?.notes || '')
  const hasMapsInNotes = notes.includes('__abh_maps:') && notes.includes(MAPS_LINK)
  if (billStreet2 !== MAPS_LINK && !hasMapsInNotes) {
    throw new Error(`Invoice missing maps link. billing=${JSON.stringify(orderRes.invoice?.billing_address)} notes=${notes.slice(0, 120)}`)
  }
  console.log('   invoice', invNum, hasMapsInNotes ? 'maps in notes OK' : 'street2 maps link OK')

  console.log('5) Admin assign to driver')
  const assignRes = await j('/api/admin/delivery-assignments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ driver_email: drvEmail, invoice_id: invoiceId })
  })
  const asgId = assignRes.assignment?.id
  if (!asgId) throw new Error('No assignment id')

  console.log('6) Driver assignment detail has mapsLink')
  const drvTok = (
    await j('/api/delivery/login', { method: 'POST', body: JSON.stringify({ email: drvEmail, password: pass }) })
  ).token
  const detail = await j(`/api/delivery/assignments/${encodeURIComponent(asgId)}`, {
    headers: { Authorization: `Bearer ${drvTok}` }
  })
  const a = detail.assignment || {}
  if (a.mapsLink !== MAPS_LINK) {
    throw new Error(`Driver detail mapsLink expected ${MAPS_LINK}, got ${a.mapsLink}`)
  }
  if (a.mapsQuery !== MAPS_LINK) {
    throw new Error(`Driver mapsQuery should prefer maps link, got ${a.mapsQuery}`)
  }
  console.log('   mapsLink:', a.mapsLink)
  console.log('   mapsQuery:', a.mapsQuery)
  console.log('   address:', a.address)

  console.log('7) Driver list includes assignment')
  const list = await j('/api/delivery/assignments', { headers: { Authorization: `Bearer ${drvTok}` } })
  const row = (list.assignments || []).find((x) => x.id === asgId)
  if (!row) throw new Error('Assignment not in driver list')
  if (row.mapsLink !== MAPS_LINK) throw new Error('List row missing mapsLink')

  console.log('\nPASS — maps link flow: profile → invoice → driver')
  console.log('Customer:', custEmail, '/', pass)
  console.log('Driver:', drvEmail, '/', pass)
  console.log('Maps link:', MAPS_LINK)
}

main().catch((e) => {
  console.error('\nFAIL:', e.message)
  if (e.body) console.error(JSON.stringify(e.body, null, 2).slice(0, 1200))
  process.exit(1)
})
