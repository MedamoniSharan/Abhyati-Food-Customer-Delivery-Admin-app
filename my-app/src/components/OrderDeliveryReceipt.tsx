import { useEffect, useState } from 'react'
import type { Order } from '../types/app'
import {
  downloadOrderProof,
  fetchOrderProofAsset,
  fetchOrderProofSummary,
  type OrderProofSummary,
} from '../services/backendApi'
import { formatInr } from '../utils/currency'

type Props = {
  order: Order
  onNotify?: (message: string, variant?: 'success' | 'warning' | 'error' | 'info') => void
}

export function OrderDeliveryReceipt({ order, onNotify }: Props) {
  const invoiceId = order.invoiceId || order.id
  const [summary, setSummary] = useState<OrderProofSummary | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let photoObjectUrl: string | null = null
    let signatureObjectUrl: string | null = null

    void (async () => {
      setLoading(true)
      try {
        const meta = await fetchOrderProofSummary(invoiceId)
        if (cancelled) return
        setSummary(meta)

        const photoBlob = await fetchOrderProofAsset(invoiceId, 'photo')
        if (cancelled) return
        if (photoBlob) {
          photoObjectUrl = URL.createObjectURL(photoBlob)
          setPhotoUrl(photoObjectUrl)
        }

        if (meta?.hasSignature) {
          const sigBlob = await fetchOrderProofAsset(invoiceId, 'signature')
          if (cancelled) return
          if (sigBlob) {
            signatureObjectUrl = URL.createObjectURL(sigBlob)
            setSignatureUrl(signatureObjectUrl)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl)
      if (signatureObjectUrl) URL.revokeObjectURL(signatureObjectUrl)
    }
  }, [invoiceId])

  if (!order.proofAvailable && order.status !== 'Delivered') return null

  const recipient = summary?.recipientName || order.proofMeta?.recipientName
  const receiptTotal = summary?.total ?? order.amountInr

  return (
    <section className="order-detail-section order-receipt-section">
      <h2>Delivery receipt</h2>
      {loading ? <p className="order-detail-muted">Loading delivery proof…</p> : null}
      {!loading ? (
        <>
          <div className="order-receipt-meta">
            <p>
              <span>Invoice</span>
              <strong>{summary?.invoiceNumber || order.invoiceNumber || order.id}</strong>
            </p>
            <p>
              <span>Total</span>
              <strong>{formatInr(receiptTotal)}</strong>
            </p>
            {recipient ? (
              <p>
                <span>Received by</span>
                <strong>{recipient}</strong>
              </p>
            ) : null}
            {order.deliveredAt || summary?.deliveredAt ? (
              <p>
                <span>Delivered</span>
                <strong>{new Date(order.deliveredAt || summary?.deliveredAt || '').toLocaleString()}</strong>
              </p>
            ) : null}
          </div>

          <div className="order-receipt-grid">
            <div className="order-receipt-card">
              <h3>Signed invoice photo</h3>
              {photoUrl ? (
                <img src={photoUrl} alt="Signed invoice" className="order-receipt-img" />
              ) : (
                <p className="order-detail-muted">Photo not available yet.</p>
              )}
            </div>
            <div className="order-receipt-card">
              <h3>Customer signature</h3>
              {signatureUrl ? (
                <img src={signatureUrl} alt="Customer signature" className="order-receipt-img order-receipt-img--sig" />
              ) : (
                <p className="order-detail-muted">
                  {order.proofMeta?.hasSignature ? 'Signature is processing…' : 'No signature on file for this delivery.'}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline block"
            onClick={() => {
              void downloadOrderProof(invoiceId).then((ok) => {
                if (ok) onNotify?.('Receipt downloaded', 'success')
                else onNotify?.('Receipt is not available to download yet', 'warning')
              })
            }}
          >
            Download receipt photo
          </button>
        </>
      ) : null}
    </section>
  )
}
