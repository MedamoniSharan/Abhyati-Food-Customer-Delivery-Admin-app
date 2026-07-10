import { useEffect, useRef, useState, type ReactNode } from 'react'

const PULL_THRESHOLD = 72
const MAX_PULL = 108

type Props = {
  onRefresh: () => void | Promise<void>
  children: ReactNode
  disabled?: boolean
  className?: string
}

function isIframeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('iframe'))
}

function readScrollTop(scrollEl: HTMLElement | null): number {
  if (!scrollEl) return 0
  if (scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
    return scrollEl.scrollTop
  }
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

export function PullToRefresh({ onRefresh, children, disabled = false, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const pulling = useRef(false)
  const touchActive = useRef(false)
  const offsetRef = useRef(0)
  const refreshingRef = useRef(false)
  const disabledRef = useRef(disabled)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  useEffect(() => {
    refreshingRef.current = refreshing
  }, [refreshing])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const resetPull = () => {
      pulling.current = false
      touchActive.current = false
      if (!refreshingRef.current) setOffset(0)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || refreshingRef.current) return
      const touch = e.touches[0]
      if (!touch || !root.contains(e.target as Node)) return
      if (isIframeTarget(e.target)) return
      if (readScrollTop(root) > 4) return
      startY.current = touch.clientY
      pulling.current = true
      touchActive.current = true
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive.current || !pulling.current || disabledRef.current || refreshingRef.current) return
      if (!root.contains(e.target as Node)) {
        resetPull()
        return
      }
      if (readScrollTop(root) > 4) {
        resetPull()
        return
      }
      const y = e.touches[0]?.clientY ?? 0
      const delta = Math.max(0, y - startY.current)
      if (delta <= 0) return
      if (delta > 4) e.preventDefault()
      const next = Math.min(MAX_PULL, delta * 0.5)
      offsetRef.current = next
      setOffset(next)
    }

    const onTouchEnd = async () => {
      if (!touchActive.current) return
      touchActive.current = false
      if (!pulling.current || disabledRef.current) return
      pulling.current = false
      const pulled = offsetRef.current
      if (pulled >= PULL_THRESHOLD && !refreshingRef.current) {
        setRefreshing(true)
        refreshingRef.current = true
        setOffset(PULL_THRESHOLD * 0.55)
        try {
          await onRefreshRef.current()
        } finally {
          setRefreshing(false)
          refreshingRef.current = false
          setOffset(0)
          offsetRef.current = 0
        }
        return
      }
      setOffset(0)
      offsetRef.current = 0
    }

    const optsCapture = { capture: true } as const
    root.addEventListener('touchstart', onTouchStart, { passive: true, ...optsCapture })
    root.addEventListener('touchmove', onTouchMove, { passive: false, ...optsCapture })
    root.addEventListener('touchend', onTouchEnd, optsCapture)
    root.addEventListener('touchcancel', onTouchEnd, optsCapture)
    return () => {
      root.removeEventListener('touchstart', onTouchStart, optsCapture)
      root.removeEventListener('touchmove', onTouchMove, optsCapture)
      root.removeEventListener('touchend', onTouchEnd, optsCapture)
      root.removeEventListener('touchcancel', onTouchEnd, optsCapture)
    }
  }, [])

  const showIndicator = offset > 0 || refreshing
  const pullProgress = Math.min(1, offset / PULL_THRESHOLD)
  const label = refreshing
    ? 'Refreshing…'
    : offset >= PULL_THRESHOLD
      ? 'Release to refresh'
      : 'Pull down to refresh'

  return (
    <div ref={rootRef} className={`ptr-root${className ? ` ${className}` : ''}`}>
      <div
        className={`ptr-indicator${showIndicator ? ' ptr-indicator--visible' : ''}`}
        style={{
          height: showIndicator ? Math.max(offset, refreshing ? 52 : 0) : 0,
          opacity: showIndicator ? 1 : 0
        }}
        aria-live="polite"
        aria-busy={refreshing}
      >
        <span
          className={`ptr-spinner-ring${refreshing ? ' ptr-spinner-ring--active' : offset >= PULL_THRESHOLD ? ' ptr-spinner-ring--ready' : ''}`}
          style={
            refreshing || offset >= PULL_THRESHOLD
              ? undefined
              : {
                  transform: `rotate(${Math.round(pullProgress * 300)}deg)`,
                  opacity: Math.min(1, 0.35 + pullProgress * 0.65)
                }
          }
          aria-hidden
        />
        <span className="ptr-label">{label}</span>
      </div>
      <div className="ptr-content" style={{ transform: offset > 0 ? `translateY(${offset}px)` : undefined }}>
        {children}
      </div>
    </div>
  )
}
