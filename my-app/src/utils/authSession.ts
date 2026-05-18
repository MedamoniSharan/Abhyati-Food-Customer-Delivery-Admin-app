import type { AuthUser } from '../services/authApi'

const STORAGE_KEY = 'abhyati_food_signed_in'
const ROLE_KEY = 'abhyati_food_role'
const USER_KEY = 'abhyati_food_user_json'
const JWT_KEY = 'abhyati_food_auth_jwt'

export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(JWT_KEY)
  } catch {
    return null
  }
}

function writeAuthToken(token: string | null): void {
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
    const r = localStorage.getItem(ROLE_KEY)
    if (r === 'driver') {
      clearSignedIn()
      return false
    }
    if (!localStorage.getItem(JWT_KEY)) return false
    return true
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

export function writeSignedIn(user?: AuthUser, token?: string | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
    localStorage.setItem(ROLE_KEY, 'customer')
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    }
    if (token !== undefined) {
      writeAuthToken(token)
    }
  } catch {
    /* private mode / quota */
  }
}

export function clearSignedIn(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(JWT_KEY)
  } catch {
    /* ignore */
  }
}
