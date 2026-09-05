import { getApiBaseCandidates, logApiCandidatesOnce } from '../config/api'
import { clientAudit } from '../utils/clientAudit'

export type AuthUser = {
  id: string
  fullName: string
  email: string
  mobile?: string
  /** Billing/shipping address formatted from Zoho Books contact */
  deliveryAddress?: string
  /** Google Maps share link saved on the Zoho contact (optional). */
  mapsLink?: string
}

const API_BASE_URL_CANDIDATES = getApiBaseCandidates()

type LoginResponse = {
  message: string
  user: AuthUser
  token?: string
}

/** Thrown for 4xx responses so we do not fall back to another API base (wrong password vs wrong host). */
class AuthClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthClientError'
  }
}

const FETCH_TIMEOUT_MS = 45_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const t = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(t)
  }
}

type ParsedBody = {
  message?: string
  user?: AuthUser
  token?: string
  mobile?: string
  requestId?: string
  zoho?: { message?: string }
  zoho_auth_hint?: string
}

function parseJsonBody(text: string): ParsedBody {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as ParsedBody
  } catch {
    return {}
  }
}

function formatAuthErrorMessage(data: ParsedBody, status: number): string {
  let msg = data.message || `Request failed with status ${status}`
  const zm = data.zoho?.message
  if (typeof zm === 'string' && zm.trim()) msg = zm.trim()
  const hint = data.zoho_auth_hint
  if (typeof hint === 'string' && hint.trim()) return `${msg}. ${hint.trim()}`
  if (status === 502) {
    return `${msg} Start the backend (cd my-app/backend && npm run dev) and use VITE_API_BASE_URL=http://localhost:3001 in my-app/.env.`
  }
  return msg
}

async function authRequest(
  path: string,
  payload: Record<string, string | undefined>,
  options?: { expectUser?: boolean }
): Promise<LoginResponse & { mobile?: string; requestId?: string; correlationId?: string }> {
  const expectUser = options?.expectUser !== false
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
      clientAudit('auth.request', 'info', { path, baseUrl: baseUrl || '(vite-proxy)' })
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const text = await response.text()
      const data = parseJsonBody(text)
      const correlationId = response.headers.get('x-request-id') || undefined

      if (!response.ok) {
        const msg = formatAuthErrorMessage(data, response.status)
        clientAudit('auth.request', 'fail', {
          path,
          status: response.status,
          message: msg,
          correlationId,
          msg91RequestId: data.requestId
        })
        if (response.status >= 400 && response.status < 500) {
          throw new AuthClientError(msg)
        }
        throw new Error(msg)
      }

      if (expectUser && !data.user) {
        throw new Error('Invalid response from server')
      }

      clientAudit('auth.request', 'ok', {
        path,
        status: response.status,
        correlationId,
        msg91RequestId: data.requestId,
        mobile: data.mobile
      })

      return {
        message: data.message || 'OK',
        user: data.user as AuthUser,
        token: data.token,
        mobile: typeof data.mobile === 'string' ? data.mobile : undefined,
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
        correlationId
      }
    } catch (error) {
      if (error instanceof AuthClientError) {
        throw new Error(error.message)
      }
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const isAbort = error instanceof Error && error.name === 'AbortError'
      console.warn('[API] auth request failed', { baseUrl, path, isAbort, message })
      clientAudit('auth.request', 'fail', { path, baseUrl, isAbort, message })
    }
  }

  const err = lastError instanceof Error ? lastError : new Error('Unable to reach auth API')
  if (err.name === 'AbortError') {
    console.error('[API] auth: request timed out — server may be cold-starting (e.g. Render free tier)')
  } else {
    console.error('[API] auth: all bases failed', path, err)
  }
  throw new Error(
    err.name === 'AbortError'
      ? 'Request timed out. The server may be waking up — wait a moment and try again.'
      : err.message.includes('Failed to fetch') || err.message.includes('NetworkError')
        ? 'Cannot reach the server. Check internet and that the backend URL is correct.'
        : err.message
  )
}

export async function loginCustomer(payload: { email: string; password: string }): Promise<LoginResponse> {
  return authRequest('/api/auth/login', payload)
}

export type SignupPayload = {
  fullName: string
  email: string
  password: string
  mobile: string
  otp: string
  deliveryAddress?: string
  mapsLink?: string
}

export async function sendSignupOtp(
  mobile: string
): Promise<{ message: string; requestId?: string; correlationId?: string }> {
  const result = await authRequest('/api/auth/otp/send', { mobile: mobile.trim() }, { expectUser: false })
  return {
    message: result.message,
    requestId: result.requestId,
    correlationId: result.correlationId
  }
}

export async function resendSignupOtp(
  mobile: string
): Promise<{ message: string; requestId?: string; correlationId?: string }> {
  const result = await authRequest('/api/auth/otp/resend', { mobile: mobile.trim() }, { expectUser: false })
  return {
    message: result.message,
    requestId: result.requestId,
    correlationId: result.correlationId
  }
}

export async function signupCustomer(payload: SignupPayload): Promise<LoginResponse> {
  const body: Record<string, string | undefined> = {
    fullName: payload.fullName.trim(),
    email: payload.email.trim(),
    password: payload.password,
    mobile: payload.mobile.trim(),
    otp: payload.otp.trim()
  }
  const deliveryAddress = payload.deliveryAddress?.trim()
  if (deliveryAddress) body.deliveryAddress = deliveryAddress
  const mapsLink = payload.mapsLink?.trim()
  if (mapsLink) body.mapsLink = mapsLink
  return authRequest('/api/auth/signup', body)
}

export async function fetchAuthMe(token: string): Promise<AuthUser | null> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/auth/me`
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const text = await response.text()
      const data = parseJsonBody(text)
      if (!response.ok) return null
      return data.user ?? null
    } catch {
      /* try next base */
    }
  }
  return null
}

export type CustomerProfilePatch = {
  fullName: string
  email: string
  mobile: string
  deliveryAddress: string
  mapsLink?: string
  password?: string
  currentPassword?: string
}

export async function patchCustomerProfile(
  token: string,
  patch: CustomerProfilePatch
): Promise<{ user: AuthUser; token: string }> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/auth/profile`
      const response = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(patch)
      })
      const text = await response.text()
      const data = parseJsonBody(text)

      if (!response.ok) {
        const msg = data.message || `Request failed with status ${response.status}`
        if (response.status >= 400 && response.status < 500) {
          throw new AuthClientError(msg)
        }
        throw new Error(msg)
      }

      if (!data.user || !data.token) {
        throw new Error('Invalid response from server')
      }

      return { user: data.user, token: data.token }
    } catch (error) {
      if (error instanceof AuthClientError) {
        throw new Error(error.message)
      }
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const isAbort = error instanceof Error && error.name === 'AbortError'
      console.warn('[API] profile patch failed', { baseUrl, isAbort, message })
    }
  }

  const err = lastError instanceof Error ? lastError : new Error('Unable to reach auth API')
  throw new Error(
    err.name === 'AbortError'
      ? 'Request timed out. Try again in a moment.'
      : err.message.includes('Failed to fetch') || err.message.includes('NetworkError')
        ? 'Cannot reach the server.'
        : err.message
  )
}
