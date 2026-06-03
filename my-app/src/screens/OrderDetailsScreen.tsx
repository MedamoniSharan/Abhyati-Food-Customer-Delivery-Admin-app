import { useEffect, useMemo, useState } from 'react'
import { OrderDeliveryReceipt } from '../components/OrderDeliveryReceipt'
import { useToast } from '../contexts/ToastContext'
import { fetchCustomerInvoice } from '../services/backendApi'
import type { Order } from '../types/app'
import { formatInr } from '../utils/currency'
import { FALLBACK_PRODUCT_IMAGE } from '../utils/productImage'

type Props = {
  order: Order
  onBack: () => void
}

type LineRow = { name: string; quantity: number; rate: number }

function statusLabel(status: Order['status']) {
  if (status === 'Processing') return 'Preparing your order'
  if (status === 'Shipped') return 'Out for delivery'
  return 'Delivered'
}

function parseLineItemsFromInvoice(invoice: Record<string, unknown> | null): LineRow[] {
  const raw = invoice?.line_items
  if (!Array.isArray(raw)) return []
  return raw
    .map((line) => {
      const row = line as Record<string, unknown>
      const name = String(row.name || row.description || 'Item').trim() || 'Item'
      const quantity = Number(row.quantity) || 1
      const rate = Number(row.rate ?? row.item_total) || 0
      return { name, quantity, rate }
    })
    .filter((row) => row.name)
}

function parseItemsFromLabel(itemsLabel: string): LineRow[] {
  const trimmed = itemsLabel.trim()
  if (!trimmed || trimmed.toLowerCase() === 'items') return []
  return trimmed.split(',').map((part) => {
    const match = part.trim().match(/^(\d+)x\s+(.+)$/i)
    if (match) {
      return { name: match[2].trim(), quantity: Number(match[1]) || 1, rate: 0 }
    }
    return { name: part.trim(), quantity: 1, rate: 0 }
  })
}

export function OrderDetailsScreen({ order, onBack }: Props) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(Boolean(order.invoiceId || order.id))
  const [lineRows, setLineRows] = useState<LineRow[]>(() => parseItemsFromLabel(order.items))

  const invoiceId = order.invoiceId || order.id

  useEffect(() => {
    let cancelled = false
    if (lineRows.length > 0) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const invoice = await fetchCustomerInvoice(invoiceId)
        if (cancelled) return
        const parsed = parseLineItemsFromInvoice(invoice)
        if (parsed.length > 0) setLineRows(parsed)
      } catch {
        if (!cancelled) {
          showToast('Could not load full order details. Try again later.', { variant: 'warning' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId, lineRows.length, showToast])

  const displayLines = useMemo(() => {
    if (lineRows.length > 0) return lineRows
    return parseItemsFromLabel(order.items)
  }, [lineRows, order.items])

  return (
    <>
      <header className="top-header light-header">
        <div className="header-row centered-title">
          <button type="button" className="icon-btn" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>Order Details</h1>
          <span style={{ width: 40 }} aria-hidden="true" />
        </div>
      </header>

      <main className="content order-detail-content">
        <article className="order-card order-detail-card">
          <div className="order-main">
            <img src={order.image || FALLBACK_PRODUCT_IMAGE} alt={`Order ${order.id}`} />
            <div className="order-body">
              <div className="order-head">
                <span className={`status status-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span>
                <span>{order.date}</span>
              </div>
              <h3>Order #{order.invoiceNumber || order.id}</h3>
              <strong>{formatInr(order.amountInr)}</strong>
              {order.deliveredAt ? <p>Delivered at: {new Date(order.deliveredAt).toLocaleString()}</p> : null}
            </div>
          </div>
        </article>

        <section className="order-detail-section">
          <h2>Items</h2>
          {loading ? <p className="order-detail-muted">Loading items…</p> : null}
          {!loading && displayLines.length === 0 ? (
            <p className="order-detail-muted">Item details are not available for this order yet.</p>
          ) : null}
          {!loading
            ? displayLines.map((line, index) => (
                <div key={`${line.name}-${index}`} className="order-detail-line">
                  <span>
                    {line.quantity}x {line.name}
                  </span>
                  {line.rate > 0 ? <span>{formatInr(line.rate * line.quantity)}</span> : null}
                </div>
              ))
            : null}
        </section>

        {order.status === 'Delivered' ? (
          <OrderDeliveryReceipt order={order} onNotify={(msg, variant) => showToast(msg, { variant })} />
        ) : null}

        <section className="order-detail-section">
          <h2>{order.status === 'Delivered' ? 'Order status' : 'What happens next'}</h2>
          <p className="order-detail-muted">
            {order.status === 'Processing'
              ? 'Your order is being prepared. You will see delivery updates here once it is on the way.'
              : order.status === 'Shipped'
                ? 'Your order is out for delivery. Check back here for proof of delivery when it is completed.'
                : 'This order has been delivered. Your signed invoice photo and signature are shown above.'}
          </p>
        </section>
      </main>
    </>
  )
}
