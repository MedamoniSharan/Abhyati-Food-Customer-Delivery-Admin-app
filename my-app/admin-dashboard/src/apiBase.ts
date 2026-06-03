/**
 * Backend origin for API calls (no trailing slash).
 * In dev, defaults to same-origin `/api` (Vite proxy → localhost:3001).
 * In production builds, defaults to Render unless `VITE_API_BASE_URL` is set.
 */
export const PUBLIC_API_BASE_URL =
  'https://abhyati-food-customer-delivery-admin-app.onrender.com'

export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && typeof raw === 'string' && raw.trim()) {
    return raw.replace(/\/$/, '').trim()
  }
  if (import.meta.env.DEV) {
    return ''
  }
  return PUBLIC_API_BASE_URL
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}${p}`
}
