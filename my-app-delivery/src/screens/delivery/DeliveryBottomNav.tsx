export type DriverTab = 'dashboard' | 'deliveries' | 'history' | 'profile'

type Props = {
  active: DriverTab
  onChange: (tab: DriverTab) => void
  onScan: () => void
}

export function DeliveryBottomNav({ active, onChange, onScan }: Props) {
  return (
    <>
      <button type="button" className="dd-nav-fab" aria-label="Scan QR code" onClick={onScan}>
        <span className="material-symbols-outlined">qr_code_scanner</span>
      </button>
      <nav className="dd-bottom-nav" aria-label="Driver navigation">
        <div className="dd-bottom-nav-inner">
          <button type="button" className={`dd-nav-item ${active === 'dashboard' ? 'active' : ''}`} onClick={() => onChange('dashboard')}>
            <span className="material-symbols-outlined">home</span>
            Home
          </button>
          <button type="button" className={`dd-nav-item ${active === 'deliveries' ? 'active' : ''}`} onClick={() => onChange('deliveries')}>
            <span className="material-symbols-outlined">local_shipping</span>
            Deliveries
          </button>
          <div className="dd-nav-spacer" aria-hidden />
          <button type="button" className={`dd-nav-item ${active === 'history' ? 'active' : ''}`} onClick={() => onChange('history')}>
            <span className="material-symbols-outlined">history</span>
            History
          </button>
          <button type="button" className={`dd-nav-item ${active === 'profile' ? 'active' : ''}`} onClick={() => onChange('profile')}>
            <span className="material-symbols-outlined">person</span>
            Profile
          </button>
        </div>
      </nav>
    </>
  )
}
