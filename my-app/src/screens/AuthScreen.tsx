import { useState } from 'react'
import { useToast } from '../contexts/ToastContext'
import { loginCustomer, signupCustomer } from '../services/authApi'
import type { AuthUser } from '../services/authApi'
import { isGoogleMapsUrl } from '../utils/mapsLink'

export type AuthSuccessPayload = {
  message: string
  user: AuthUser
  token: string
}

type Props = {
  onAuthenticated: (payload: AuthSuccessPayload) => void
}

type AuthView = 'welcome' | 'login' | 'signup'

function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  showPassword,
  onToggleShow
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete: string
  showPassword: boolean
  onToggleShow: () => void
}) {
  return (
    <div className="auth-password-field">
      <input
        className="auth-input"
        placeholder={placeholder}
        type={showPassword ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={onToggleShow}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        aria-pressed={showPassword}
      >
        <span className="material-symbols-outlined" aria-hidden>
          {showPassword ? 'visibility_off' : 'visibility'}
        </span>
      </button>
    </div>
  )
}

export function AuthScreen({ onAuthenticated }: Props) {
  const { showToast } = useToast()
  const [view, setView] = useState<AuthView>('welcome')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [mapsLink, setMapsLink] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  function goToLogin() {
    setView('login')
    setConfirmPassword('')
  }

  function goToSignup() {
    setView('signup')
    setConfirmPassword('')
  }

  async function submitLogin() {
    const em = email.trim()
    if (!em || !password) {
      showToast('Enter your email and password', { variant: 'error' })
      return
    }
    setLoading(true)
    try {
      const result = await loginCustomer({ email: em, password })
      if (!result.token) {
        showToast('Server did not return a session token.', { variant: 'error' })
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

  async function submitSignup() {
    const name = fullName.trim()
    const em = email.trim()
    const mob = mobile.trim()
    const addr = deliveryAddress.trim()
    const maps = mapsLink.trim()

    if (maps && !isGoogleMapsUrl(maps)) {
      showToast('Enter a valid Google Maps link or leave it blank', { variant: 'error' })
      return
    }

    if (!name || name.length < 2) {
      showToast('Enter your full name (at least 2 characters)', { variant: 'error' })
      return
    }
    if (!em) {
      showToast('Enter your email address', { variant: 'error' })
      return
    }
    if (!mob || mob.length < 8) {
      showToast('Enter your mobile number (at least 8 digits)', { variant: 'error' })
      return
    }
    if (!/\d/.test(mob)) {
      showToast('Enter a valid mobile number', { variant: 'error' })
      return
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters', { variant: 'error' })
      return
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match', { variant: 'error' })
      return
    }

    setLoading(true)
    try {
      const result = await signupCustomer({
        fullName: name,
        email: em,
        password,
        mobile: mob,
        ...(addr ? { deliveryAddress: addr } : {}),
        ...(maps ? { mapsLink: maps } : {})
      })
      if (!result.token) {
        showToast('Account created but no session token returned.', { variant: 'error' })
        return
      }
      onAuthenticated({
        message: `Welcome, ${result.user.fullName}`,
        user: result.user,
        token: result.token
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
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
            <button type="button" className="auth-primary-btn" onClick={goToLogin}>
              Log in
            </button>
            <button type="button" className="auth-secondary-btn" onClick={goToSignup}>
              Create account
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (view === 'signup') {
    return (
      <section className="auth-shell auth-form-shell">
        <div className="auth-overlay" />
        <div className="auth-form-card auth-form-card--scroll">
          <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo auth-logo-top" />
          <h2>Create account</h2>
          <p>Sign up to browse products and place orders.</p>

          <input
            className="auth-input"
            placeholder="Full name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <input
            className="auth-input"
            placeholder="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="auth-input"
            placeholder="Mobile number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
          <textarea
            className="auth-input auth-textarea"
            placeholder="Delivery address (optional)"
            rows={2}
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
          />
          <input
            className="auth-input"
            type="url"
            inputMode="url"
            placeholder="Google Maps link (optional)"
            value={mapsLink}
            onChange={(e) => setMapsLink(e.target.value)}
            autoComplete="off"
          />
          <PasswordField
            value={password}
            onChange={setPassword}
            placeholder="Password (min 6 characters)"
            autoComplete="new-password"
            showPassword={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
          />
          <PasswordField
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm password"
            autoComplete="new-password"
            showPassword={showConfirmPassword}
            onToggleShow={() => setShowConfirmPassword((v) => !v)}
          />

          <button
            type="button"
            className="auth-primary-btn"
            onClick={() => void submitSignup()}
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Sign up'}
          </button>

          <button type="button" className="auth-link-btn" onClick={goToLogin} disabled={loading}>
            Already have an account? Log in
          </button>
          <button type="button" className="auth-link-btn" onClick={() => setView('welcome')} disabled={loading}>
            Back
          </button>
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
        <p>Sign in with your email and password.</p>

        <input
          className="auth-input"
          placeholder="Email Address"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder="Password"
          autoComplete="current-password"
          showPassword={showPassword}
          onToggleShow={() => setShowPassword((v) => !v)}
        />

        <button type="button" className="auth-primary-btn" onClick={() => void submitLogin()} disabled={loading}>
          {loading ? 'Please wait...' : 'Log In'}
        </button>

        <button type="button" className="auth-link-btn" onClick={goToSignup} disabled={loading}>
          New here? Create an account
        </button>
        <button type="button" className="auth-link-btn" onClick={() => setView('welcome')} disabled={loading}>
          Back
        </button>
      </div>
    </section>
  )
}
