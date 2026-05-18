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
  deliveredAt?: string | null
  proof?: {
    recipientName?: string
    fileName?: string
    mimeType?: string
    uploadedAt?: string | null
    notes?: string
  } | null
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
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Assignment tracking & proof</h2>
      <p style={{ color: 'var(--admin-muted)', fontSize: '0.875rem', maxWidth: 760, lineHeight: 1.55, marginBottom: 14 }}>
        Track driver assignment status and uploaded proof-of-delivery metadata. Download proof files directly from this
        table.
      </p>
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
              <th className="admin-th-sortable" onClick={onToggleSort} title="Sort by proof date">
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
                    {row.deliveredAt
                      ? new Date(row.deliveredAt).toLocaleDateString()
                      : row.proof?.uploadedAt
                        ? new Date(row.proof.uploadedAt).toLocaleDateString()
                        : '—'}
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
                      </span>
                    ) : (
                      <span style={{ color: 'var(--admin-muted)' }}>Pending</span>
                    )}
                  </td>
                  <td>
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </button>
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
    </>
  )
}
