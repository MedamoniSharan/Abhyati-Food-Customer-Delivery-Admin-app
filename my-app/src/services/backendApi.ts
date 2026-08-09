import type { Order, Product } from '../types/app'
import { getApiBaseCandidates, logApiCandidatesOnce } from '../config/api'
import { readAuthToken } from '../utils/authSession'
import { FALLBACK_PRODUCT_IMAGE } from '../utils/productImage'
import { zohoAvailableStockQuantity, zohoMinOrderQuantity } from '../utils/productDetailFromZoho'

const API_BASE_URL_CANDIDATES = getApiBaseCandidates()

type ZohoPageContext = {
  page?: number
  per_page?: number
  has_more_page?: boolean
}

type ZohoListResponse<T> = {
  message?: string
  code?: number
  page_context?: ZohoPageContext
  [key: string]: T[] | string | number | ZohoPageContext | undefined
}

type ZohoItem = {
  item_id?: string
  name?: string
  rate?: number
  purchase_rate?: number
  description?: string
  image_document_id?: string
  has_attachment?: boolean
  image_name?: string
}

type ZohoSalesOrder = {
  id?: string
  invoiceId?: string
  invoiceNumber?: string
  date?: string
  status?: string
  deliveredAt?: string | null
  proofAvailable?: boolean
  proofMeta?: {
    fileName?: string
    mimeType?: string
    uploadedAt?: string | null
    recipientName?: string
    hasSignature?: boolean
    notes?: string
  } | null
  line_items?: Array<{ name?: string; quantity?: number }>
  items?: string
  total?: number
  amountInr?: number
}

function normalizePrice(value: unknown, fallback: number) {
  const asNumber = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber
  return fallback
}

function zohoItemCategory(item: ZohoItem): string {
  const raw = (item as Record<string, unknown>).category_name
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return 'Catalog'
}

function mapZohoItemToProduct(item: ZohoItem, index: number): Product {
  const itemId = item.item_id?.trim()
  const row = item as unknown as Record<string, unknown>
  const avail = zohoAvailableStockQuantity(row)
  const minPurchaseCount = zohoMinOrderQuantity(row, 1)
  const unitRaw = row.unit
  const unit = typeof unitRaw === 'string' && unitRaw.trim() ? unitRaw.trim() : undefined
  return {
    id: itemId ?? `zoho-${index}`,
    zohoItemId: itemId,
    name: item.name?.trim() || 'Item',
    subtitle: item.description?.trim() || '',
    priceInr: normalizePrice(item.rate ?? item.purchase_rate, 0),
    image: FALLBACK_PRODUCT_IMAGE,
    category: zohoItemCategory(item),
    ...(avail != null ? { availableStock: avail } : {}),
    ...(minPurchaseCount > 1 ? { minPurchaseCount } : {}),
    ...(unit ? { unit } : {}),
  }
}

function mapStatus(rawStatus?: string): Order['status'] {
  const status = (rawStatus || '').toLowerCase()
  if (status === 'delivered' || status.includes('deliver')) return 'Delivered'
  if (status === 'in_transit' || status.includes('transit') || status.includes('ship')) return 'Shipped'
  if (status === 'accepted') return 'Shipped'
  return 'Processing'
}

function mapZohoSalesOrderToOrder(order: ZohoSalesOrder, index: number): Order {
  const id = String(order.id || order.invoiceId || order.invoiceNumber || `order-${index}`)
  const itemsLabel =
    order.line_items
      ?.slice(0, 3)
      .map((line) => {
        const qty = line.quantity ? `${line.quantity}x` : ''
        return `${qty} ${line.name || 'Item'}`.trim()
      })
      .join(', ') || 'Items'

  return {
    id,
    invoiceId: order.invoiceId || order.id || id,
    invoiceNumber: order.invoiceNumber || order.id || id,
    date: order.date || '',
    status: mapStatus(order.status),
    items: order.items || itemsLabel,
    amountInr: normalizePrice(order.amountInr ?? order.total, 0),
    image: FALLBACK_PRODUCT_IMAGE,
    deliveredAt: order.deliveredAt || null,
    proofAvailable: Boolean(order.proofAvailable),
    proofMeta: order.proofMeta || null,
  }
}

type RequestOptions = {
  method?: string
  body?: BodyInit | null
  headers?: HeadersInit
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  let lastError: unknown = null
  const token = readAuthToken()

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
      const headers = new Headers(options.headers || {})
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetch(url, {
        method: options.method || 'GET',
        body: options.body,
        headers,
      })
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }
      return response.json() as Promise<T>
    } catch (error) {
      lastError = error
      console.warn('[API] request failed', { baseUrl, path, error })
    }
  }

  const err = lastError instanceof Error ? lastError : new Error('Unable to reach backend API')
  console.error('[API] all bases failed', path, err)
  throw err
}

const DEFAULT_ITEMS_PER_PAGE = 20

export type ZohoItemsPageResult = {
  products: Product[]
  /** True when Zoho reports more pages available */
  hasMore: boolean
}

export type ZohoItemsPageOpts = {
  /** Sent as `category_name` query param to GET /api/customer/items (server filters when set). */
  categoryName?: string
}

/**
 * Fetch one page of Zoho Books items. Caller appends results and calls again with page+1 while hasMore.
 */
export async function fetchZohoItemsPage(
  page: number,
  perPage = DEFAULT_ITEMS_PER_PAGE,
  opts?: ZohoItemsPageOpts
): Promise<ZohoItemsPageResult> {
  const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
  const cat = String(opts?.categoryName ?? '').trim()
  if (cat && cat.toLowerCase() !== 'all items') {
    qs.set('category_name', cat)
  }
  const response = await request<ZohoListResponse<ZohoItem>>(`/api/customer/items?${qs.toString()}`)
  const items = (response.items as ZohoItem[] | undefined) || []
  const hasMore = Boolean(response.page_context?.has_more_page)
  const baseIndex = (page - 1) * perPage
  const products = items.map((item, i) => mapZohoItemToProduct(item, baseIndex + i))
  return { products, hasMore }
}

export type CustomerProductCategory = { id: string; name: string }

export async function fetchCustomerProductCategories(): Promise<{
  configured: boolean
  categories: CustomerProductCategory[]
}> {
  try {
    const r = await request<{ configured?: boolean; categories?: CustomerProductCategory[] }>(
      '/api/customer/product-categories'
    )
    return {
      configured: Boolean(r.configured),
      categories: Array.isArray(r.categories) ? r.categories : []
    }
  } catch {
    return { configured: false, categories: [] }
  }
}

/** @deprecated Prefer fetchZohoItemsPage with scroll pagination */
export async function getBackendProducts(): Promise<Product[]> {
  const { products } = await fetchZohoItemsPage(1)
  return products
}

/** Full Zoho item (GET /items/:id) — includes stock locations, custom fields, etc. */
export async function fetchZohoItemDetail(itemId: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await request<Record<string, unknown>>(`/api/customer/items/${encodeURIComponent(itemId)}`)
    const nested = data['item'] as Record<string, unknown> | undefined
    if (nested && typeof nested === 'object') return nested
    return data
  } catch {
    return null
  }
}

export async function fetchCustomerInvoice(invoiceId: string): Promise<Record<string, unknown> | null> {
  if (!invoiceId) return null
  try {
    const data = await request<Record<string, unknown>>(
      `/api/customer/invoices/${encodeURIComponent(invoiceId)}`
    )
    const nested = data['invoice'] as Record<string, unknown> | undefined
    if (nested && typeof nested === 'object') return nested
    return data
  } catch {
    return null
  }
}

export type OrdersFetchResult = {
  orders: Order[]
  error: string | null
}

export async function getBackendOrders(): Promise<OrdersFetchResult> {
  try {
    const response = await request<{ orders?: ZohoSalesOrder[] }>('/api/customer/orders?per_page=200')
    const salesOrders = Array.isArray(response.orders) ? response.orders : []
    return {
      orders: salesOrders.map((row, i) => mapZohoSalesOrderToOrder(row, i)),
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load orders'
    return { orders: [], error: message }
  }
}

type CheckoutLineInput = {
  item_id?: string
  name?: string
  description?: string
  quantity: number
  rate: number
}

export async function createCustomerOrder(lineItems: CheckoutLineInput[]): Promise<Order | null> {
  const data = await request<{ order?: ZohoSalesOrder }>('/api/customer/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line_items: lineItems }),
  })
  const raw = data.order
  if (raw && typeof raw === 'object') {
    return mapZohoSalesOrderToOrder(raw, 0)
  }
  return null
}

export type OrderProofSummary = {
  invoiceNumber?: string
  recipientName?: string
  uploadedAt?: string | null
  deliveredAt?: string | null
  total?: number
  hasPhoto?: boolean
  hasSignature?: boolean
  fileName?: string
}

export async function fetchOrderProofSummary(invoiceId: string): Promise<OrderProofSummary | null> {
  if (!invoiceId) return null
  try {
    const data = await request<{ summary?: OrderProofSummary }>(
      `/api/customer/orders/${encodeURIComponent(invoiceId)}/proof/summary`
    )
    return data.summary && typeof data.summary === 'object' ? data.summary : null
  } catch {
    return null
  }
}

/** Load proof image for inline display (caller must revoke object URL). */
export async function fetchOrderProofAsset(
  invoiceId: string,
  kind: 'photo' | 'signature'
): Promise<Blob | null> {
  if (!invoiceId) return null
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  const token = readAuthToken()
  const paths =
    kind === 'photo'
      ? [
          `/api/customer/orders/${encodeURIComponent(invoiceId)}/proof/photo`,
          // Fallback to download endpoint (same bytes, attachment disposition).
          `/api/customer/orders/${encodeURIComponent(invoiceId)}/proof`,
        ]
      : [`/api/customer/orders/${encodeURIComponent(invoiceId)}/proof/signature`]

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    for (const path of paths) {
      try {
        const url = `${baseUrl.replace(/\/$/, '')}${path}`
        const headers = new Headers()
        if (token) headers.set('Authorization', `Bearer ${token}`)
        const response = await fetch(url, { headers })
        if (!response.ok) continue
        const blob = await response.blob()
        if (blob.size > 0 && !String(blob.type || '').includes('json')) return blob
      } catch {
        /* try next */
      }
    }
  }
  return null
}

export async function downloadOrderProof(invoiceId: string): Promise<boolean> {
  if (!invoiceId) return false
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  const token = readAuthToken()
  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/customer/orders/${encodeURIComponent(invoiceId)}/proof`
      const headers = new Headers()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetch(url, { headers })
      if (!response.ok) continue
      const blob = await response.blob()
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = `invoice-proof-${invoiceId}.jpg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
      return true
    } catch {
      /* try next base */
    }
  }
  return false
}
