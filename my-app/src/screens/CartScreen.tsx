import { ProductImage } from '../components/ProductImage'
import type { CartItem } from '../types/app'
import { formatInr } from '../utils/currency'

type Props = {
  cartItems: CartItem[]
  onBackHome: () => void
  onIncrease: (productId: string | number) => void
  onDecrease: (productId: string | number) => void
  onCheckout: () => void
}

export function CartScreen({ cartItems, onBackHome, onIncrease, onDecrease, onCheckout }: Props) {
  const grandTotal = cartItems.reduce((sum, item) => sum + item.product.priceInr * item.quantity, 0)

  return (
    <>
      <header className="top-header light-header">
        <div className="header-row centered-title">
          <button type="button" className="icon-btn" onClick={onBackHome}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>Cart</h1>
          <div className="icon-btn" />
        </div>
      </header>

      <main className={`content orders-content${cartItems.length > 0 ? ' cart-scroll-clear-footer' : ''}`}>
        {cartItems.length === 0 ? (
          <div className="empty-state">
            <h3>Your cart is empty</h3>
            <p>Add products from Home or Product details.</p>
          </div>
        ) : null}

        {cartItems.map((item) => (
          <article key={item.product.id} className="order-card">
            <div className="order-main">
              <ProductImage product={item.product} />
              <div className="order-body">
                <h3>{item.product.name}</h3>
                <p>{item.product.subtitle}</p>
                <strong>{formatInr(item.product.priceInr * item.quantity)}</strong>
              </div>
            </div>
            <div className="qty-inline">
              <button type="button" className="counter-btn" onClick={() => onDecrease(item.product.id)}>
                <span className="material-symbols-outlined">remove</span>
              </button>
              <strong>{item.quantity}</strong>
              <button type="button" className="counter-btn" onClick={() => onIncrease(item.product.id)}>
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          </article>
        ))}
      </main>

      {cartItems.length > 0 ? (
        <div className="cart-footer">
          <div>
            <small>Total</small>
            <strong>{formatInr(grandTotal)}</strong>
          </div>
          <button type="button" className="btn btn-accent" onClick={onCheckout}>
            Checkout
          </button>
        </div>
      ) : null}
    </>
  )
}
