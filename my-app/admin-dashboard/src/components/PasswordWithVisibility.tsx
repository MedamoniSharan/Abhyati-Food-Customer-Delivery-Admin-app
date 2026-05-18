import { useState } from 'react'

function IconEye() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEyeOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}

type Props = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
  required?: boolean
}

export function PasswordWithVisibility({ value, onChange, placeholder, autoComplete, required }: Props) {
  const [show, setShow] = useState(false)
  const toggle = () => setShow((s) => !s)
  return (
    <div className="admin-password-wrap admin-password-wrap--with-toggle">
      <div className="admin-password-wrap__field">
        <input
          className="admin-input admin-password-wrap__input"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
        />
        <button
          type="button"
          className="admin-password-wrap__eye"
          onClick={toggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          title={show ? 'Hide password' : 'Show password'}
        >
          {show ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      <button type="button" className="admin-btn admin-btn--ghost admin-password-wrap__text-toggle" onClick={toggle}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
