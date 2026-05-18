import { getApiBaseCandidates, logApiCandidatesOnce } from '../config/api'
import { readDriverToken } from '../utils/authSession'
import type { AuthUser } from './authApi'

const API_BASE_URL_CANDIDATES = getApiBaseCandidates()

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

export async function loginDriver(payload: { email: string; password: string }): Promise<{
  message: string
  user: AuthUser
  token: string
}> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/delivery/login`
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const text = await response.text()
      const data = text ? (JSON.parse(text) as { message?: string; user?: AuthUser; token?: string }) : {}

      if (!response.ok) {
        throw new Error(data.message || `Login failed (${response.status})`)
      }
      if (!data.user || !data.token) {
        throw new Error('Invalid response from server')
      }
      return { message: data.message || 'OK', user: data.user, token: data.token }
    } catch (error) {
      lastError = error
      console.warn('[delivery auth] failed', { baseUrl, error })
    }
  }

  const err = lastError instanceof Error ? lastError : new Error('Unable to reach server')
  throw err
}

type ProfilePatch = {
  fullName: string
  mobile: string
  password?: string
  currentPassword?: string
}

export async function getDriverMe(): Promise<AuthUser | null> {
  const token = readDriverToken()
  if (!token) return null
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/delivery/me`
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const text = await response.text()
      const data = text ? (JSON.parse(text) as { user?: AuthUser }) : {}
      if (!response.ok) return null
      return data.user ?? null
    } catch {
      /* next */
    }
  }
  return null
}

export async function patchDriverProfile(patch: ProfilePatch): Promise<{ user: AuthUser; token: string }> {
  const token = readDriverToken()
  if (!token) {
    throw new Error('Not signed in')
  }
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/delivery/profile`
      const response = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(patch)
      })
      const text = await response.text()
      const data = text ? (JSON.parse(text) as { message?: string; user?: AuthUser; token?: string }) : {}
      if (!response.ok) {
        throw new Error(data.message || `Request failed (${response.status})`)
      }
      if (!data.user || !data.token) {
        throw new Error('Invalid response from server')
      }
      return { user: data.user, token: data.token }
    } catch (error) {
      lastError = error
      console.warn('[delivery auth] profile patch failed', { baseUrl, error })
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to reach server')
}
