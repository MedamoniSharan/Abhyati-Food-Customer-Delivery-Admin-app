import axios from 'axios'
import { env } from '../config/env.js'
import { isZohoRateLimitError } from './zohoRateLimit.js'

let cachedToken = null
let tokenExpiresAt = 0
/** @type {Promise<string> | null} */
let refreshInFlight = null

const TOKEN_REFRESH_BUFFER_MS = 60_000
const MAX_TOKEN_RETRIES = 8
const TOKEN_RETRY_BASE_MS = 2000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchNewAccessToken() {
  const url = `${env.ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token`
  let attempt = 0

  while (true) {
    try {
      const response = await axios.post(url, null, {
        params: {
          refresh_token: env.ZOHO_REFRESH_TOKEN,
          client_id: env.ZOHO_CLIENT_ID,
          client_secret: env.ZOHO_CLIENT_SECRET,
          grant_type: 'refresh_token'
        }
      })

      if (response.data?.error) {
        const err = new Error(
          response.data.error_description || response.data.error || 'Zoho token refresh failed'
        )
        err.response = { status: 400, data: response.data }
        throw err
      }

      const token = response.data.access_token
      if (!token) {
        throw new Error('Zoho token refresh returned no access_token')
      }

      cachedToken = token
      tokenExpiresAt = Date.now() + (response.data.expires_in || 3600) * 1000
      return cachedToken
    } catch (err) {
      if (!isZohoRateLimitError(err) || attempt >= MAX_TOKEN_RETRIES) throw err
      const delay = TOKEN_RETRY_BASE_MS * 2 ** attempt
      await sleep(delay)
      attempt += 1
    }
  }
}

export async function getZohoAccessToken() {
  const now = Date.now()
  if (cachedToken && tokenExpiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken
  }

  if (!refreshInFlight) {
    refreshInFlight = fetchNewAccessToken().finally(() => {
      refreshInFlight = null
    })
  }

  return refreshInFlight
}
