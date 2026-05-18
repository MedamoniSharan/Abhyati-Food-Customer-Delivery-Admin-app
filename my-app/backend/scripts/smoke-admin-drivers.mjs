/**
 * Smoke-test admin driver APIs against a running backend.
 *
 * Usage (from my-app/backend):
 *   node scripts/smoke-admin-drivers.mjs
 *
 * Env (optional, defaults match backend .env / env.js):
 *   API_BASE_URL=http://localhost:3001
 *   ADMIN_EMAIL=admin@abhyati.com
 *   ADMIN_PASSWORD=admin
 *   TEST_DRIVER_EMAIL= — set to skip POST /drivers (avoid duplicate driver)
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

  const listRes = await fetch(`${base}/api/admin/drivers`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const listText = await listRes.text()
  if (!listRes.ok) {
    console.error('GET /api/admin/drivers failed', listRes.status, listText.slice(0, 800))
    process.exit(1)
  }
  const listJson = JSON.parse(listText)
  const drivers = Array.isArray(listJson.drivers) ? listJson.drivers : []
  console.log('GET /api/admin/drivers OK, count:', drivers.length)
  if (drivers.length > 0) {
    console.log('  sample:', { email: drivers[0].email, zohoContactId: drivers[0].zohoContactId })
  }

  const testEmail = process.env.TEST_DRIVER_EMAIL
  if (!testEmail) {
    console.log('Set TEST_DRIVER_EMAIL to run POST /api/admin/drivers (creates Zoho contact + app login).')
    return
  }

  const suffix = Date.now()
  const email = testEmail.includes('@') ? testEmail : `driver-smoke-${suffix}@example.com`
  const body = {
    fullName: `Smoke Driver ${suffix}`,
    email,
    password: 'SmokeTest1'
  }
  const createRes = await fetch(`${base}/api/admin/drivers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const createText = await createRes.text()
  if (!createRes.ok) {
    console.error('POST /api/admin/drivers failed', createRes.status, createText.slice(0, 800))
    process.exit(1)
  }
  const created = JSON.parse(createText)
  console.log('POST /api/admin/drivers OK', created.driver)

  const list2 = await fetch(`${base}/api/admin/drivers`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const list2Json = JSON.parse(await list2.text())
  const n = list2Json.drivers?.length ?? 0
  console.log('GET /api/admin/drivers after create, count:', n)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
