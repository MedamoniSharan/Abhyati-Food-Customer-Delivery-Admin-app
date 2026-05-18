import { Capacitor } from '@capacitor/core'

/**
 * Production backend (HTTPS). In Vite dev, localhost is tried first unless `VITE_API_BASE_URL` is set.
 */
export const PUBLIC_API_BASE_URL = 'https://abhyati-food-customer-app.onrender.com'

function trimBase(url: string) {
  return url.trim().replace(/\/$/, '')
}

function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

let loggedOnce = false

export function logApiCandidatesOnce(bases: string[]): void {
  if (loggedOnce) return
  loggedOnce = true
  const primary = bases[0] ?? PUBLIC_API_BASE_URL
  console.log('[API] API URL:', primary)
  if (bases.length > 1) {
    console.log('[API] fallback bases:', bases.slice(1).join(', '))
  }
}

export function getApiBaseCandidates(): string[] {
  const isNative = Capacitor.isNativePlatform()
  const fromEnv = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const preferLocalDev = !isNative && import.meta.env.DEV && !fromEnv

  const list: string[] = []

  const push = (raw: string) => {
    const u = trimBase(raw)
    if (!u) return
    if (isNative) {
      if (u.startsWith('http:') && !isLocalhostUrl(u)) {
        return
      }
    }
    if (!list.includes(u)) list.push(u)
  }

  if (fromEnv) {
    push(fromEnv)
  }

  if (preferLocalDev) {
    push('http://localhost:3001')
    push('http://localhost:4000')
  }

  push(PUBLIC_API_BASE_URL)

  if (!isNative && !preferLocalDev) {
    push('http://localhost:3001')
    push('http://localhost:4000')
  }

  return list
}
