import { listModule } from './zohoBooksService.js'
import { probeZohoItemImageExists } from './zohoItemImageService.js'

/**
 * Whether a Zoho Books item row suggests a catalog image exists (list/detail shape varies by org).
 * Items failing this check may still 404 on GET …/image — metadata is the fast filter for admin tooling.
 */
export function itemIndicatesCatalogImage(item) {
  if (!item || typeof item !== 'object') return false
  const nested = item.image
  if (nested && typeof nested === 'object') {
    if (String(nested.document_id ?? nested.image_id ?? nested.item_image_id ?? '').trim()) return true
    if (String(nested.image_name ?? nested.name ?? '').trim()) return true
  }
  if (String(item.image_document_id ?? '').trim()) return true
  if (String(item.image_name ?? '').trim()) return true
  if (String(item.item_image_id ?? '').trim()) return true
  if (String(item.item_image_name ?? '').trim()) return true
  const docs = item.documents
  if (Array.isArray(docs)) {
    for (const d of docs) {
      if (!d || typeof d !== 'object') continue
      const t = String(d.file_type ?? d.document_type ?? d.type ?? '').toLowerCase()
      if (t.includes('image') || t.includes('photo') || t.includes('jpeg') || t.includes('png')) return true
    }
  }
  return false
}

function rowItemId(row) {
  if (!row || typeof row !== 'object') return ''
  const raw = row.item_id
  if (raw == null) return ''
  return String(raw).trim()
}

/**
 * Walk Zoho item list pages and return rows with no usable catalog image.
 * @param {{ maxPages?: number, perPage?: number, searchText?: string, verifyImage?: boolean, probeConcurrency?: number }} opts
 * When verifyImage is true, rows that list image metadata but return 404 from Zoho GET …/items/{id}/image
 * are included (same failure mode as the admin grey placeholder).
 */
export async function scanItemsMissingCatalogImage({
  maxPages = 45,
  perPage = 200,
  searchText,
  verifyImage = false,
  probeConcurrency = 8
} = {}) {
  const allRows = []
  let scanned = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const params = { page, per_page: perPage }
    if (String(searchText || '').trim()) params.search_text = String(searchText).trim().slice(0, 100)
    const data = await listModule('/items', params)
    const rows = Array.isArray(data?.items) ? data.items : []
    scanned += rows.length
    allRows.push(...rows)
    if (!data?.page_context?.has_more_page || rows.length === 0) break
  }

  const missingByKey = new Map()
  for (const row of allRows) {
    if (!itemIndicatesCatalogImage(row)) {
      const id = rowItemId(row)
      missingByKey.set(id || `__noid_${missingByKey.size}`, row)
    }
  }

  if (verifyImage) {
    const needProbe = allRows.filter((row) => itemIndicatesCatalogImage(row) && rowItemId(row))
    const n = Math.max(1, Math.min(32, Number(probeConcurrency) || 8))
    let cursor = 0
    async function worker() {
      while (true) {
        const i = cursor++
        if (i >= needProbe.length) return
        const row = needProbe[i]
        const id = rowItemId(row)
        try {
          const ok = await probeZohoItemImageExists(id)
          if (!ok) missingByKey.set(id, row)
        } catch {
          missingByKey.set(id, row)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, needProbe.length) }, () => worker()))
  }

  return { missing: [...missingByKey.values()], scanned }
}
