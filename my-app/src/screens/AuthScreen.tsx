import { useEffect, useState } from 'react'
import { useToast } from '../contexts/ToastContext'
import {
  fetchOtpStatus,
  loginCustomer,
  loginCustomerWithOtp,
  sendCustomerOtp,
  signupCustomer
} from '../services/authApi'
import type { AuthUser } from '../services/authApi'

export type AuthSuccessPayload = {
  message: string
  user: AuthUser
  token: string
}

type Props = {
  onAuthenticated: (payload: AuthSuccessPayload) => void
}

type AuthView = 'welcome' | 'login' | 'signup'
type LoginMode = 'otp' | 'email'
type SignupStep = 'form' | 'otp'

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

function OtpInput({
  value,
  onChange,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <input
      className="auth-input auth-otp-input"
      placeholder="Enter 6-digit OTP"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={8}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  )
}

export function AuthScreen({ onAuthenticated }: Props) {
  const { showToast } = useToast()
  const [view, setView] = useState<AuthView>('welcome')
  const [otpEnabled, setOtpEnabled] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('email')
  const [signupStep, setSignupStep] = useState<SignupStep>('form')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [loginOtpMobile, setLoginOtpMobile] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void fetchOtpStatus().then(({ otpEnabled: on }) => {
      setOtpEnabled(on)
      if (on) setLoginMode('otp')
    })
  }, [])

  useEffect(() => {
    if (otpCooldown <= 0) return
    const t = window.setInterval(() => {
      setOtpCooldown((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => window.clearInterval(t)
  }, [otpCooldown])

  function goToLogin() {
    setView('login')
    setSignupStep('form')
    setOtpCode('')
    setOtpSent(false)
    setConfirmPassword('')
  }

  function goToSignup() {
    setView('signup')
    setSignupStep('form')
    setOtpCode('')
    setOtpSent(false)
    setConfirmPassword('')
  }

  function validateMobile(mob: string): boolean {
    if (!mob || mob.length < 8) {
      showToast('Enter your mobile number (at least 8 digits)', { variant: 'error' })
      return false
    }
    if (!/\d/.test(mob)) {
      showToast('Enter a valid mobile number', { variant: 'error' })
      return false
    }
    return true
  }

  async function handleSendOtp(mob: string, purpose: 'login' | 'signup') {
    if (!validateMobile(mob)) return
    setLoading(true)
    try {
      const result = await sendCustomerOtp(mob, purpose)
      setOtpSent(true)
      setOtpCooldown(60)
      showToast(result.message, { variant: 'success' })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send OTP', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function submitLoginOtp() {
    const mob = loginOtpMobile.trim()
    if (!validateMobile(mob)) return
    if (!otpCode.trim()) {
      showToast('Enter the OTP sent to your mobile', { variant: 'error' })
      return
    }
    setLoading(true)
    try {
      const result = await loginCustomerWithOtp(mob, otpCode.trim())
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
      showToast(err instanceof Error ? err.message : 'Login failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function submitLoginEmail() {
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
      showToast(err instanceof Error ? err.message : 'Authentication failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function submitSignupForm() {
    const name = fullName.trim()
    const em = email.trim()
    const mob = mobile.trim()
    const addr = deliveryAddress.trim()

    if (!name || name.length < 2) {
      showToast('Enter your full name (at least 2 characters)', { variant: 'error' })
      return
    }
    if (!em) {
      showToast('Enter your email address', { variant: 'error' })
      return
    }
    if (!validateMobile(mob)) return
    if (password.length < 6) {
      showToast('Password must be at least 6 characters', { variant: 'error' })
      return
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match', { variant: 'error' })
      return
    }

    if (otpEnabled) {
      await handleSendOtp(mob, 'signup')
      setSignupStep('otp')
      return
    }

    setLoading(true)
    try {
      const result = await signupCustomer({
        fullName: name,
        email: em,
        password,
        mobile: mob,
        ...(addr ? { deliveryAddress: addr } : {})
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
      showToast(err instanceof Error ? err.message : 'Sign up failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function submitSignupWithOtp() {
    const name = fullName.trim()
    const em = email.trim()
    const mob = mobile.trim()
    const addr = deliveryAddress.trim()

    if (!otpCode.trim()) {
      showToast('Enter the OTP sent to your mobile', { variant: 'error' })
      return
    }

    setLoading(true)
    try {
      const result = await signupCustomer({
        fullName: name,
        email: em,
        password,
        mobile: mob,
        otp: otpCode.trim(),
        ...(addr ? { deliveryAddress: addr } : {})
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
      showToast(err instanceof Error ? err.message : 'Sign up failed', { variant: 'error' })
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
    if (signupStep === 'otp' && otpEnabled) {
      return (
        <section className="auth-shell auth-form-shell">
          <div className="auth-overlay" />
          <div className="auth-form-card">
            <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo auth-logo-top" />
            <h2>Verify mobile</h2>
            <p>Enter the OTP sent to {mobile.trim()}</p>
            <OtpInput value={otpCode} onChange={setOtpCode} disabled={loading} />
            <button
              type="button"
              className="auth-primary-btn"
              onClick={() => void submitSignupWithOtp()}
              disabled={loading}
            >
              {loading ? 'Creating account...' : 'Verify & create account'}
            </button>
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => void handleSendOtp(mobile.trim(), 'signup')}
              disabled={loading || otpCooldown > 0}
            >
              {otpCooldown > 0 ? `Resend OTP in ${otpCooldown}s` : 'Resend OTP'}
            </button>
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => setSignupStep('form')}
              disabled={loading}
            >
              Edit details
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="auth-shell auth-form-shell">
        <div className="auth-overlay" />
        <div className="auth-form-card auth-form-card--scroll">
          <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo auth-logo-top" />
          <h2>Create account</h2>
          <p>
            {otpEnabled
              ? 'We will verify your mobile with OTP, then create your account in Zoho.'
              : 'Sign up to browse products and place orders.'}
          </p>

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
            onClick={() => void submitSignupForm()}
            disabled={loading}
          >
            {loading
              ? 'Please wait...'
              : otpEnabled
                ? 'Send OTP & continue'
                : 'Sign up'}
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
      <div className="auth-form-card auth-form-card--scroll">
        <img src="/app-logo.png" alt="Abhyati food logo" className="auth-logo auth-logo-top" />
        <h2>Welcome back</h2>
        <p>Log in with OTP or email and password.</p>

        {otpEnabled ? (
          <div className="auth-mode-tabs" role="tablist" aria-label="Login method">
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'otp'}
              className={loginMode === 'otp' ? 'auth-mode-tab auth-mode-tab--active' : 'auth-mode-tab'}
              onClick={() => {
                setLoginMode('otp')
                setOtpCode('')
                setOtpSent(false)
              }}
            >
              OTP
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'email'}
              className={loginMode === 'email' ? 'auth-mode-tab auth-mode-tab--active' : 'auth-mode-tab'}
              onClick={() => setLoginMode('email')}
            >
              Email
            </button>
          </div>
        ) : null}

        {loginMode === 'otp' && otpEnabled ? (
          <>
            <input
              className="auth-input"
              placeholder="Mobile number"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={loginOtpMobile}
              onChange={(e) => setLoginOtpMobile(e.target.value)}
            />
            {otpSent ? (
              <OtpInput value={otpCode} onChange={setOtpCode} disabled={loading} />
            ) : null}
            {!otpSent ? (
              <button
                type="button"
                className="auth-primary-btn"
                onClick={() => void handleSendOtp(loginOtpMobile.trim(), 'login')}
                disabled={loading || otpCooldown > 0}
              >
                {loading ? 'Sending...' : otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Send OTP'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="auth-primary-btn"
                  onClick={() => void submitLoginOtp()}
                  disabled={loading}
                >
                  {loading ? 'Verifying...' : 'Verify & log in'}
                </button>
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => void handleSendOtp(loginOtpMobile.trim(), 'login')}
                  disabled={loading || otpCooldown > 0}
                >
                  {otpCooldown > 0 ? `Resend OTP in ${otpCooldown}s` : 'Resend OTP'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
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
            <button
              type="button"
              className="auth-primary-btn"
              onClick={() => void submitLoginEmail()}
              disabled={loading}
            >
              {loading ? 'Please wait...' : 'Log In'}
            </button>
          </>
        )}

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
