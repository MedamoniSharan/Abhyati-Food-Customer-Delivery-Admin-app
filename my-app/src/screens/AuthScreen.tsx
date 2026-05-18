import { useState } from 'react'
import { useToast } from '../contexts/ToastContext'
import { loginCustomer } from '../services/authApi'
import type { AuthUser } from '../services/authApi'

export type AuthSuccessPayload = {
  message: string
  user: AuthUser
  token: string
}

type Props = {
  onAuthenticated: (payload: AuthSuccessPayload) => void
}

export function AuthScreen({ onAuthenticated }: Props) {
  const { showToast } = useToast()
  const [view, setView] = useState<'welcome' | 'login'>('welcome')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submitAuth() {
    setLoading(true)

    try {
      const result = await loginCustomer({ email, password })
      if (!result.token) {
        showToast('Server did not return a session token. Update the backend.', { variant: 'error' })
        return
      }
      onAuthenticated({
        message: `Welcome back ${result.user.fullName}`,
        user: result.user,
        token: result.token
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      showToast(message, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  if (view === 'welcome') {
    return (
      <section className="auth-shell auth-welcome">
        <div className="auth-overlay" />
        <div className="auth-content">
          <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo" />
          <h1>Abhyati food</h1>
          <p className="auth-welcome-hint">Shop and order from our catalog</p>
          <div className="auth-welcome-actions">
            <button type="button" className="auth-primary-btn" onClick={() => setView('login')}>
              Log in
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="auth-shell auth-form-shell">
      <div className="auth-overlay" />
      <div className="auth-form-card">
        <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo auth-logo-top" />
        <h2>Welcome back</h2>
        <p>Sign in with the account your administrator created.</p>

        <input
          className="auth-input"
          placeholder="Email Address"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="auth-password-field">
          <input
            className="auth-input"
            placeholder="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="auth-password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {showPassword ? 'visibility_off' : 'visibility'}
            </span>
          </button>
        </div>

        <button type="button" className="auth-primary-btn" onClick={() => void submitAuth()} disabled={loading}>
          {loading ? 'Please wait...' : 'Log In'}
        </button>

        <button type="button" className="auth-link-btn" onClick={() => setView('welcome')}>
          Back
        </button>
      </div>
    </section>
  )
}
