import type { AuthUser } from '../services/authApi'

const STORAGE_KEY = 'abhyati_delivery_signed_in'
const USER_KEY = 'abhyati_delivery_user_json'
const JWT_KEY = 'abhyati_delivery_auth_jwt'

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
  } catch {
    /* private mode / quota */
  }
}

export function clearSignedIn(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(JWT_KEY)
  } catch {
    /* ignore */
  }
}
