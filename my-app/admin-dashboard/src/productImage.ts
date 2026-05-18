import { apiUrl } from './apiBase'

export type ZohoItemRow = Record<string, unknown>

export function itemImageUrl(itemId: string, cacheBust?: string): string {
  const base = apiUrl(`/api/items/${encodeURIComponent(itemId)}/image`)
  if (!cacheBust) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}v=${encodeURIComponent(cacheBust)}`
}
