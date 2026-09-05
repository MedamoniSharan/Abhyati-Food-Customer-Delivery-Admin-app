import { useEffect, useState } from 'react'
import type { AuthUser } from '../services/authApi'
import { fetchAuthMe, patchCustomerProfile } from '../services/authApi'
import { readAuthToken } from '../utils/authSession'
import { isGoogleMapsUrl } from '../utils/mapsLink'
import { looksLikeIndiaMobile, normalizeIndiaMobile } from '../utils/indiaMobile'

type Props = {
  user: AuthUser | null
  onBack: () => void
  onSaved: (user: AuthUser, token: string) => void
  onNotify: (message: string, variant?: 'success' | 'error' | 'info' | 'warning') => void
}

export function SettingsScreen({ user, onBack, onSaved, onNotify }: Props) {
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [baselineEmail, setBaselineEmail] = useState(user?.email ?? '')
  const [mobile, setMobile] = useState(user?.mobile ?? '')
  const [deliveryAddress, setDeliveryAddress] = useState(user?.deliveryAddress ?? '')
  const [mapsLink, setMapsLink] = useState(user?.mapsLink ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showCurPw, setShowCurPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [boot, setBoot] = useState(true)

  useEffect(() => {
    const token = readAuthToken()
    if (!token) {
      setBoot(false)
      return
    }
    let cancelled = false
    void fetchAuthMe(token).then((fresh) => {
      if (cancelled || !fresh) return
      setFullName(fresh.fullName)
      setEmail(fresh.email)
      setBaselineEmail(fresh.email)
      setMobile(fresh.mobile ?? '')
      setDeliveryAddress(fresh.deliveryAddress ?? '')
      setMapsLink(fresh.mapsLink ?? '')
      setBoot(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    const token = readAuthToken()
    if (!token) {
      onNotify('Not signed in', 'error')
      return
    }
    const emailChanged = email.trim().toLowerCase() !== baselineEmail.trim().toLowerCase()
    const passwordChange = newPassword.trim().length > 0
    if (emailChanged || passwordChange) {
      if (!currentPassword.trim()) {
        onNotify('Enter your current password to change email or password.', 'warning')
        return
      }
    }
    if (passwordChange && newPassword.trim().length < 6) {
      onNotify('New password must be at least 6 characters.', 'warning')
      return
    }
    if (fullName.trim().length < 2) {
      onNotify('Enter your full name.', 'warning')
      return
    }
    if (!looksLikeIndiaMobile(mobile.trim())) {
      onNotify('Enter a valid 10-digit Indian mobile number.', 'warning')
      return
    }
    if (deliveryAddress.trim().length > 0 && deliveryAddress.trim().length < 5) {
      onNotify('Delivery address looks too short.', 'warning')
      return
    }
    const mapsTrim = mapsLink.trim()
    if (mapsTrim && !isGoogleMapsUrl(mapsTrim)) {
      onNotify('Enter a valid Google Maps link (maps.app.goo.gl or google.com/maps/...).', 'warning')
      return
    }

    setLoading(true)
    try {
      const patch: {
        fullName: string
        email: string
        mobile: string
        deliveryAddress: string
        mapsLink?: string
        password?: string
        currentPassword?: string
      } = {
        fullName: fullName.trim(),
        email: email.trim(),
        mobile: normalizeIndiaMobile(mobile.trim()) || mobile.trim(),
        deliveryAddress: deliveryAddress.trim(),
        mapsLink: mapsTrim
      }
      if (passwordChange) {
        patch.password = newPassword.trim()
      }
      if (emailChanged || passwordChange) {
        patch.currentPassword = currentPassword.trim()
      }

      const { user: next, token: nextToken } = await patchCustomerProfile(token, patch)
      onSaved(next, nextToken)
      setBaselineEmail(next.email)
      setNewPassword('')
      setCurrentPassword('')
      onNotify('Profile saved in Zoho Books', 'success')
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Could not save profile', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="top-header light-header">
        <div className="header-row">
          <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>Account settings</h1>
          <div className="icon-btn" aria-hidden style={{ visibility: 'hidden' }} />
        </div>
      </header>

      <main className="content">
        {boot ? (
          <p className="muted-pad">Loading profile…</p>
        ) : (
          <>
            <p className="settings-lead">Updates are saved to your Zoho Books customer contact.</p>

            <label className="settings-label" htmlFor="cust-name">
              Display name
            </label>
            <input
              id="cust-name"
              className="auth-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />

            <label className="settings-label" htmlFor="cust-email">
              Email
            </label>
            <input
              id="cust-email"
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            <label className="settings-label" htmlFor="cust-mobile">
              Mobile
            </label>
            <input
              id="cust-mobile"
              className="auth-input"
              type="tel"
              inputMode="numeric"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              autoComplete="tel"
              placeholder="10-digit Indian mobile"
              maxLength={14}
            />
            <p className="muted-pad" style={{ marginTop: -4, marginBottom: 12 }}>
              Required for delivery. Drivers use this number to call you.
            </p>

            <label className="settings-label" htmlFor="cust-address">
              Delivery address
            </label>
            <textarea
              id="cust-address"
              className="auth-input auth-textarea"
              rows={4}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              autoComplete="street-address"
              placeholder="Street, area, city, state, PIN — required before checkout"
            />
            <p className="muted-pad" style={{ marginTop: -4, marginBottom: 12 }}>
              Saved to your Zoho Books billing address for deliveries.
            </p>

            <label className="settings-label" htmlFor="cust-maps-link">
              Google Maps link (optional)
            </label>
            <input
              id="cust-maps-link"
              className="auth-input"
              type="url"
              inputMode="url"
              value={mapsLink}
              onChange={(e) => setMapsLink(e.target.value)}
              placeholder="https://maps.app.goo.gl/… or google.com/maps/…"
              autoComplete="off"
            />
            <p className="muted-pad" style={{ marginTop: -4, marginBottom: 12 }}>
              Paste a share link from Google Maps. Drivers see this on assigned deliveries after you place an order.
            </p>

            <h3 className="settings-sub">Change password</h3>
            <label className="settings-label" htmlFor="cust-new-pw">
              New password (optional)
            </label>
            <div className="auth-password-field">
              <input
                id="cust-new-pw"
                className="auth-input"
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                aria-label={showNewPw ? 'Hide new password' : 'Show new password'}
                onClick={() => setShowNewPw((v) => !v)}
              >
                <span className="material-symbols-outlined">{showNewPw ? 'visibility' : 'visibility_off'}</span>
              </button>
            </div>

            <label className="settings-label" htmlFor="cust-cur-pw">
              Current password (required if you change email or password)
            </label>
            <div className="auth-password-field">
              <input
                id="cust-cur-pw"
                className="auth-input"
                type={showCurPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                aria-label={showCurPw ? 'Hide current password' : 'Show current password'}
                onClick={() => setShowCurPw((v) => !v)}
              >
                <span className="material-symbols-outlined">{showCurPw ? 'visibility' : 'visibility_off'}</span>
              </button>
            </div>

            <button type="button" className="btn btn-dark block" style={{ marginTop: 16 }} onClick={() => void save()} disabled={loading}>
              {loading ? 'Saving…' : 'Save to Zoho'}
            </button>
          </>
        )}
      </main>
    </>
  )
}
