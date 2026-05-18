export type Screen = 'home' | 'product' | 'orders' | 'cart' | 'account' | 'settings'

export type Product = {
  /** Cart key; Zoho `item_id` is a string (use as-is to avoid precision loss). */
  id: string | number
  /** When set, `ProductImage` loads via GET /api/items/:id/image (backend proxies Zoho). */
  zohoItemId?: string
  name: string
  subtitle: string
  priceInr: number
  oldPriceInr?: number
  image: string
  badge?: { label: string; tone: 'green' | 'red' }
  /** From Zoho (e.g. category name) or a generic label for filtering. */
  category: string
  /** Zoho available units; when set, cart / quantity must not exceed this. */
  availableStock?: number
}

export type OrderStatus = 'Shipped' | 'Processing' | 'Delivered'

export type Order = {
  id: string
  invoiceId?: string
  invoiceNumber?: string
  date: string
  status: OrderStatus
  items: string
  amountInr: number
  image: string
  deliveredAt?: string | null
  proofAvailable?: boolean
  proofMeta?: {
    fileName?: string
    mimeType?: string
    uploadedAt?: string | null
    recipientName?: string
  } | null
}

export type CartItem = {
  product: Product
  quantity: number
}
