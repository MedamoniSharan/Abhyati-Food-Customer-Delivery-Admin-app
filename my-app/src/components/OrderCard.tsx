import type { Order } from '../types/app'
import { formatInr } from '../utils/currency'

type Props = {
  order: Order
  onTrackOrder: (order: Order) => void
  onViewDetails: (order: Order) => void
  onInvoice: (order: Order) => void
  onReorder: (order: Order) => void
}

export function OrderCard({ order, onTrackOrder, onViewDetails, onInvoice, onReorder }: Props) {
  const statusLabel =
    order.status === 'Processing' ? 'Preparing your order' : order.status === 'Shipped' ? 'Out for delivery' : 'Delivered'

  const actionLabel = order.status === 'Processing' ? 'View Order' : 'Track Delivery'

  return (
    <article className="order-card">
      <div className="order-main">
        <img src={order.image} alt={`Order ${order.id}`} />
        <div className="order-body">
          <div className="order-head">
            <span className={`status status-${order.status.toLowerCase()}`}>{statusLabel}</span>
            <span>{order.date}</span>
          </div>
          <h3>Order #{order.id}</h3>
          <p>{order.items}</p>
          {order.deliveredAt ? <p>Delivered at: {new Date(order.deliveredAt).toLocaleString()}</p> : null}
          {order.proofAvailable ? <p>Proof uploaded by delivery partner</p> : null}
          <strong>{formatInr(order.amountInr)}</strong>
        </div>
      </div>

      {order.status !== 'Delivered' ? (
        <button
          type="button"
          className={order.status === 'Shipped' ? 'btn btn-outline block' : 'btn btn-muted block'}
          onClick={() => (order.status === 'Shipped' ? onTrackOrder(order) : onViewDetails(order))}
        >
          <span className="material-symbols-outlined">local_shipping</span>
          {actionLabel}
        </button>
      ) : null}

      {order.status === 'Delivered' ? (
        <div className="delivered-actions">
          <button type="button" className="btn btn-muted" onClick={() => onInvoice(order)}>
            <span className="material-symbols-outlined">receipt_long</span>
            {order.proofAvailable ? 'Download Proof & Invoice' : 'Download Invoice'}
          </button>
          <button type="button" className="btn btn-dark" onClick={() => onReorder(order)}>
            <span className="material-symbols-outlined">refresh</span>
            Buy Again
          </button>
        </div>
      ) : null}
    </article>
  )
}
