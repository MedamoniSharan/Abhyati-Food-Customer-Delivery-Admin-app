import { DeliveryGoogleMap } from '../../components/DeliveryGoogleMap'
import { NotificationsBell } from '../../contexts/NotificationsContext'
import type { DeliveryStop } from '../../services/deliveryBackendApi'
import { formatInr } from '../../utils/currency'

type Props = {
  /** True while the assignments list is loading (initial fetch or refresh). */
  loading?: boolean
  currentStop: DeliveryStop | null
  /** Latest delivery for the "Recent" summary (usually most recent completed). */
  recentStop: DeliveryStop | null
  totalStops: number
  completedStops: number
  onStartNavigation: () => void
  onCallCurrent: () => void
  onViewAllDeliveries: () => void
  onViewPendingDeliveries: () => void
  onViewCompletedDeliveries: () => void
  onNotify: (message: string) => void
}

export function DeliveryDashboardScreen({
  loading = false,
  currentStop,
  recentStop,
  totalStops,
  completedStops,
  onStartNavigation,
  onCallCurrent,
  onViewAllDeliveries,
  onViewPendingDeliveries,
  onViewCompletedDeliveries,
  onNotify,
}: Props) {
  const pendingStops = Math.max(totalStops - completedStops, 0)
  return (
    <>
      <header className="dd-header">
        <div className="dd-header-row">
          <button type="button" className="dd-icon-btn" aria-label="Menu" onClick={() => onNotify('Menu coming soon')}>
            <span className="material-symbols-outlined">menu</span>
          </button>
          <h1>Dashboard</h1>
          <NotificationsBell />
        </div>
      </header>

      <main className={`dd-main${loading ? ' dd-main--busy' : ''}`}>
        {loading ? (
          <div className="dd-main-loader" role="status" aria-live="polite" aria-busy="true">
            <div className="dd-loader-card">
              <span className="dd-loader-spin" aria-hidden />
              <span>Loading assignments…</span>
            </div>
          </div>
        ) : null}
        <h2 className="sr-only">Statistics</h2>
        <div className="dd-stat-grid">
          <div className="dd-hero-black">
            <div style={{ position: 'relative', zIndex: 1 }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Total Assigned
              </p>
              <p className="dd-hero-num">{totalStops}</p>
              <div className="dd-hero-badge">
                <span>{pendingStops}</span>
                <span>pending</span>
              </div>
            </div>
            <div className="dd-orbit" aria-hidden>
              <span className="material-symbols-outlined">local_shipping</span>
            </div>
          </div>
          <button
            type="button"
            className="dd-stat-card dd-stat-card-btn"
            onClick={onViewCompletedDeliveries}
            aria-label={`View ${completedStops} completed deliveries`}
          >
            <div className="dd-stat-label">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, padding: 4, borderRadius: 999, background: '#000', color: '#fff' }}
              >
                check_circle
              </span>
              Completed
            </div>
            <p className="dd-stat-value">{completedStops}</p>
          </button>
          <button
            type="button"
            className="dd-stat-card dd-stat-card-btn"
            onClick={onViewPendingDeliveries}
            aria-label={`View ${pendingStops} pending deliveries`}
          >
            <div className="dd-stat-label">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, padding: 4, borderRadius: 999, background: '#ffedd5', color: 'var(--dd-accent)' }}
              >
                schedule
              </span>
              Pending
            </div>
            <p className="dd-stat-value">{pendingStops}</p>
          </button>
        </div>

        <div className="dd-section-title">
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Current Task</h3>
          <button type="button" className="dd-link" onClick={onViewAllDeliveries}>
            View All
          </button>
        </div>

        <div className="dd-card" style={{ overflow: 'hidden', padding: 0 }}>
          <div className="dd-map-tile" style={{ aspectRatio: '16 / 11', borderRadius: 0 }}>
            <DeliveryGoogleMap
              destination={currentStop?.mapsQuery || 'India'}
            />
            <div className="dd-map-grad" style={{ pointerEvents: 'none' }} />
            <div className="dd-map-pills" style={{ pointerEvents: 'none' }}>
              <div className="dd-pill-live" style={{ pointerEvents: 'auto' }}>
                <i />
                In Progress
              </div>
            </div>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>{currentStop?.businessName || 'No delivery assigned'}</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--dd-muted)', fontSize: '0.875rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    location_on
                  </span>
                  {currentStop?.address || 'No address available'}
                </div>
              </div>
              <button type="button" className="dd-icon-btn dd-card" aria-label="Call customer" onClick={onCallCurrent} disabled={!currentStop?.phone}>
                <span className="material-symbols-outlined">call</span>
              </button>
            </div>
            <div
              style={{
                borderTop: '1px solid var(--dd-border)',
                paddingTop: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: '0.875rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--dd-muted)' }}>Order ID</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{currentStop?.orderId || '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--dd-muted)' }}>Items</span>
                <span style={{ fontWeight: 600 }}>{currentStop ? `${currentStop.items.length} items` : '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--dd-muted)' }}>Est. Arrival</span>
                <span style={{ fontWeight: 700, color: 'var(--dd-accent)' }}>{currentStop?.arrivalWindow || '-'}</span>
              </div>
            </div>
            <button type="button" className="dd-accent-btn" style={{ marginTop: 18 }} onClick={onStartNavigation} disabled={!currentStop}>
              <span className="material-symbols-outlined">map</span>
              View Map
            </button>
          </div>
        </div>

        <h3 style={{ margin: '22px 0 12px', fontSize: '1.05rem' }}>Recent</h3>
        <div className="dd-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--dd-muted)',
            }}
          >
            <span className="material-symbols-outlined">inventory_2</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
              {recentStop?.businessName || 'No deliveries yet'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--dd-muted)' }}>
              {recentStop
                ? `${recentStop.statusTag}${recentStop.statusTag === 'Delivered' ? '' : ` · ${formatInr(recentStop.amount)}`}`
                : 'Assign orders from the admin dashboard'}
            </p>
            {recentStop?.proofUploaded ? (
              <p style={{ margin: '6px 0 0', fontSize: '0.7rem', color: '#15803d', fontWeight: 600 }}>Receipt in Zoho Books</p>
            ) : null}
          </div>
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 8,
              background: '#f4f4f5',
              border: '1px solid var(--dd-border)',
            }}
          >
            {recentStop?.statusTag === 'Delivered' ? 'Done' : recentStop ? recentStop.statusTag : '—'}
          </span>
        </div>
      </main>
    </>
  )
}
