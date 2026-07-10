import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useToast } from './ToastContext'
import {
  fetchCustomerNotifications,
  markAllCustomerNotificationsRead,
  markCustomerNotificationRead,
  type AppNotification,
} from '../services/notificationsApi'

type NotificationsContextValue = {
  notifications: AppNotification[]
  unreadCount: number
  loading: boolean
  panelOpen: boolean
  openPanel: () => void
  closePanel: () => void
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

const POLL_MS = 25_000

function formatWhen(iso: string) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function NotificationsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { showToast } = useToast()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const bootstrappedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const data = await fetchCustomerNotifications()
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)

      if (bootstrappedRef.current) {
        const freshUnread = data.notifications.filter((n) => !n.readAt && !seenIdsRef.current.has(n.id))
        if (freshUnread.length > 0) {
          const latest = freshUnread[0]
          showToast(latest.title, { variant: 'info' })
        }
      } else {
        bootstrappedRef.current = true
      }
      for (const n of data.notifications) seenIdsRef.current.add(n.id)
    } catch {
      /* quiet poll failures */
    } finally {
      setLoading(false)
    }
  }, [enabled, showToast])

  useEffect(() => {
    if (!enabled) {
      setNotifications([])
      setUnreadCount(0)
      bootstrappedRef.current = false
      seenIdsRef.current = new Set()
      return
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, refresh])

  const markRead = useCallback(async (id: string) => {
    await markCustomerNotificationRead(id)
    setNotifications((rows) => rows.map((r) => (r.id === id ? { ...r, readAt: new Date().toISOString() } : r)))
    setUnreadCount((n) => Math.max(0, n - 1))
  }, [])

  const markAllRead = useCallback(async () => {
    await markAllCustomerNotificationsRead()
    const now = new Date().toISOString()
    setNotifications((rows) => rows.map((r) => ({ ...r, readAt: r.readAt || now })))
    setUnreadCount(0)
  }, [])

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      refresh,
      markRead,
      markAllRead,
    }),
    [notifications, unreadCount, loading, panelOpen, refresh, markRead, markAllRead],
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {enabled && panelOpen ? (
        <NotificationsPanel
          notifications={notifications}
          loading={loading}
          onClose={() => setPanelOpen(false)}
          onMarkRead={(id) => void markRead(id)}
          onMarkAllRead={() => void markAllRead()}
        />
      ) : null}
    </NotificationsContext.Provider>
  )
}

function NotificationsPanel({
  notifications,
  loading,
  onClose,
  onMarkRead,
  onMarkAllRead,
}: {
  notifications: AppNotification[]
  loading: boolean
  onClose: () => void
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}) {
  return (
    <>
      <button type="button" className="notif-backdrop" aria-label="Close notifications" onClick={onClose} />
      <aside className="notif-panel" role="dialog" aria-label="Notifications">
        <div className="notif-panel-head">
          <h2>Notifications</h2>
          <div className="notif-panel-actions">
            {notifications.some((n) => !n.readAt) ? (
              <button type="button" className="notif-mark-all" onClick={onMarkAllRead}>
                Mark all read
              </button>
            ) : null}
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="notif-panel-body">
          {loading && notifications.length === 0 ? (
            <p className="notif-empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="notif-empty">No notifications yet. Order and delivery updates will appear here.</p>
          ) : (
            <ul className="notif-list">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.readAt ? 'notif-item' : 'notif-item notif-item--unread'}
                    onClick={() => {
                      if (!n.readAt) onMarkRead(n.id)
                    }}
                  >
                    <span className="notif-item-title">{n.title}</span>
                    {n.body ? <span className="notif-item-body">{n.body}</span> : null}
                    <span className="notif-item-time">{formatWhen(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}

export function NotificationsBell({
  className,
  dark,
}: {
  className?: string
  dark?: boolean
}) {
  const { unreadCount, openPanel } = useNotifications()
  return (
    <button
      type="button"
      className={`${dark ? 'icon-btn icon-btn-dark' : 'icon-btn'}${unreadCount > 0 ? ' with-dot' : ''}${className ? ` ${className}` : ''}`}
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
      onClick={openPanel}
    >
      <span className="material-symbols-outlined">{unreadCount > 0 ? 'notifications' : 'notifications_none'}</span>
    </button>
  )
}
