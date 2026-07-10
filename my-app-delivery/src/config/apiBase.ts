/**
 * Production backend (HTTPS). All API calls use this host unless `VITE_API_BASE_URL` is set.
 */
export const PUBLIC_API_BASE_URL =
  'https://abhyati-food-customer-delivery-admin-app.onrender.com'

function trimBase(url: string) {
  return url.trim().replace(/\/$/, '')
}

let loggedOnce = false

export function logApiCandidatesOnce(bases: string[]): void {
  if (loggedOnce) return
  loggedOnce = true
  const primary = bases[0] ?? PUBLIC_API_BASE_URL
  console.log('[API] API URL:', primary)
}

/** Single backend origin — always the direct API (Render), unless overridden in env. */
export function getApiBaseCandidates(): string[] {
  const fromEnv = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const base = fromEnv || PUBLIC_API_BASE_URL
  return [base]
}
