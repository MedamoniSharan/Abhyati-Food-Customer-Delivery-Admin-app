import { useMemo, useState } from 'react'
import type { DeliveryStop } from '../../services/deliveryBackendApi'
import { formatInr } from '../../utils/currency'
import {
  addDays,
  addMonthsClampDay,
  completedCountForCalendarDay,
  isSameLocalDay,
  localDateKey,
  startOfWeekMonday,
  stopsForCalendarDay,
} from '../../utils/deliveryCalendar'

export type DeliveriesStatusFilter = 'all' | 'pending' | 'completed'

type Props = {
  stops: DeliveryStop[]
  loading?: boolean
  statusFilter?: DeliveriesStatusFilter
  onOpenStop: (stopId: string) => void
  onCompleteStop?: (stopId: string) => void
  onAcceptStop?: (stopId: string) => void | Promise<void>
  acceptingId?: string | null
  onBackToDashboard: () => void
  /** Optional maps destination; falls back in parent when empty */
  onViewMap: (mapsQueryHint?: string) => void
  onNotify: (message: string) => void
  onRefresh?: () => void | Promise<void>
}

function normalizeCalendarDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0)
}

export function AssignedDeliveriesScreen({
  stops,
  loading,
  statusFilter = 'all',
  onOpenStop,
  onCompleteStop,
  onAcceptStop,
  acceptingId,
  onBackToDashboard,
  onViewMap,
  onNotify,
  onRefresh,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(() => normalizeCalendarDate(new Date()))

  const monthYearLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selectedDate),
    [selectedDate]
  )

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(selectedDate)
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i)
      return {
        date,
        dayShort: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date),
        dom: date.getDate(),
      }
    })
  }, [selectedDate])

  const filteredByStatus = useMemo(() => {
    if (statusFilter === 'pending') return stops.filter((s) => s.statusTag !== 'Delivered')
    if (statusFilter === 'completed') return stops.filter((s) => s.statusTag === 'Delivered')
    return stopsForCalendarDay(stops, selectedDate)
  }, [stops, selectedDate, statusFilter])

  const visibleStops = useMemo(() => {
    let nextAssigned = false
    return filteredByStatus.map((s) => {
      if (s.statusTag === 'Delivered') return { ...s, isNext: false }
      if (!nextAssigned) {
        nextAssigned = true
        return { ...s, isNext: true }
      }
      return { ...s, isNext: false }
    })
  }, [filteredByStatus])

  const completedForDay = useMemo(() => {
    if (statusFilter === 'completed') return visibleStops.length
    if (statusFilter === 'pending') return 0
    return completedCountForCalendarDay(stops, selectedDate)
  }, [statusFilter, visibleStops.length, stops, selectedDate])

  const screenTitle = useMemo(() => {
    if (statusFilter === 'pending') return 'Pending Deliveries'
    if (statusFilter === 'completed') return 'Completed Deliveries'
    return 'Assigned Deliveries'
  }, [statusFilter])

  const routeTitle = useMemo(() => {
    if (statusFilter === 'pending') return 'Pending stops'
    if (statusFilter === 'completed') return 'Completed stops'
    const today = normalizeCalendarDate(new Date())
    if (isSameLocalDay(selectedDate, today)) return "Today's Route"
    return `Route · ${new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(selectedDate)}`
  }, [selectedDate, statusFilter])

  const emptyMessage = useMemo(() => {
    if (statusFilter === 'pending') return 'No pending deliveries right now.'
    if (statusFilter === 'completed') return 'No completed deliveries yet.'
    return 'No deliveries assigned.'
  }, [statusFilter])

  return (
    <>
      <header className="dd-header">
        <div className="dd-header-row">
          <button type="button" className="dd-icon-btn" aria-label="Back" onClick={onBackToDashboard}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>{screenTitle}</h1>
          <button
            type="button"
            className="dd-icon-btn"
            aria-label="Refresh deliveries"
            disabled={loading}
            onClick={() => void onRefresh?.()}
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
        {statusFilter === 'all' ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button
              type="button"
              className="dd-icon-btn"
              aria-label="Previous month"
              onClick={() => setSelectedDate((d) => normalizeCalendarDate(addMonthsClampDay(d, -1)))}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                chevron_left
              </span>
            </button>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{monthYearLabel}</span>
            <button
              type="button"
              className="dd-icon-btn"
              aria-label="Next month"
              onClick={() => setSelectedDate((d) => normalizeCalendarDate(addMonthsClampDay(d, 1)))}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                chevron_right
              </span>
            </button>
          </div>
          <div className="dd-week-strip">
            {weekDays.map(({ date, dayShort, dom }) => (
              <div key={localDateKey(date)} className="dd-week-day">
                <span>{dayShort}</span>
                <button
                  type="button"
                  className={isSameLocalDay(date, selectedDate) ? 'selected' : ''}
                  onClick={() => setSelectedDate(normalizeCalendarDate(date))}
                >
                  {dom}
                </button>
              </div>
            ))}
          </div>
        </div>
        ) : null}
      </header>

      <main className="dd-main">
        <div className={`dd-stat-grid${loading ? ' dd-stat-grid--loading' : ''}`} style={{ marginBottom: 8 }}>
          <div className="dd-stat-card">
            <div className="dd-stat-label">
              <span className="material-symbols-outlined" style={{ fontSize: 20, background: '#f1f5f9', borderRadius: 8, padding: 4 }}>
                local_shipping
              </span>
              Total Stops
            </div>
            <p className="dd-stat-value">{loading ? '—' : visibleStops.length}</p>
          </div>
          <div className="dd-stat-card">
            <div className="dd-stat-label">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20, background: '#fff7ed', borderRadius: 8, padding: 4, color: 'var(--dd-accent)' }}
              >
                check_circle
              </span>
              Completed
            </div>
            <p className="dd-stat-value">{loading ? '—' : completedForDay}</p>
          </div>
        </div>

        <div className="dd-section-title">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{routeTitle}</h2>
          <button
            type="button"
            className="dd-link"
            onClick={() => {
              const open = visibleStops.find((s) => s.statusTag !== 'Delivered')
              onViewMap(open?.mapsQuery?.trim() || undefined)
            }}
          >
            View Map
          </button>
        </div>

        {loading ? (
          <>
            <p className="sr-only">Loading deliveries…</p>
            {Array.from({ length: 3 }).map((_, i) => (
              <article key={`route-skel-${i}`} className="dd-route-card dd-route-card--skeleton" aria-hidden>
                <div className="dd-route-inner">
                  <div className="dd-skel-row">
                    <div className="dd-skel-block">
                      <div className="dd-skel dd-skel--tag" />
                      <div className="dd-skel dd-skel--title" />
                      <div className="dd-skel dd-skel--meta" />
                    </div>
                    <div className="dd-skel dd-skel--amount" />
                  </div>
                  <div className="dd-skel-row" style={{ marginTop: 12 }}>
                    <div className="dd-skel dd-skel--icon" />
                    <div className="dd-skel-block" style={{ flex: 1 }}>
                      <div className="dd-skel dd-skel--line" />
                      <div className="dd-skel dd-skel--line short" />
                    </div>
                  </div>
                  <div className="dd-skel-footer">
                    <div className="dd-skel dd-skel--avatar" />
                    <div className="dd-skel-block" style={{ flex: 1 }}>
                      <div className="dd-skel dd-skel--line" style={{ maxWidth: 140 }} />
                      <div className="dd-skel dd-skel--line short" />
                    </div>
                    <div className="dd-skel dd-skel--btn" />
                  </div>
                </div>
              </article>
            ))}
          </>
        ) : null}
        {!loading && visibleStops.length === 0 ? <p style={{ color: 'var(--dd-muted)' }}>{emptyMessage}</p> : null}
        {!loading
          ? visibleStops.map((stop) => (
              <article key={stop.id} className={`dd-route-card ${stop.isNext ? 'next' : ''}`}>
                <div className="dd-route-inner">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <span className={`dd-tag ${stop.isNext ? 'orange' : 'gray'}`}>
                        {stop.statusTag} • {stop.timeLabel}
                      </span>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.25 }}>{stop.businessName}</h3>
                      <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--dd-muted)', fontWeight: 600 }}>{stop.orderId}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'block', fontSize: '1.1rem', fontWeight: 700 }}>{formatInr(stop.amount)}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--dd-muted)' }}>{stop.paymentLabel}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginBottom: stop.note ? 12 : 0 }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--dd-muted)', fontSize: 20, marginTop: 2 }}>
                      location_on
                    </span>
                    <div>
                      <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{stop.address}</p>
                      {stop.note ? <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--dd-muted)' }}>{stop.note}</p> : null}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: '1px solid var(--dd-border)',
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        background: '#f1f5f9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        color: 'var(--dd-muted)',
                      }}
                    >
                      {stop.initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{stop.contactName}</p>
                      <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--dd-muted)' }}>{stop.contactRole}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {stop.statusTag === 'Assigned' && onAcceptStop ? (
                        <button
                          type="button"
                          className="dd-accent-btn"
                          style={{ width: 'auto', padding: '10px 14px' }}
                          disabled={acceptingId === stop.id}
                          onClick={() => void onAcceptStop(stop.id)}
                        >
                          {acceptingId === stop.id ? '…' : 'Accept'}
                        </button>
                      ) : null}
                      {stop.statusTag !== 'Assigned' && stop.statusTag !== 'Delivered' && onCompleteStop ? (
                        <button
                          type="button"
                          className="dd-accent-btn"
                          style={{ width: 'auto', padding: '10px 14px' }}
                          onClick={() => onCompleteStop(stop.id)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                            check_circle
                          </span>
                          Complete
                        </button>
                      ) : null}
                      {stop.isNext && stop.statusTag !== 'Assigned' && stop.statusTag !== 'Delivered' ? (
                        <button
                          type="button"
                          className="dd-muted-btn"
                          style={{ width: 'auto', padding: '10px 14px' }}
                          onClick={() => onViewMap(stop.mapsQuery?.trim() || undefined)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            map
                          </span>
                          Map
                        </button>
                      ) : stop.statusTag === 'Delivered' ? null : (
                        <button type="button" className="dd-muted-btn" onClick={() => onOpenStop(stop.id)}>
                          Details
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))
          : null}
      </main>
    </>
  )
}
