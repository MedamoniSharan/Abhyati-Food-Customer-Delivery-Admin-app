import type { Screen } from '../types/app'

type Props = {
  screen: Screen
  cartCount: number
  onChange: (next: Screen) => void
}

export function BottomNav({ screen, cartCount, onChange }: Props) {
  if (screen === 'product') return null

  return (
    <nav className="bottom-nav">
      <button
        type="button"
        className={screen === 'home' ? 'nav-item active' : 'nav-item'}
        onClick={() => onChange('home')}
      >
        <span className="nav-icon-wrap">
          <span className="material-symbols-outlined">storefront</span>
        </span>
        <small>Home</small>
      </button>
      <button
        type="button"
        className={screen === 'orders' ? 'nav-item active' : 'nav-item'}
        onClick={() => onChange('orders')}
      >
        <span className="nav-icon-wrap">
          <span className="material-symbols-outlined">receipt_long</span>
        </span>
        <small>Orders</small>
      </button>
      <button
        type="button"
        className="nav-item"
        onClick={() => onChange('home')}
      >
        <span className="nav-icon-wrap">
          <span className="material-symbols-outlined">near_me</span>
        </span>
        <small>Nearby</small>
      </button>
      <button
        type="button"
        className={screen === 'cart' ? 'nav-item active' : 'nav-item'}
        onClick={() => onChange('cart')}
      >
        <span className="nav-icon-wrap">
          <span className="material-symbols-outlined">shopping_bag</span>
        </span>
        {cartCount > 0 ? <em className="nav-badge">{cartCount}</em> : null}
        <small>Cart</small>
      </button>
      <button
        type="button"
        className={screen === 'account' || screen === 'settings' ? 'nav-item active' : 'nav-item'}
        onClick={() => onChange('account')}
      >
        <span className="nav-icon-wrap">
          <span className="material-symbols-outlined">account_circle</span>
        </span>
        <small>Account</small>
      </button>
    </nav>
  )
}
