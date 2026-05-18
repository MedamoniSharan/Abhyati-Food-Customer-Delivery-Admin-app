/** Reusable loading affordances for admin data panels (spinner matches full-page loader). */

export function AdminBlockLoader({ label }: { label: string }) {
  return (
    <div className="admin-block-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="admin-page-loader__spinner" aria-hidden />
      <p className="admin-block-loader__text">{label}</p>
    </div>
  )
}

export function AdminBusyOverlay({ label }: { label: string }) {
  return (
    <div className="admin-busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="admin-page-loader__spinner" aria-hidden />
      <p className="admin-busy-overlay__text">{label}</p>
    </div>
  )
}

export function AdminInlineSpinner({ label }: { label: string }) {
  return (
    <span className="admin-inline-spinner" role="status" aria-live="polite" aria-busy="true">
      <span className="admin-page-loader__spinner admin-page-loader__spinner--sm" aria-hidden />
      <span className="admin-inline-spinner__label">{label}</span>
    </span>
  )
}
