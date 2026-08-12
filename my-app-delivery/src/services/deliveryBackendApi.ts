import { getApiBaseCandidates, logApiCandidatesOnce } from '../config/api'
import { notifyDriverSessionLost, readDriverToken } from '../utils/authSession'

const API_BASE_URL_CANDIDATES = getApiBaseCandidates()

export type DeliveryStop = {
  id: string
  createdAt?: string | null
  acceptedAt?: string | null
  deliveredAt?: string | null
  updatedAt?: string | null
  salesorder_id?: string
  deliveryNumber: string
  businessName: string
  orderId: string
  amount: number
  paymentLabel: 'COD' | 'Credit' | 'Paid' | string
  statusTag: string
  timeLabel: string
  isNext: boolean
  address: string
  note?: string
  /** True after driver uploaded signed receipt (stored on Zoho invoice + assignment). */
  proofUploaded?: boolean
  proofFileName?: string
  contactName: string
  contactRole: string
  initials: string
  customerName: string
  verified: boolean
  addressLine1: string
  addressLine2: string
  mapsQuery: string
  /** Customer-provided Google Maps share link (when set). */
  mapsLink?: string
  phone: string
  contactLine: string
  arrivalWindow: string
  driverNote: string
  podOrderLabel: string
  podSubtitle: string
  items: Array<{ name: string; sku: string; qty: number; unit: string; image: string }>
}

type DeliveryAssignment = {
  id: string
  invoiceId: string
  invoiceNumber: string
  customerName: string
  amount: number
  address?: string
  status: string
  createdAt?: string
  acceptedAt?: string | null
  deliveredAt?: string | null
  updatedAt?: string
  phone?: string
  contactLine?: string
  driverNote?: string
  arrivalWindow?: string
  mapsQuery?: string
  mapsLink?: string
  addressLine1?: string
  addressLine2?: string
  items?: Array<{ name: string; sku: string; qty: number; unit: string; image: string }>
  proof?: {
    fileName?: string
    recipientName?: string
    uploadedAt?: string | null
    zoho?: unknown
  } | null
}

function mapAssignmentToStop(a: DeliveryAssignment, rowIdx: number): DeliveryStop {
  const st = String(a.status || '').toLowerCase()
  const statusTag = st === 'assigned' ? 'Assigned' : st === 'accepted' ? 'Accepted' : st === 'in_transit' ? 'In Transit' : 'Delivered'
  const hasProof = Boolean(a.proof?.fileName || a.proof?.uploadedAt)
  const proofNote =
    statusTag === 'Delivered' && hasProof
      ? `Receipt saved in Zoho Books${a.proof?.fileName ? ` (${a.proof.fileName})` : ''}`
      : ''
  const items = Array.isArray(a.items) ? a.items : []
  const addressLine1 = a.addressLine1 || a.address || 'Address not available'
  const addressLine2 = a.addressLine2 || ''
  const mapsLink = String(a.mapsLink || '').trim()
  const mapsQuery = a.mapsQuery || mapsLink || a.address || a.customerName || ''
  const phone = a.phone || ''
  const contactLine = a.contactLine || (a.customerName ? `Main Contact: ${a.customerName}` : '')
  const driverNote = a.driverNote || 'Handle package with care.'
  const podSubtitle =
    items.length > 0
      ? `${a.customerName || 'Customer'} • ${items.length} Items`
      : 'Upload signed invoice photo'

  return {
    id: a.id,
    createdAt: a.createdAt ?? null,
    acceptedAt: a.acceptedAt ?? null,
    deliveredAt: a.deliveredAt ?? null,
    updatedAt: a.updatedAt ?? null,
    salesorder_id: a.invoiceId,
    deliveryNumber: `INV-${rowIdx + 1}`,
    businessName: a.customerName || 'Customer',
    orderId: a.invoiceNumber || a.invoiceId,
    amount: Number(a.amount) || 0,
    paymentLabel: 'Credit',
    statusTag,
    timeLabel: formatStopTimeLabel(a, statusTag),
    isNext: false,
    address: a.address || [addressLine1, addressLine2].filter(Boolean).join(', ') || 'Address not available',
    note: proofNote,
    proofUploaded: hasProof,
    proofFileName: a.proof?.fileName || '',
    contactName: a.customerName || 'Customer',
    contactRole: 'Invoice recipient',
    initials: String(a.customerName || 'C')
      .split(' ')
      .slice(0, 2)
      .map((s) => s[0] || '')
      .join('')
      .toUpperCase(),
    customerName: a.customerName || 'Customer',
    verified: st === 'delivered',
    addressLine1,
    addressLine2,
    mapsQuery,
    ...(mapsLink ? { mapsLink } : {}),
    phone,
    contactLine,
    arrivalWindow: a.arrivalWindow || 'Today',
    driverNote,
    podOrderLabel: a.invoiceNumber || a.invoiceId,
    podSubtitle,
    items,
  }
}

async function parseApiErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text.trim()) return `Request failed (${response.status})`
    const data = JSON.parse(text) as { message?: string }
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    return `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

async function request<T>(path: string): Promise<T> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
      const headers = new Headers()
      const token = readDriverToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetch(url, { headers })
      if (response.status === 401) {
        notifyDriverSessionLost('unauthorized')
        throw new Error('Session expired. Please sign in again.')
      }
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response))
      }
      return response.json() as Promise<T>
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Session expired')) throw error
      lastError = error
      console.warn('[API] request failed', { baseUrl, path, error })
    }
  }

  const err = lastError instanceof Error ? lastError : new Error('Unable to reach backend API')
  console.error('[API] all bases failed', path, err)
  throw err
}

async function requestWithInit<T>(path: string, init?: RequestInit): Promise<T> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
      const headers = new Headers(init?.headers)
      const token = readDriverToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetch(url, { ...init, headers })
      if (response.status === 401) {
        notifyDriverSessionLost('unauthorized')
        throw new Error('Session expired. Please sign in again.')
      }
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response))
      }
      return response.json() as Promise<T>
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Session expired')) throw error
      lastError = error
      console.warn('[API] request failed', { baseUrl, path, error })
    }
  }

  const err = lastError instanceof Error ? lastError : new Error('Unable to reach backend API')
  console.error('[API] all bases failed', path, err)
  throw err
}

const STATUS_ORDER: Record<string, number> = {
  assigned: 0,
  accepted: 1,
  in_transit: 2,
  delivered: 3
}

function formatStopTimeLabel(a: DeliveryAssignment, statusTag: string): string {
  const iso =
    statusTag === 'Delivered'
      ? a.deliveredAt || a.updatedAt
      : statusTag === 'In Transit'
        ? a.acceptedAt || a.createdAt
        : a.createdAt
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
}

export async function getDeliveryStops(): Promise<DeliveryStop[]> {
  const response = await request<{ assignments?: DeliveryAssignment[] }>('/api/delivery/assignments')
  const rows = Array.isArray(response.assignments) ? [...response.assignments] : []
  rows.sort((a, b) => {
    const sa = String(a.status || 'assigned').toLowerCase()
    const sb = String(b.status || 'assigned').toLowerCase()
    const ra = STATUS_ORDER[sa] ?? 99
    const rb = STATUS_ORDER[sb] ?? 99
    if (ra !== rb) return ra - rb
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  })
  const mapped = rows.map((a, rowIdx) => mapAssignmentToStop(a, rowIdx))
  let nextAssigned = false
  return mapped.map((stop) => {
    if (stop.statusTag === 'Delivered') return { ...stop, isNext: false }
    if (!nextAssigned) {
      nextAssigned = true
      return { ...stop, isNext: true }
    }
    return { ...stop, isNext: false }
  })
}

export async function getDeliveryStopDetail(stopId: string): Promise<DeliveryStop | null> {
  try {
    const response = await request<{ assignment?: DeliveryAssignment }>(
      `/api/delivery/assignments/${encodeURIComponent(stopId)}`
    )
    const a = response.assignment
    if (!a) return null
    return mapAssignmentToStop(a, 0)
  } catch {
    const all = await getDeliveryStops()
    return all.find((s) => s.id === stopId) || null
  }
}

export async function confirmDeliveryStop(
  stopId: string,
  recipientName: string,
  photo: File,
  signature?: Blob | File | null,
  notes?: string
): Promise<void> {
  const form = new FormData()
  form.append('photo', photo)
  form.append('recipient_name', recipientName)
  if (signature) {
    const sigFile =
      signature instanceof File
        ? signature
        : new File([signature], 'signature.png', { type: signature.type || 'image/png' })
    form.append('signature', sigFile)
  }
  if (notes) form.append('notes', notes)
  await requestWithInit<{ message: string }>(`/api/delivery/assignments/${encodeURIComponent(stopId)}/proof`, {
    method: 'POST',
    body: form
  })
}

export async function acceptDeliveryStop(stopId: string): Promise<void> {
  await requestWithInit<{ message: string }>(`/api/delivery/assignments/${encodeURIComponent(stopId)}/accept`, {
    method: 'POST'
  })
}

export async function updateDeliveryStopStatus(stopId: string, status: 'accepted' | 'in_transit' | 'delivered'): Promise<void> {
  await requestWithInit<{ message: string }>(`/api/delivery/assignments/${encodeURIComponent(stopId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
}
