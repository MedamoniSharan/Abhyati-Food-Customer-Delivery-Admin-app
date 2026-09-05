import { useEffect, useState } from 'react'
import { useToast } from '../contexts/ToastContext'
import { loginCustomer, resendSignupOtp, sendSignupOtp, signupCustomer } from '../services/authApi'
import type { AuthUser } from '../services/authApi'
import { isGoogleMapsUrl } from '../utils/mapsLink'
import { looksLikeIndiaMobile, normalizeIndiaMobile } from '../utils/indiaMobile'

export type AuthSuccessPayload = {
  message: string
  user: AuthUser
  token: string
}

type Props = {
  onAuthenticated: (payload: AuthSuccessPayload) => void
}

type AuthView = 'welcome' | 'login' | 'signup'

const OTP_RESEND_SECONDS = 30

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
          {showPassword ? 'visibility' : 'visibility_off'}
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
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [mapsLink, setMapsLink] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendIn])

  function goToLogin() {
    setView('login')
    setConfirmPassword('')
    setOtp('')
    setOtpError('')
    setOtpSent(false)
    setResendIn(0)
  }

  function goToSignup() {
    setView('signup')
    setConfirmPassword('')
    setOtp('')
    setOtpError('')
    setOtpSent(false)
    setResendIn(0)
  }

  function validateSignupFields(): boolean {
    const name = fullName.trim()
    const em = email.trim()
    const mob = mobile.trim()
    const maps = mapsLink.trim()

    if (maps && !isGoogleMapsUrl(maps)) {
      showToast('Enter a valid Google Maps link or leave it blank', { variant: 'error' })
      return false
    }

    if (!name || name.length < 2) {
      showToast('Enter your full name (at least 2 characters)', { variant: 'error' })
      return false
    }
    if (!em) {
      showToast('Enter your email address', { variant: 'error' })
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      showToast('Enter a valid email address', { variant: 'error' })
      return false
    }
    if (!looksLikeIndiaMobile(mob)) {
      showToast('Enter a valid 10-digit Indian mobile number', { variant: 'error' })
      return false
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters', { variant: 'error' })
      return false
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match', { variant: 'error' })
      return false
    }
    return true
  }

  async function submitLogin() {
    const em = email.trim()
    if (!em) {
      showToast('Invalid email', { variant: 'error' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      showToast('Invalid email', { variant: 'error' })
      return
    }
    if (!password) {
      showToast('Invalid password', { variant: 'error' })
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

  async function handleSendOtp() {
    const mob = mobile.trim()
    if (!looksLikeIndiaMobile(mob)) {
      showToast('Enter a valid 10-digit Indian mobile number', { variant: 'error' })
      return
    }
    // Still require core signup fields so OTP is not wasted on incomplete forms
    if (!validateSignupFields()) return
    setOtpLoading(true)
    setOtpError('')
    try {
      await sendSignupOtp(mob)
      setOtpSent(true)
      setResendIn(OTP_RESEND_SECONDS)
      showToast('OTP sent to your mobile', { variant: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP'
      showToast(message, { variant: 'error' })
    } finally {
      setOtpLoading(false)
    }
  }

  async function handleResendOtp() {
    if (resendIn > 0) return
    if (!looksLikeIndiaMobile(mobile.trim())) {
      showToast('Enter a valid 10-digit Indian mobile number', { variant: 'error' })
      return
    }
    setOtpLoading(true)
    try {
      await resendSignupOtp(mobile.trim())
      setResendIn(OTP_RESEND_SECONDS)
      showToast('OTP resent', { variant: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend OTP'
      showToast(message, { variant: 'error' })
    } finally {
      setOtpLoading(false)
    }
  }

  async function submitSignup() {
    if (!validateSignupFields()) return
    if (!otpSent) {
      setOtpError('Send OTP to your mobile first')
      showToast('Send OTP to your mobile first', { variant: 'error' })
      return
    }
    const code = otp.trim()
    if (!code) {
      setOtpError('Enter the OTP sent to your mobile')
      return
    }
    if (!/^\d{4,9}$/.test(code)) {
      setOtpError('Enter a valid OTP')
      return
    }
    setOtpError('')

    const name = fullName.trim()
    const em = email.trim()
    const mob = normalizeIndiaMobile(mobile.trim()) || mobile.trim()
    const addr = deliveryAddress.trim()
    const maps = mapsLink.trim()

    setLoading(true)
    try {
      const result = await signupCustomer({
        fullName: name,
        email: em,
        password,
        mobile: mob,
        otp: code,
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
      if (/otp/i.test(message)) setOtpError(message)
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
          <p>Sign up to browse products and place orders. We verify your mobile with OTP.</p>

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
            placeholder="10-digit Indian mobile"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value)
              setOtpSent(false)
              setOtp('')
              setOtpError('')
              setResendIn(0)
            }}
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

          <div className="auth-otp-row">
            <input
              className={`auth-input auth-otp-input${otpError ? ' auth-input--error' : ''}`}
              placeholder="OTP"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              value={otp}
              aria-invalid={Boolean(otpError)}
              aria-describedby={otpError ? 'signup-otp-error' : undefined}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, '').slice(0, 9))
                if (otpError) setOtpError('')
              }}
              disabled={!otpSent}
            />
            <button
              type="button"
              className="auth-otp-send-btn"
              onClick={() => void (otpSent ? handleResendOtp() : handleSendOtp())}
              disabled={loading || otpLoading || (otpSent && resendIn > 0)}
            >
              {otpSent
                ? resendIn > 0
                  ? `Resend (${resendIn}s)`
                  : otpLoading
                    ? 'Please wait...'
                    : 'Resend OTP'
                : otpLoading
                  ? 'Sending...'
                  : 'Send OTP'}
            </button>
          </div>
          {otpError ? (
            <p id="signup-otp-error" className="auth-field-error" role="alert">
              {otpError}
            </p>
          ) : null}

          <button
            type="button"
            className="auth-primary-btn"
            onClick={() => void submitSignup()}
            disabled={loading || otpLoading}
          >
            {loading ? 'Creating account...' : 'Sign up'}
          </button>

          <button type="button" className="auth-link-btn" onClick={goToLogin} disabled={loading || otpLoading}>
            Already have an account? Log in
          </button>
          <button
            type="button"
            className="auth-link-btn"
            onClick={() => setView('welcome')}
            disabled={loading || otpLoading}
          >
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
