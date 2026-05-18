import axios from 'axios'
import { env } from '../config/env.js'

let cachedToken = null
let tokenExpiresAt = 0

export async function getZohoAccessToken() {
  const now = Date.now()
  if (cachedToken && tokenExpiresAt > now + 30_000) {
    return cachedToken
  }

  const url = `${env.ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token`
  const response = await axios.post(url, null, {
    params: {
      refresh_token: env.ZOHO_REFRESH_TOKEN,
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token'
    }
  })

  cachedToken = response.data.access_token
  tokenExpiresAt = now + (response.data.expires_in || 3600) * 1000
  return cachedToken
}
