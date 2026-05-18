/**
 * Smoke-test admin customer APIs (Zoho-backed list + optional create).
 *
 * Usage (from my-app/backend):
 *   npm run smoke:customers
 *
 * Optional:
 *   TEST_CUSTOMER_EMAIL=1   — POST a new customer (random @example.com) with app login
 *   API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD — same as smoke-admin-drivers.mjs
 */
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const base = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const adminEmail = process.env.ADMIN_EMAIL || 'admin@abhyati.com'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin'

async function main() {
  console.log('API base:', base)

  const loginRes = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  })
  const loginText = await loginRes.text()
  if (!loginRes.ok) {
    console.error('POST /api/admin/login failed', loginRes.status, loginText.slice(0, 500))
    process.exit(1)
  }
  const { token } = JSON.parse(loginText)
  if (!token) {
    console.error('No token in login response')
    process.exit(1)
  }
  console.log('POST /api/admin/login OK')

  const listRes = await fetch(`${base}/api/admin/customers?page=1&per_page=200&sort=asc`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const listText = await listRes.text()
  if (!listRes.ok) {
    console.error('GET /api/admin/customers failed', listRes.status, listText.slice(0, 800))
    process.exit(1)
  }
  const listJson = JSON.parse(listText)
  const customers = Array.isArray(listJson.customers) ? listJson.customers : []
  const withLogin = customers.filter((c) => c.has_app_login).length
  console.log(
    'GET /api/admin/customers OK, this page:',
    customers.length,
    'zoho_total:',
    listJson.total,
    'has_more:',
    listJson.has_more_page,
    'with app login on page:',
    withLogin
  )
  if (customers.length > 0) {
    const s = customers[0]
    console.log('  first row:', {
      email: s.email,
      contact_name: s.contact_name,
      mobile: s.mobile,
      has_app_login: s.has_app_login,
      contact_id: s.contact_id
    })
  }

  const flag = process.env.TEST_CUSTOMER_EMAIL
  if (!flag) {
    console.log('Set TEST_CUSTOMER_EMAIL=1 to POST /api/admin/customers (creates Zoho contact + app login).')
    return
  }

  const suffix = Date.now()
  const email = flag.includes('@') ? flag : `customer-smoke-${suffix}@example.com`
  const body = {
    fullName: `Smoke Customer ${suffix}`,
    email,
    password: 'SmokeTest1',
    mobile: '+919876543210'
  }
  const createRes = await fetch(`${base}/api/admin/customers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const createText = await createRes.text()
  if (!createRes.ok) {
    console.error('POST /api/admin/customers failed', createRes.status, createText.slice(0, 800))
    process.exit(1)
  }
  const created = JSON.parse(createText)
  console.log('POST /api/admin/customers OK', { user: created.user, zoho_contact_id: created.zoho_contact_id })

  const list2 = await fetch(
    `${base}/api/admin/customers?search=${encodeURIComponent(email)}&per_page=50&sort=asc`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  )
  const list2Json = JSON.parse(await list2.text())
  const rows = Array.isArray(list2Json.customers) ? list2Json.customers : []
  const hit = rows.find((r) => String(r.email || '').toLowerCase() === email.toLowerCase())
  console.log('GET /api/admin/customers (search) after create, rows:', rows.length, 'zoho_total:', list2Json.total)
  console.log(
    '  created row:',
    hit
      ? { email: hit.email, mobile: hit.mobile, has_app_login: hit.has_app_login, contact_id: hit.contact_id }
      : 'NOT FOUND (check Zoho + server logs)'
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
