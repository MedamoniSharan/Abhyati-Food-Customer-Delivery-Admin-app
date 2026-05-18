import { useEffect, useState } from 'react'
import type { AuthUser } from '../../services/authApi'
import { getDriverMe, patchDriverProfile } from '../../services/deliveryAuthApi'

type Props = {
  user: AuthUser
  onSaved: (user: AuthUser, token: string) => void
  onNotify: (message: string) => void
}

export function DriverProfileSettings({ user, onSaved, onNotify }: Props) {
  const [fullName, setFullName] = useState(user.fullName)
  const [mobile, setMobile] = useState(user.mobile ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showCurPw, setShowCurPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [boot, setBoot] = useState(true)

  useEffect(() => {
    let cancelled = false
    void getDriverMe()
      .then((fresh) => {
        if (cancelled || !fresh) return
        setFullName(fresh.fullName)
        setMobile(fresh.mobile ?? '')
      })
      .catch(() => {
        if (!cancelled) onNotify('Could not refresh profile from server')
      })
      .finally(() => {
        if (!cancelled) setBoot(false)
      })
    return () => {
      cancelled = true
    }
  }, [onNotify])

  async function save() {
    const passwordChange = newPassword.trim().length > 0
    if (passwordChange) {
      if (!currentPassword.trim()) {
        onNotify('Enter your current password to set a new password')
        return
      }
      if (newPassword.trim().length < 6) {
        onNotify('New password must be at least 6 characters')
        return
      }
    }

    setLoading(true)
    try {
      const patch: { fullName: string; mobile: string; password?: string; currentPassword?: string } = {
        fullName: fullName.trim(),
        mobile: mobile.trim()
      }
      if (passwordChange) {
        patch.password = newPassword.trim()
        patch.currentPassword = currentPassword.trim()
      }
      const { user: next, token } = await patchDriverProfile(patch)
      onSaved(next, token)
      setNewPassword('')
      setCurrentPassword('')
      onNotify('Profile saved in Zoho Books')
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Could not save profile')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dd-card" style={{ padding: 20 }}>
      {boot ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 220,
          }}
        >
          <div className="dd-loader-card" role="status" aria-live="polite" aria-busy="true">
            <span className="dd-loader-spin" aria-hidden />
            <span>Loading profile…</span>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--dd-muted)' }}>
            Name and phone are stored on your Zoho Books driver contact. To change your login email, ask an administrator.
          </p>

          <label className="dd-set-label" htmlFor="drv-name">
            Display name
          </label>
          <input id="drv-name" className="auth-input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />

          <label className="dd-set-label" htmlFor="drv-mobile">
            Mobile
          </label>
          <input
            id="drv-mobile"
            className="auth-input"
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            autoComplete="tel"
          />

          <p style={{ margin: '18px 0 8px', fontWeight: 700, fontSize: '0.95rem' }}>Change password</p>
          <label className="dd-set-label" htmlFor="drv-new-pw">
            New password (optional)
          </label>
          <div className="auth-password-field">
            <input
              id="drv-new-pw"
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
              <span className="material-symbols-outlined">{showNewPw ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>

          <label className="dd-set-label" htmlFor="drv-cur-pw">
            Current password (required to set a new password)
          </label>
          <div className="auth-password-field">
            <input
              id="drv-cur-pw"
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
              <span className="material-symbols-outlined">{showCurPw ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>

          <button type="button" className="dd-accent-btn" style={{ marginTop: 18 }} onClick={() => void save()} disabled={loading}>
            {loading ? 'Saving…' : 'Save to Zoho'}
          </button>
        </>
      )}
    </div>
  )
}
