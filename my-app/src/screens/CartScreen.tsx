import { useState } from 'react'
import { ProductImage } from '../components/ProductImage'
import type { CartItem } from '../types/app'
import { formatInr } from '../utils/currency'

export type CheckoutPaymentMode = 'pay_now' | 'pay_later'

type Props = {
  cartItems: CartItem[]
  onBackHome: () => void
  onIncrease: (productId: string | number) => void
  onDecrease: (productId: string | number) => void
  onRemove: (productId: string | number) => void
  onCheckout: (mode: CheckoutPaymentMode) => void
  checkoutBusy?: boolean
}

export function CartScreen({
  cartItems,
  onBackHome,
  onIncrease,
  onDecrease,
  onRemove,
  onCheckout,
  checkoutBusy = false
}: Props) {
  const [paymentMode, setPaymentMode] = useState<CheckoutPaymentMode>('pay_now')
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

        {cartItems.map((item) => {
          const minQty = item.product.minPurchaseCount ?? 1
          const atMinQty = item.quantity <= minQty
          return (
          <article key={item.product.id} className="order-card">
            <div className="order-main cart-line-header">
              <ProductImage product={item.product} />
              <div className="order-body">
                <div className="cart-line-title-row">
                  <h3>{item.product.name}</h3>
                  <button
                    type="button"
                    className="cart-delete-icon-btn"
                    aria-label={`Remove ${item.product.name}`}
                    onClick={() => onRemove(item.product.id)}
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
                <p>{item.product.subtitle}</p>
                <strong>{formatInr(item.product.priceInr * item.quantity)}</strong>
                {minQty > 1 ? <p className="cart-line-moq">Min. order: {minQty}{item.product.unit ? ` ${item.product.unit}` : ''}</p> : null}
                <div className="qty-inline cart-line-qty">
                  <button
                    type="button"
                    className="counter-btn"
                    aria-label={atMinQty ? 'Remove from cart' : 'Decrease quantity'}
                    onClick={() => onDecrease(item.product.id)}
                  >
                    <span className="material-symbols-outlined">{atMinQty ? 'delete' : 'remove'}</span>
                  </button>
                  <strong>
                    {item.quantity}
                    {item.product.unit ? ` ${item.product.unit}` : ''}
                  </strong>
                  <button type="button" className="counter-btn" aria-label="Increase quantity" onClick={() => onIncrease(item.product.id)}>
                    <span className="material-symbols-outlined">add</span>
                  </button>
                </div>
              </div>
            </div>
          </article>
          )
        })}
      </main>

      {cartItems.length > 0 ? (
        <div className="cart-footer">
          <div className="cart-footer-main">
            <div className="cart-payment-mode" role="radiogroup" aria-label="Payment method">
              <label className={`cart-payment-option${paymentMode === 'pay_now' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="payment-mode"
                  value="pay_now"
                  checked={paymentMode === 'pay_now'}
                  onChange={() => setPaymentMode('pay_now')}
                  disabled={checkoutBusy}
                />
                Pay now (Razorpay)
              </label>
              <label className={`cart-payment-option${paymentMode === 'pay_later' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="payment-mode"
                  value="pay_later"
                  checked={paymentMode === 'pay_later'}
                  onChange={() => setPaymentMode('pay_later')}
                  disabled={checkoutBusy}
                />
                Pay later (invoice)
              </label>
            </div>
            <div className="cart-footer-total">
              <small>Total</small>
              <strong>{formatInr(grandTotal)}</strong>
            </div>
          </div>
          <button
            type="button"
            className={`btn btn-accent${checkoutBusy ? ' btn--loading' : ''}`}
            disabled={checkoutBusy}
            onClick={() => onCheckout(paymentMode)}
            aria-busy={checkoutBusy}
          >
            {checkoutBusy ? (
              <span className="btn-loading-content">
                <span className="btn-spinner btn-spinner--light" aria-hidden />
                Processing…
              </span>
            ) : paymentMode === 'pay_now' ? (
              'Pay & place order'
            ) : (
              'Place order'
            )}
          </button>
        </div>
      ) : null}

      {checkoutBusy ? (
        <div className="checkout-busy-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="checkout-busy-card">
            <span className="checkout-busy-spinner" aria-hidden />
            <p className="checkout-busy-title">Processing your order</p>
            <p className="checkout-busy-hint">Please wait while we confirm checkout…</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
