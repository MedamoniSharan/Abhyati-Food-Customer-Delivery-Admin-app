import type { DriverTab } from './DeliveryBottomNav'

type Props = {
  open: boolean
  onClose: () => void
  onNavigate: (tab: DriverTab) => void
  onLogout: () => void
}

export function DeliverySideMenu({ open, onClose, onNavigate, onLogout }: Props) {
  function go(tab: DriverTab) {
    onNavigate(tab)
    onClose()
  }

  return (
    <>
      <div className={open ? 'dd-menu-overlay open' : 'dd-menu-overlay'} onClick={onClose} aria-hidden={!open} />
      <aside className={open ? 'dd-side-menu open' : 'dd-side-menu'} aria-hidden={!open}>
        <div className="dd-side-menu-head">
          <div>
            <h3>Abhyati Delivery</h3>
            <p>Driver menu</p>
          </div>
          <button type="button" className="dd-icon-btn" aria-label="Close menu" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <nav className="dd-side-menu-links">
          <button type="button" onClick={() => go('dashboard')}>
            Home
          </button>
          <button type="button" onClick={() => go('deliveries')}>
            Deliveries
          </button>
          <button type="button" onClick={() => go('history')}>
            History
          </button>
          <button type="button" onClick={() => go('profile')}>
            Profile
          </button>
          <button type="button" className="dd-side-menu-logout" onClick={() => { onClose(); onLogout() }}>
            Log out
          </button>
        </nav>
      </aside>
    </>
  )
}
