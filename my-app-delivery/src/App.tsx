import { useEffect, useState } from 'react'
import { useToast } from './contexts/ToastContext'
import { DeliveryDriverApp } from './screens/delivery/DeliveryDriverApp'
import { DriverAuthScreen } from './screens/DriverAuthScreen'
import type { AuthUser } from './services/authApi'
import { checkBackendReachable } from './utils/backendHealth'
import { clearSignedIn, readSessionUser, readSignedIn, writeSignedIn } from './utils/authSession'

function App() {
  const { showToast } = useToast()
  const [isAuthenticated, setIsAuthenticated] = useState(() => readSignedIn() && Boolean(readSessionUser()))
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(() => readSessionUser())

  useEffect(() => {
    if (readSignedIn() && !readSessionUser()) {
      clearSignedIn()
      setIsAuthenticated(false)
      setSessionUser(null)
    }
  }, [])

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
            setSessionUser(user)
            setIsAuthenticated(true)
            showToast(message, { variant: 'success' })
          }}
        />
      ) : (
        <DeliveryDriverApp
          user={sessionUser}
          onSessionUpdate={(user, token) => {
            writeSignedIn(user, token)
            setSessionUser(user)
          }}
          onLogout={() => {
            clearSignedIn()
            setIsAuthenticated(false)
            setSessionUser(null)
            showToast('Logged out successfully', { variant: 'success' })
          }}
          onNotify={(msg) => showToast(msg, { variant: 'info' })}
        />
      )}
    </div>
  )
}

export default App
