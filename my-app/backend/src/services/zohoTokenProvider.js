import { env } from '../config/env.js'
import { getZohoAccessToken } from './zohoAuthService.js'

/**
 * Resolves the OAuth access token for Zoho API calls.
 * Optional ZOHO_ACCESS_TOKEN env override (e.g. short-lived testing); otherwise uses refresh-token flow.
 */
export async function resolveZohoAccessToken() {
  const direct = env.ZOHO_ACCESS_TOKEN?.trim()
  if (direct) return direct
  return getZohoAccessToken()
}
