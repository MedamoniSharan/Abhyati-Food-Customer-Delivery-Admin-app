import { DeliveryGoogleMap } from '../../components/DeliveryGoogleMap'
import type { DeliveryStop } from '../../services/deliveryBackendApi'

type Props = {
  detail: DeliveryStop
  onBack: () => void
  onAccept?: () => void | Promise<void>
  accepting?: boolean
  onStartNavigation: () => void | Promise<void>
  onOpenProof: () => void
  onOpenAddress: () => void
  onMessage: () => void
  onCall: () => void
  onNotify: (message: string) => void
}

export function DeliveryDetailScreen({
  detail,
  onBack,
  onAccept,
  accepting,
  onStartNavigation,
  onOpenProof,
  onOpenAddress,
  onMessage,
  onCall,
  onNotify,
}: Props) {
  const needsAccept = detail.statusTag === 'Assigned'
  return (
    <>
      <header className="dd-header">
        <div className="dd-header-row">
          <button type="button" className="dd-icon-btn" aria-label="Back" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h2>Delivery #{detail.deliveryNumber}</h2>
          <button type="button" className="dd-text-btn" onClick={() => onNotify('Help')}>
            Help
          </button>
        </div>
      </header>

      <main className="dd-main" style={{ paddingBottom: 120 }}>
        <div className="dd-map-tile" style={{ aspectRatio: '16 / 10', marginBottom: 12 }}>
          <DeliveryGoogleMap destination={detail.mapsQuery} />
        </div>

        <div className="dd-card" style={{ padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dd-muted)' }}>
                CUSTOMER
              </p>
              <h3 style={{ margin: '6px 0 0', fontSize: '1.25rem' }}>{detail.customerName}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.875rem', fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                  verified
                </span>
                Verified Account
              </div>
            </div>
            <div
              className="dd-card"
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className="material-symbols-outlined">storefront</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button type="button" className="dd-link" style={{ width: '100%', textAlign: 'left', padding: 0 }} onClick={onOpenAddress}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span className="material-symbols-outlined" style={{ marginTop: 2 }}>
                    location_on
                  </span>
                  <div>
                    <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{detail.addressLine1}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--dd-muted)' }}>{detail.addressLine2}</p>
                  </div>
                </div>
                <span className="material-symbols-outlined" style={{ color: '#cbd5e1' }}>
                  chevron_right
                </span>
              </div>
            </button>
            <div style={{ height: 1, background: 'var(--dd-border)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <span className="material-symbols-outlined" style={{ marginTop: 2 }}>
                  call
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{detail.phone}</p>
                  <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--dd-muted)' }}>{detail.contactLine}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="dd-icon-btn dd-card" aria-label="SMS" onClick={onMessage}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    sms
                  </span>
                </button>
                <button type="button" className="dd-icon-btn dd-card" aria-label="Call" onClick={onCall}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    call
                  </span>
                </button>
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--dd-border)' }} />
            <div style={{ display: 'flex', gap: 12 }}>
              <span className="material-symbols-outlined" style={{ marginTop: 2 }}>
                schedule
              </span>
              <div>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>Expected Arrival</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--dd-muted)' }}>{detail.arrivalWindow}</p>
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', bottom: 72, zIndex: 5, marginBottom: 16 }}>
          {needsAccept && onAccept ? (
            <button type="button" className="dd-accent-btn" disabled={accepting} onClick={() => void onAccept()}>
              <span className="material-symbols-outlined">check_circle</span>
              {accepting ? 'Accepting…' : 'Accept delivery'}
            </button>
          ) : (
            <button type="button" className="dd-accent-btn" onClick={() => void onStartNavigation()}>
              <span className="material-symbols-outlined">navigation</span>
              Start Navigation
            </button>
          )}
          <button
            type="button"
            className="dd-text-btn"
            style={{ width: '100%', marginTop: 10, color: needsAccept ? '#94a3b8' : 'var(--dd-muted)' }}
            onClick={onOpenProof}
            disabled={needsAccept}
          >
            Proof of delivery
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Items to Deliver</h3>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: 999,
              background: '#f1f5f9',
              border: '1px solid var(--dd-border)',
            }}
          >
            {detail.items.length} Items
          </span>
        </div>

        {detail.items.map((item, idx) => (
          <div key={`${item.sku}-${idx}`} className="dd-item-row">
            <div className="dd-item-thumb" style={{ backgroundImage: `url(${item.image})` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700 }}>{item.name}</p>
              <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--dd-muted)', fontWeight: 500 }}>{item.sku}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700 }}>x{item.qty}</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--dd-muted)' }}>{item.unit}</p>
            </div>
          </div>
        ))}

        <div className="dd-note-card">
          <span className="material-symbols-outlined" style={{ marginTop: 2 }}>
            info
          </span>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.875rem', fontWeight: 700 }}>Driver Note</p>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--dd-muted)', lineHeight: 1.45 }}>{detail.driverNote}</p>
          </div>
        </div>
      </main>
    </>
  )
}
