import { useState } from 'react'
import { useToast } from '../contexts/ToastContext'
import { loginDriver } from '../services/deliveryAuthApi'
import type { AuthUser } from '../services/authApi'

type Props = {
  onAuthenticated: (payload: { message: string; user: AuthUser; token: string }) => void
}

export function DriverAuthScreen({ onAuthenticated }: Props) {
  const { showToast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      const result = await loginDriver({ email: email.trim(), password })
      onAuthenticated({
        message: result.message,
        user: result.user,
        token: result.token
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed'
      showToast(message, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="auth-shell auth-form-shell">
      <div className="auth-overlay" />
      <div className="auth-form-card">
        <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo auth-logo-top" />
        <h2>Driver sign in</h2>
        <p>Use the email and password an administrator created for you.</p>

        <input
          className="auth-input"
          placeholder="Email"
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
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((v) => !v)}
          >
            <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
          </button>
        </div>

        <button type="button" className="auth-primary-btn" onClick={() => void submit()} disabled={loading}>
          {loading ? 'Please wait...' : 'Log In'}
        </button>
      </div>
    </section>
  )
}
