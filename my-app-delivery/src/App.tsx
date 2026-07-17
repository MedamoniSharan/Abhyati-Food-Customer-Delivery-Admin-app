import { useEffect, useRef, useState } from 'react'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { useToast } from './contexts/ToastContext'
import { DeliveryDriverApp } from './screens/delivery/DeliveryDriverApp'
import { DriverAuthScreen } from './screens/DriverAuthScreen'
import type { AuthUser } from './services/authApi'
import { getDriverMe } from './services/deliveryAuthApi'
import { checkBackendReachable } from './utils/backendHealth'
import {
  clearSignedIn,
  DRIVER_SESSION_LOST_EVENT,
  isSessionIdleExpired,
  notifyDriverSessionLost,
  readDriverToken,
  readSessionUser,
  readSignedIn,
  touchSessionActivity,
  writeSignedIn,
} from './utils/authSession'

function initialSession(): { authenticated: boolean; user: AuthUser | null } {
  if (!readSignedIn()) return { authenticated: false, user: null }
  const user = readSessionUser()
  if (!user) {
    clearSignedIn()
    return { authenticated: false, user: null }
  }
  if (isSessionIdleExpired()) {
    clearSignedIn()
    return { authenticated: false, user: null }
  }
  return { authenticated: true, user }
}

function App() {
  const { showToast } = useToast()
  const bootRef = useRef<ReturnType<typeof initialSession> | null>(null)
  if (bootRef.current === null) bootRef.current = initialSession()

  const [isAuthenticated, setIsAuthenticated] = useState(bootRef.current.authenticated)
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(bootRef.current.user)
  const signedInRef = useRef(bootRef.current.authenticated)

  function logout(message?: string) {
    if (!signedInRef.current) return
    signedInRef.current = false
    clearSignedIn()
    setIsAuthenticated(false)
    setSessionUser(null)
    if (message) showToast(message, { variant: 'info' })
  }

  useEffect(() => {
    if (!readSignedIn()) return
    const token = readDriverToken()
    if (!token) {
      logout('Your session expired. Please sign in again.')
      return
    }
    if (isSessionIdleExpired()) {
      logout('Session timed out due to inactivity. Please sign in again.')
      return
    }

    let cancelled = false
    void getDriverMe().then((user) => {
      if (cancelled) return
      if (!user) {
        logout('Your session expired or the account was removed.')
        return
      }
      writeSignedIn(user, token)
      signedInRef.current = true
      setSessionUser(user)
      setIsAuthenticated(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validate once on mount
  }, [])

  useEffect(() => {
    const onSessionLost = (event: Event) => {
      const reason =
        event instanceof CustomEvent && event.detail?.reason === 'idle' ? 'idle' : 'unauthorized'
      logout(
        reason === 'idle'
          ? 'Session timed out due to inactivity. Please sign in again.'
          : 'Your session expired. Please sign in again.',
      )
    }
    window.addEventListener(DRIVER_SESSION_LOST_EVENT, onSessionLost)
    return () => window.removeEventListener(DRIVER_SESSION_LOST_EVENT, onSessionLost)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast])

  useEffect(() => {
    if (!isAuthenticated) return

    touchSessionActivity()

    const onActivity = () => touchSessionActivity()
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onActivity)

    const tick = () => {
      if (!signedInRef.current) return
      if (isSessionIdleExpired()) notifyDriverSessionLost('idle')
    }
    const intervalId = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)

    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity)
      document.removeEventListener('visibilitychange', onActivity)
      window.clearInterval(intervalId)
      window.removeEventListener('focus', tick)
    }
  }, [isAuthenticated])

  const [backendReachable, setBackendReachable] = useState<boolean | null>(null)

  useEffect(() => {
    document.body.dataset.toastLayout = isAuthenticated ? 'main' : 'auth'
  }, [isAuthenticated])

  useEffect(() => {
    let cancelled = false
    void checkBackendReachable().then((ok) => {
      if (!cancelled) setBackendReachable(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app-shell">
      {backendReachable === false ? (
        <div className="api-offline-banner" role="status">
          Cannot reach the server. Check your connection or try again later.
        </div>
      ) : null}
      {!isAuthenticated || !sessionUser ? (
        <DriverAuthScreen
          onAuthenticated={({ message, user, token }) => {
            writeSignedIn(user, token)
            signedInRef.current = true
            setSessionUser(user)
            setIsAuthenticated(true)
            showToast(message, { variant: 'success' })
          }}
        />
      ) : (
        <NotificationsProvider enabled={isAuthenticated}>
          <DeliveryDriverApp
            user={sessionUser}
            onSessionUpdate={(user, token) => {
              writeSignedIn(user, token)
              setSessionUser(user)
            }}
            onLogout={() => {
              signedInRef.current = false
              clearSignedIn()
              setIsAuthenticated(false)
              setSessionUser(null)
              showToast('Logged out successfully', { variant: 'success' })
            }}
            onNotify={(msg) => showToast(msg, { variant: 'info' })}
          />
        </NotificationsProvider>
      )}
    </div>
  )
}

export default App
