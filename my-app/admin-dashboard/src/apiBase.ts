/**
 * Backend origin for API calls (no trailing slash).
 * - Set `VITE_API_BASE_URL` in `.env` (e.g. `http://localhost:3001` — match `PORT` in `my-app/backend/.env`).
 * - Leave unset to use same-origin `/api/...`; in dev, Vite proxies `/api` to `VITE_PROXY_TARGET` (see vite.config.ts).
 */
export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (!raw || typeof raw !== 'string') return ''
  return raw.replace(/\/$/, '').trim()
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = apiBase()
  if (!base) return p
  return `${base}${p}`
}
