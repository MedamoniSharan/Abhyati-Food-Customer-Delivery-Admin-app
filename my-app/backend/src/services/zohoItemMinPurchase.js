import { env } from '../config/env.js'

/** Zoho Books item custom field id for minimum purchase / order quantity (optional). */
export function getZohoItemMinPurchaseFieldId() {
  return String(env.ZOHO_CUSTOM_FIELD_ITEM_MIN_PURCHASE_ID || '').trim()
}

/**
 * @param {object|null|undefined} item
 * @returns {number|null}
 */
export function getItemMinPurchaseCountFromZoho(item) {
  const fid = getZohoItemMinPurchaseFieldId()
  if (!fid || !item || typeof item !== 'object') return null
  const cfs = item.custom_fields
  if (!Array.isArray(cfs)) return null
  const row = cfs.find((x) => String(x?.customfield_id ?? x?.customfieldid ?? '') === fid)
  if (!row || row.value == null || String(row.value).trim() === '') return null
  const n = Number(row.value)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.floor(n)
}

/**
 * Zoho GET /items list rows often omit `custom_fields`.
 * Detail GET fills them so min purchase reads match the Zoho UI.
 */
export function itemListRowNeedsMinPurchaseHydration(item) {
  const fid = getZohoItemMinPurchaseFieldId()
  if (!fid || !item || typeof item !== 'object') return false
  const cfs = item.custom_fields
  if (!Array.isArray(cfs)) return true
  const row = cfs.find((x) => String(x?.customfield_id ?? x?.customfieldid ?? '') === fid)
  return !row
}

/**
 * Merge min purchase count into an item's `custom_fields` for Zoho PUT.
 * Empty / null clears the field value.
 * @param {object|null|undefined} existingItem
 * @param {unknown} minPurchaseRaw
 * @returns {Array<{ customfield_id: string, value: string }>|undefined}
 */
export function mergeMinPurchaseIntoItemCustomFields(existingItem, minPurchaseRaw) {
  const fid = getZohoItemMinPurchaseFieldId()
  if (!fid) return undefined
  let value = ''
  if (minPurchaseRaw != null && String(minPurchaseRaw).trim() !== '') {
    const n = Number(String(minPurchaseRaw).trim())
    if (!Number.isFinite(n) || n < 1) {
      const err = new Error('Min purchase count must be a whole number of 1 or greater')
      err.statusCode = 400
      throw err
    }
    value = String(Math.floor(n))
  }
  const base = Array.isArray(existingItem?.custom_fields) ? existingItem.custom_fields.map((x) => ({ ...x })) : []
  const idx = base.findIndex((x) => String(x?.customfield_id ?? x?.customfieldid ?? '') === fid)
  if (idx >= 0) {
    base[idx] = { customfield_id: fid, value }
  } else {
    base.push({ customfield_id: fid, value })
  }
  return base
}

/** Virtual field for admin / customer item payloads when env is set. */
export function withMinPurchaseCountVirtual(item) {
  if (!item || typeof item !== 'object') return item
  const fid = getZohoItemMinPurchaseFieldId()
  if (!fid) return item
  return {
    ...item,
    min_purchase_count: getItemMinPurchaseCountFromZoho(item)
  }
}

/**
 * Attach `min_purchase_count` on a Zoho single-item API shape `{ item: {...} }` or bare item.
 * @param {unknown} data
 */
export function enrichMinPurchaseOnItemResponse(data) {
  if (!getZohoItemMinPurchaseFieldId() || !data || typeof data !== 'object') return data
  const o = data
  if (o.item && typeof o.item === 'object') {
    return { ...o, item: withMinPurchaseCountVirtual(o.item) }
  }
  return withMinPurchaseCountVirtual(o)
}

/**
 * @param {unknown} data Zoho list shape with `items`
 */
export function enrichMinPurchaseOnItemsListResponse(data) {
  if (!getZohoItemMinPurchaseFieldId() || !data || typeof data !== 'object') return data
  const items = data.items
  if (!Array.isArray(items)) return data
  return { ...data, items: items.map((row) => withMinPurchaseCountVirtual(row)) }
}
