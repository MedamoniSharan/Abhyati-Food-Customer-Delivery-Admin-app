/**
 * Backend origin for API calls (no trailing slash).
 * Defaults to Render production API; override with `VITE_API_BASE_URL` if needed.
 */
export const PUBLIC_API_BASE_URL =
  'https://abhyati-food-customer-delivery-admin-app.onrender.com'

export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && typeof raw === 'string' && raw.trim()) {
    return raw.replace(/\/$/, '').trim()
  }
  return PUBLIC_API_BASE_URL
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}${p}`
}
