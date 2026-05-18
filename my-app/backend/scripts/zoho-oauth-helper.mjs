/**
 * Zoho OAuth helpers (terminal only — no Express).
 *
 * From my-app/backend:
 *
 *   1) Test current refresh token → short-lived access token
 *      npm run zoho:test-token
 *
 *   2) Print browser URL to obtain a grant `code` (must match redirect URI in Zoho API Console)
 *      npm run zoho:oauth-url
 *      Optional: ZOHO_OAUTH_REDIRECT_URI, ZOHO_OAUTH_SCOPE in .env
 *
 *   3) Exchange `code` from the redirect URL for a new refresh token (paste into ZOHO_REFRESH_TOKEN)
 *      npm run zoho:exchange-code -- --code=PASTE_CODE --redirect-uri=http://localhost:8080
 *
 * Region uses ZOHO_REGION from .env (in, com, eu, …) for accounts host.
 */
import axios from 'axios'
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const REGION = (process.env.ZOHO_REGION || 'in').trim()
const accountsHosts = {
  in: 'accounts.zoho.in',
  com: 'accounts.zoho.com',
  eu: 'accounts.zoho.eu',
  'com.au': 'accounts.zoho.com.au',
  jp: 'accounts.zoho.jp',
  'com.cn': 'accounts.zoho.com.cn'
}
const accountsBase = `https://${accountsHosts[REGION] || accountsHosts.in}`

const DEFAULT_SCOPE =
  process.env.ZOHO_OAUTH_SCOPE ||
  'ZohoBooks.fullaccess.all,ZohoBooks.settings.UPDATE,ZohoBooks.settings.CREATE,ZohoBooks.accountants.READ'

function argVal(name) {
  const p = process.argv.find((a) => a.startsWith(`${name}=`))
  return p ? decodeURIComponent(p.slice(name.length + 1).trim()) : ''
}

async function cmdTest() {
  const id = process.env.ZOHO_CLIENT_ID
  const sec = process.env.ZOHO_CLIENT_SECRET
  const rt = process.env.ZOHO_REFRESH_TOKEN
  if (!id || !sec || !rt) {
    console.error('Need ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN in backend/.env')
    process.exit(1)
  }
  const url = `${accountsBase}/oauth/v2/token`
  try {
    const { data } = await axios.post(url, null, {
      params: {
        refresh_token: rt,
        client_id: id,
        client_secret: sec,
        grant_type: 'refresh_token'
      }
    })
    console.log('OK — refresh token is valid.')
    console.log('  access_token (first 24 chars):', String(data.access_token || '').slice(0, 24), '…')
    console.log('  expires_in_sec:', data.expires_in)
    console.log('  api_domain:', data.api_domain || '(n/a)')
  } catch (e) {
    const d = e?.response?.data
    console.error('Refresh failed:', d || e.message)
    process.exit(1)
  }
}

function cmdAuthUrl() {
  const id = process.env.ZOHO_CLIENT_ID
  const ru = (process.env.ZOHO_OAUTH_REDIRECT_URI || 'http://localhost:8080').trim()
  if (!id) {
    console.error('Set ZOHO_CLIENT_ID in backend/.env')
    process.exit(1)
  }
  const scope = DEFAULT_SCOPE
  const u = new URL(`${accountsBase}/oauth/v2/auth`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', id)
  u.searchParams.set('scope', scope)
  u.searchParams.set('redirect_uri', ru)
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  console.log('')
  console.log('Open this URL in a browser (logged into the right Zoho user):')
  console.log('')
  console.log(u.toString())
  console.log('')
  console.log('After approving, you will be redirected to your redirect_uri with ?code=...')
  console.log('That redirect URI must exactly match the one registered for this client in Zoho API Console.')
  console.log('Current redirect_uri:', ru)
  console.log('')
  console.log('Then run:')
  console.log(`  npm run zoho:exchange-code -- --code=THE_CODE --redirect-uri=${ru}`)
  console.log('')
}

async function cmdExchange() {
  const code = argVal('--code')
  const ru = argVal('--redirect-uri') || (process.env.ZOHO_OAUTH_REDIRECT_URI || 'http://localhost:8080').trim()
  const id = process.env.ZOHO_CLIENT_ID
  const sec = process.env.ZOHO_CLIENT_SECRET
  if (!code) {
    console.error('Usage: npm run zoho:exchange-code -- --code=... [--redirect-uri=...]')
    process.exit(1)
  }
  if (!id || !sec) {
    console.error('Need ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in backend/.env')
    process.exit(1)
  }
  const url = `${accountsBase}/oauth/v2/token`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id,
    client_secret: sec,
    redirect_uri: ru,
    code
  })
  try {
    const { data } = await axios.post(url, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    const rt = data.refresh_token
    if (!rt) {
      console.log('Response:', data)
      console.error('No refresh_token in response (need access_type=offline and a fresh consent).')
      process.exit(1)
    }
    console.log('')
    console.log('Paste this line into backend/.env (replace the old value):')
    console.log('')
    console.log(`ZOHO_REFRESH_TOKEN=${rt}`)
    console.log('')
    if (data.access_token) {
      console.log('(Short-lived access_token was also returned; the app only needs the refresh_token above.)')
    }
    console.log('')
  } catch (e) {
    console.error('Exchange failed:', e?.response?.data || e.message)
    process.exit(1)
  }
}

const cmd = process.argv[2] || 'help'
if (cmd === 'test') void cmdTest()
else if (cmd === 'auth-url') cmdAuthUrl()
else if (cmd === 'exchange') void cmdExchange()
else {
  console.log(`
Usage (from my-app/backend):
  npm run zoho:test-token          — verify ZOHO_REFRESH_TOKEN
  npm run zoho:oauth-url           — print browser URL to get a grant code
  npm run zoho:exchange-code -- --code=... [--redirect-uri=...]
`)
}
