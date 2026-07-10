import { getApiBaseCandidates, logApiCandidatesOnce } from '../config/api'
import { readDriverToken } from '../utils/authSession'

const API_BASE_URL_CANDIDATES = getApiBaseCandidates()

export type AppNotification = {
  id: string
  title: string
  body: string
  type: string
  readAt: string | null
  createdAt: string
  meta?: Record<string, unknown>
}

type NotificationsResponse = {
  notifications?: AppNotification[]
  unreadCount?: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  const token = readDriverToken()
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
      const headers = new Headers(init?.headers)
      headers.set('Content-Type', 'application/json')
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetch(url, { ...init, headers })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text.slice(0, 200) || `Request failed (${response.status})`)
      }
      return (await response.json()) as T
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to reach backend API')
}

export async function fetchDriverNotifications(): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const data = await request<NotificationsResponse>('/api/delivery/notifications')
  return {
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    unreadCount: Number(data.unreadCount) || 0
  }
}

export async function markDriverNotificationRead(id: string): Promise<void> {
  await request(`/api/delivery/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })
}

export async function markAllDriverNotificationsRead(): Promise<void> {
  await request('/api/delivery/notifications/read-all', { method: 'POST' })
}
