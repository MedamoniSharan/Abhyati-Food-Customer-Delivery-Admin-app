import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastVariant = 'default' | 'success' | 'error' | 'info' | 'warning'

type ToastPayload = {
  id: number
  message: string
  variant: ToastVariant
}

type ShowOptions = {
  variant?: ToastVariant
  duration?: number
}

type ToastContextValue = {
  toast: ToastPayload | null
  showToast: (message: string, options?: ShowOptions) => void
  dismissToast: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const defaultDuration: Record<ToastVariant, number> = {
  default: 3200,
  success: 2800,
  error: 5000,
  info: 3600,
  warning: 4000,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismissToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToast(null)
  }, [])

  const showToast = useCallback((message: string, options?: ShowOptions) => {
    const variant = options?.variant ?? 'default'
    const duration = options?.duration ?? defaultDuration[variant]
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ id: Date.now(), message: message.trim(), variant })
    timerRef.current = setTimeout(() => {
      setToast(null)
      timerRef.current = null
    }, duration)
  }, [])

  const value = useMemo(
    () => ({
      toast,
      showToast,
      dismissToast,
    }),
    [toast, showToast, dismissToast],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

function iconName(v: ToastVariant): string {
  switch (v) {
    case 'success':
      return 'check_circle'
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    default:
      return 'notifications'
  }
}

export function ToastViewport() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('ToastViewport must be used within ToastProvider')
  }
  const { toast, dismissToast } = ctx

  if (!toast) return null

  return (
    <div className="app-toast-host" role="region" aria-label="Notifications">
      <div className={`app-toast app-toast--${toast.variant}`} role="status" aria-live="polite">
        <span className="app-toast-icon" aria-hidden>
          <span className="material-symbols-outlined">{iconName(toast.variant)}</span>
        </span>
        <p className="app-toast-message">{toast.message}</p>
        <button type="button" className="app-toast-close" onClick={dismissToast} aria-label="Dismiss notification">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}
