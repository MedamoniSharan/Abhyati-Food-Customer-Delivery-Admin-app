import type { Product } from '../types/app'
import { getApiBaseCandidates, PUBLIC_API_BASE_URL } from '../config/api'

/** Shown when Zoho image fails or product has no image URL */
export const FALLBACK_PRODUCT_IMAGE = '/app-logo.png'

function apiBase(): string {
  return (getApiBaseCandidates()[0] || PUBLIC_API_BASE_URL).replace(/\/$/, '')
}

/** Absolute URL to backend-proxied Zoho item image (token stays server-side). */
export function getItemImageUrl(zohoItemId: string): string {
  return `${apiBase()}/api/items/${encodeURIComponent(zohoItemId)}/image`
}

export function getProductImageSrc(product: Product): string {
  if (product.zohoItemId) return getItemImageUrl(product.zohoItemId)
  return product.image || FALLBACK_PRODUCT_IMAGE
}
