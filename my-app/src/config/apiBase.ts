/**
 * Production backend (HTTPS). All API calls use this host unless `VITE_API_BASE_URL` is set.
 */
export const PUBLIC_API_BASE_URL =
  'https://abhyati-food-customer-delivery-admin-app.onrender.com'

function trimBase(url: string) {
  return url.trim().replace(/\/$/, '')
}

let loggedOnce = false

/** Logs resolved API bases once (useful for APK / device debugging). */
export function logApiCandidatesOnce(bases: string[]): void {
  if (loggedOnce) return
  loggedOnce = true
  const primary = bases[0] ?? PUBLIC_API_BASE_URL
  console.log('[API] API URL:', primary)
}

/** Backend origin(s). Dev defaults to same-origin (Vite proxy) unless `VITE_API_BASE_URL` is set. */
export function getApiBaseCandidates(): string[] {
  const fromEnv = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  if (fromEnv) return [fromEnv]
  if (import.meta.env.DEV) return ['']
  return [PUBLIC_API_BASE_URL]
}
