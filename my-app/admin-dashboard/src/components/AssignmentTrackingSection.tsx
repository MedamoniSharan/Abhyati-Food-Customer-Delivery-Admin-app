import { useEffect, useState } from 'react'
import { adminDownload } from '../adminApi'
import { AdminBusyOverlay, AdminInlineSpinner } from './AdminDataLoader'

export type DeliveryAssignmentRow = {
  id: string
  invoiceId: string
  invoiceNumber: string
  customerName: string
  customerEmail?: string
  amount: number
  status: string
  driverName?: string
  driverEmail?: string
  createdAt?: string | null
  updatedAt?: string | null
  acceptedAt?: string | null
  deliveredAt?: string | null
  proof?: {
    recipientName?: string
    fileName?: string
    mimeType?: string
    uploadedAt?: string | null
    notes?: string
    signatureDocumentId?: string | null
    storedInZoho?: boolean
  } | null
}

/** Best timestamp for “latest first” ordering and the Updated column. */
export function assignmentActivityMs(row: DeliveryAssignmentRow): number {
  for (const iso of [
    row.updatedAt,
    row.deliveredAt,
    row.proof?.uploadedAt,
    row.acceptedAt,
    row.createdAt
  ]) {
    const t = Date.parse(String(iso || ''))
    if (Number.isFinite(t)) return t
  }
  const fromId = String(row.id || '').match(/^asg_(\d+)_/)
  if (fromId) return Number(fromId[1])
  return 0
}

export function formatAssignmentActivityDate(row: DeliveryAssignmentRow): string {
  const ms = assignmentActivityMs(row)
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString()
}

type ProofPreviewState = {
  row: DeliveryAssignmentRow
  photoUrl: string | null
  signatureUrl: string | null
  loading: boolean
}

type Paged<T> = { pageRows: T[]; totalPages: number; safePage: number }

type Props = {
  assignmentsPaged: Paged<DeliveryAssignmentRow>
  assignmentsSortAsc: boolean
  onToggleSort: () => void
  onAssignmentsPage: (fn: (p: number) => number) => void
  totalAssignments: number
  onRefresh: () => void
  /** True while a refresh request is in flight (shows overlay on the table). */
  assignmentsRefreshing?: boolean
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void
}

export function AssignmentTrackingSection({
  assignmentsPaged,
  assignmentsSortAsc,
  onToggleSort,
  onAssignmentsPage,
  totalAssignments,
  onRefresh,
  assignmentsRefreshing = false,
  onToast,
}: Props) {
  const [preview, setPreview] = useState<ProofPreviewState | null>(null)

  useEffect(() => {
    if (!preview?.row.proof) return
    let cancelled = false
    let photoUrl: string | null = null
    let signatureUrl: string | null = null

    void (async () => {
      try {
        const photoBlob = await adminDownload(
          `/api/admin/delivery-assignments/${encodeURIComponent(preview.row.id)}/proof/photo`
        )
        if (cancelled) return
        photoUrl = URL.createObjectURL(photoBlob)
        setPreview((p) => (p ? { ...p, photoUrl, loading: false } : p))

        try {
          const sigBlob = await adminDownload(
            `/api/admin/delivery-assignments/${encodeURIComponent(preview.row.id)}/proof/signature`
          )
          if (cancelled) return
          signatureUrl = URL.createObjectURL(sigBlob)
          setPreview((p) => (p ? { ...p, signatureUrl } : p))
        } catch {
          /* signature optional for older deliveries */
        }
      } catch (e) {
        if (!cancelled) {
          onToast(e instanceof Error ? e.message : 'Could not load proof', 'error')
          setPreview(null)
        }
      }
    })()

    return () => {
      cancelled = true
      if (photoUrl) URL.revokeObjectURL(photoUrl)
      if (signatureUrl) URL.revokeObjectURL(signatureUrl)
    }
  }, [preview?.row.id, onToast])

  function openProofPreview(row: DeliveryAssignmentRow) {
    if (!row.proof) return
    setPreview({ row, photoUrl: null, signatureUrl: null, loading: true })
  }

  function closeProofPreview() {
    setPreview((p) => {
      if (p?.photoUrl) URL.revokeObjectURL(p.photoUrl)
      if (p?.signatureUrl) URL.revokeObjectURL(p.signatureUrl)
      return null
    })
  }

  return (
    <>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={assignmentsRefreshing}
          onClick={() => void onRefresh()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          Refresh
        </button>
        {assignmentsRefreshing ? <AdminInlineSpinner label="Syncing assignments…" /> : null}
      </div>
      <div className="admin-busy-host">
        {assignmentsRefreshing && assignmentsPaged.pageRows.length > 0 ? (
          <AdminBusyOverlay label="Updating assignments…" />
        ) : null}
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="admin-th-sortable" onClick={onToggleSort} title="Sort by latest activity (newest first by default)">
                Updated {assignmentsSortAsc ? '▲' : '▼'}
              </th>
              <th>Invoice #</th>
              <th>Customer</th>
              <th>Driver</th>
              <th>Status</th>
              <th>Proof</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {assignmentsPaged.pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--admin-muted)', padding: '24px 12px', textAlign: 'center' }}>
                  No assignments found yet. Assign an invoice from Orders & delivery to get started.
                </td>
              </tr>
            ) : null}
            {assignmentsPaged.pageRows.map((row) => {
              const statusKey = String(row.status || 'assigned')
                .toLowerCase()
                .replace(/\s+/g, '_')
              const statusLabel =
                statusKey === 'assigned'
                  ? 'Assigned'
                  : statusKey === 'accepted'
                    ? 'Accepted'
                    : statusKey === 'in_transit'
                      ? 'In Transit'
                      : statusKey === 'delivered'
                        ? 'Delivered'
                        : row.status || '—'
              return (
                <tr key={row.id}>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--admin-muted)' }}>
                    {formatAssignmentActivityDate(row)}
                  </td>
                  <td style={{ fontWeight: 600 }}>{row.invoiceNumber || row.invoiceId}</td>
                  <td>{row.customerName || row.customerEmail || '—'}</td>
                  <td>{row.driverName || row.driverEmail || '—'}</td>
                  <td>
                    <span className={`admin-pill admin-pill--${statusKey}`}>{statusLabel}</span>
                  </td>
                  <td style={{ fontSize: '0.8125rem' }}>
                    {row.proof ? (
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 500 }}>{row.proof.fileName || 'proof.jpg'}</span>
                        {row.proof.recipientName ? (
                          <span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>
                            Signed by {row.proof.recipientName}
                          </span>
                        ) : null}
                        <span style={{ color: 'var(--admin-muted)', fontSize: '0.7rem' }}>Stored in Zoho Books</span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--admin-muted)' }}>Pending</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn-inline"
                        disabled={!row.proof}
                        onClick={() => openProofPreview(row)}
                      >
                        View proof
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn-inline"
                        disabled={!row.proof}
                        onClick={async () => {
                          try {
                            const blob = await adminDownload(
                              `/api/admin/delivery-assignments/${encodeURIComponent(row.id)}/proof`
                            )
                            const objectUrl = URL.createObjectURL(blob)
                            const link = document.createElement('a')
                            link.href = objectUrl
                            link.download = row.proof?.fileName || `proof-${row.invoiceNumber || row.id}.jpg`
                            document.body.appendChild(link)
                            link.click()
                            document.body.removeChild(link)
                            URL.revokeObjectURL(objectUrl)
                          } catch (e) {
                            onToast(e instanceof Error ? e.message : 'Proof download failed', 'error')
                          }
                        }}
                      >
                        Download
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
      <div className="admin-table-pagination">
        <button className="admin-btn admin-btn--ghost" type="button" onClick={() => onAssignmentsPage((p) => Math.max(1, p - 1))}>
          Prev
        </button>
        <span>
          Page {assignmentsPaged.safePage} / {assignmentsPaged.totalPages} ({totalAssignments} assignments)
        </span>
        <button
          className="admin-btn admin-btn--ghost"
          type="button"
          onClick={() => onAssignmentsPage((p) => Math.min(assignmentsPaged.totalPages, p + 1))}
        >
          Next
        </button>
      </div>

      {preview ? (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Delivery proof"
          onClick={closeProofPreview}
        >
          <div
            className="admin-modal admin-proof-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 6px' }}>Delivery proof · {preview.row.invoiceNumber || preview.row.invoiceId}</h3>
                <p style={{ margin: 0, color: 'var(--admin-muted)', fontSize: '0.875rem' }}>
                  {preview.row.customerName || preview.row.customerEmail || 'Customer'}
                  {preview.row.proof?.recipientName ? ` · Signed by ${preview.row.proof.recipientName}` : ''}
                </p>
              </div>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={closeProofPreview}>
                Close
              </button>
            </div>

            {preview.loading ? (
              <p style={{ margin: '20px 0', color: 'var(--admin-muted)' }}>Loading proof images…</p>
            ) : (
              <div className="admin-proof-grid">
                <div>
                  <p className="admin-proof-label">Signed invoice photo</p>
                  {preview.photoUrl ? (
                    <img src={preview.photoUrl} alt="Signed invoice" className="admin-proof-img" />
                  ) : (
                    <p style={{ color: 'var(--admin-muted)', fontSize: '0.875rem' }}>Photo not available.</p>
                  )}
                </div>
                <div>
                  <p className="admin-proof-label">Customer signature</p>
                  {preview.signatureUrl ? (
                    <img src={preview.signatureUrl} alt="Signature" className="admin-proof-img admin-proof-img--sig" />
                  ) : (
                    <p style={{ color: 'var(--admin-muted)', fontSize: '0.875rem' }}>
                      No signature stored (older deliveries may only have the invoice photo).
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
