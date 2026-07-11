import type { AuthUser } from '../services/authApi'

const STORAGE_KEY = 'abhyati_delivery_signed_in'
const USER_KEY = 'abhyati_delivery_user_json'
const JWT_KEY = 'abhyati_delivery_auth_jwt'
const ACTIVITY_KEY = 'abhyati_delivery_last_activity'

/** Fired when an API returns 401 (expired / invalid JWT) or idle timeout elapses. */
export const DRIVER_SESSION_LOST_EVENT = 'abhyati-delivery-session-lost'

/** Auto-logout after this much inactivity (touch, click, key, scroll, visibility). */
export const DRIVER_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours

export function notifyDriverSessionLost(reason: 'unauthorized' | 'idle' = 'unauthorized'): void {
  try {
    window.dispatchEvent(new CustomEvent(DRIVER_SESSION_LOST_EVENT, { detail: { reason } }))
  } catch {
    /* ignore */
  }
}

export function touchSessionActivity(): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

export function readLastActivityAt(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function isSessionIdleExpired(now = Date.now()): boolean {
  const last = readLastActivityAt()
  if (last == null) return false
  return now - last >= DRIVER_IDLE_TIMEOUT_MS
}

export function readDriverToken(): string | null {
  try {
    return localStorage.getItem(JWT_KEY)
  } catch {
    return null
  }
}

function writeDriverToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(JWT_KEY, token)
    else localStorage.removeItem(JWT_KEY)
  } catch {
    /* ignore */
  }
}

export function readSignedIn(): boolean {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== '1') return false
    return Boolean(localStorage.getItem(JWT_KEY))
  } catch {
    return false
  }
}

export function readSessionUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    if (u && typeof u.email === 'string' && typeof u.fullName === 'string' && typeof u.id === 'string') return u
    return null
  } catch {
    return null
  }
}

export function writeSignedIn(user: AuthUser, token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    writeDriverToken(token)
    touchSessionActivity()
  } catch {
    /* private mode / quota */
  }
}

export function clearSignedIn(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(JWT_KEY)
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    /* ignore */
  }
}
