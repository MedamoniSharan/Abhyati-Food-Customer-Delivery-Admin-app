type Props = {
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

function IconEdit() {
  return (
    <svg className="admin-icon-btn__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg className="admin-icon-btn__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

export function IconEditButton({ label, onClick, disabled }: Omit<Props, 'variant'>) {
  return (
    <button
      type="button"
      className="admin-icon-btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <IconEdit />
    </button>
  )
}

export function IconDeleteButton({ label, onClick, disabled }: Omit<Props, 'variant'>) {
  return (
    <button
      type="button"
      className="admin-icon-btn admin-icon-btn--danger"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <IconTrash />
    </button>
  )
}
