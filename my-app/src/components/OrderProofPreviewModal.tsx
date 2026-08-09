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
  onClose: () => void
  onNotify?: (message: string, variant?: 'success' | 'warning' | 'error' | 'info') => void
}

export function OrderProofPreviewModal({ order, onClose, onNotify }: Props) {
  const invoiceId = order.invoiceId || order.id
  const [summary, setSummary] = useState<OrderProofSummary | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [lightbox, setLightbox] = useState<'photo' | 'signature' | null>(null)

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

        if (meta?.hasSignature !== false) {
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, onClose])

  const recipient = summary?.recipientName || order.proofMeta?.recipientName
  const lightboxSrc = lightbox === 'photo' ? photoUrl : lightbox === 'signature' ? signatureUrl : null

  return (
    <div className="proof-preview-overlay" role="dialog" aria-modal="true" aria-label="Delivery proof preview">
      <button type="button" className="proof-preview-backdrop" aria-label="Close preview" onClick={onClose} />
      <div className="proof-preview-sheet">
        <header className="proof-preview-header">
          <div>
            <p className="proof-preview-kicker">Delivery proof</p>
            <h2>Order #{order.id}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="proof-preview-body">
          {loading ? (
            <div className="proof-preview-loading" role="status" aria-live="polite">
              <span className="catalog-loader-spinner catalog-loader-spinner-sm" aria-hidden />
              <p>Loading proof…</p>
            </div>
          ) : (
            <>
              <div className="order-receipt-meta proof-preview-meta">
                <p>
                  <span>Invoice</span>
                  <strong>{summary?.invoiceNumber || order.invoiceNumber || order.id}</strong>
                </p>
                <p>
                  <span>Total</span>
                  <strong>{formatInr(summary?.total ?? order.amountInr)}</strong>
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
                    <button type="button" className="proof-preview-thumb-btn" onClick={() => setLightbox('photo')}>
                      <img src={photoUrl} alt="Signed invoice" className="order-receipt-img" />
                      <span className="proof-preview-zoom-hint">
                        <span className="material-symbols-outlined">zoom_in</span>
                        Tap to enlarge
                      </span>
                    </button>
                  ) : (
                    <p className="order-detail-muted">Invoice photo not available yet. Try Download, or refresh and preview again.</p>
                  )}
                </div>
                <div className="order-receipt-card">
                  <h3>Customer signature</h3>
                  {signatureUrl ? (
                    <button type="button" className="proof-preview-thumb-btn" onClick={() => setLightbox('signature')}>
                      <img src={signatureUrl} alt="Customer signature" className="order-receipt-img order-receipt-img--sig" />
                      <span className="proof-preview-zoom-hint">
                        <span className="material-symbols-outlined">zoom_in</span>
                        Tap to enlarge
                      </span>
                    </button>
                  ) : (
                    <p className="order-detail-muted">No signature on file for this delivery.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="proof-preview-footer">
          <button
            type="button"
            className="btn btn-outline block"
            disabled={loading || downloading || !photoUrl}
            onClick={() => {
              void (async () => {
                setDownloading(true)
                try {
                  const ok = await downloadOrderProof(invoiceId)
                  if (ok) onNotify?.('Proof downloaded', 'success')
                  else onNotify?.('Proof is not available to download yet', 'warning')
                } finally {
                  setDownloading(false)
                }
              })()
            }}
          >
            <span className="material-symbols-outlined">download</span>
            {downloading ? 'Downloading…' : 'Download proof'}
          </button>
          <button type="button" className="btn btn-dark block" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>

      {lightboxSrc ? (
        <div className="proof-lightbox" role="dialog" aria-modal="true" aria-label="Enlarged proof">
          <button type="button" className="proof-lightbox-backdrop" aria-label="Close enlarge" onClick={() => setLightbox(null)} />
          <img src={lightboxSrc} alt={lightbox === 'signature' ? 'Customer signature' : 'Signed invoice'} className="proof-lightbox-img" />
          <button type="button" className="proof-lightbox-close icon-btn" aria-label="Close enlarge" onClick={() => setLightbox(null)}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
