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
  onCheckout: (mode: CheckoutPaymentMode) => void
  checkoutBusy?: boolean
}

export function CartScreen({
  cartItems,
  onBackHome,
  onIncrease,
  onDecrease,
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
