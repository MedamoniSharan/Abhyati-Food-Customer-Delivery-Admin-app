import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { env } from '../config/env.js'
import { getModuleById, updateModule } from './zohoBooksService.js'
import { getCustomFieldValue } from './customerPricingZohoService.js'

const categoryEntrySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200)
})

export const productCategoriesArraySchema = z.array(categoryEntrySchema)

let categoriesCache = null
let categoriesCacheAt = 0
const CATEGORIES_TTL_MS = 30_000

/** Zoho Books may return `customfield_id` or `customfieldid` on contact payloads. */
function zohoCfRowId(row) {
  if (!row || typeof row !== 'object') return ''
  return String(row.customfield_id ?? row.customfieldid ?? '').trim()
}

function mergeContactCustomField(contact, fieldId, value) {
  const id = String(fieldId)
  const cfs = Array.isArray(contact?.custom_fields) ? contact.custom_fields.map((x) => ({ ...x })) : []
  const idx = cfs.findIndex((x) => zohoCfRowId(x) === id)
  const row = { customfield_id: id, value }
  if (idx >= 0) cfs[idx] = row
  else cfs.push(row)
  return cfs
}

export function isProductCategoryConfigured() {
  const a = String(env.ZOHO_PRODUCT_CATEGORIES_CONTACT_ID || '').trim()
  const b = String(env.ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID || '').trim()
  const c = String(env.ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID || '').trim()
  return Boolean(a && b && c)
}

/** Which product-category env vars are set (for admin UI without exposing values). */
export function getProductCategoryEnvStatus() {
  return {
    hasContact: Boolean(String(env.ZOHO_PRODUCT_CATEGORIES_CONTACT_ID || '').trim()),
    hasJsonField: Boolean(String(env.ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID || '').trim()),
    hasItemField: Boolean(String(env.ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID || '').trim())
  }
}

export function getZohoItemCategoryFieldId() {
  return String(env.ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID || '').trim()
}

export function invalidateProductCategoryCache() {
  categoriesCache = null
  categoriesCacheAt = 0
}

async function loadCategoriesUncached() {
  if (!isProductCategoryConfigured()) return []
  const cid = String(env.ZOHO_PRODUCT_CATEGORIES_CONTACT_ID).trim()
  const fid = String(env.ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID).trim()
  const data = await getModuleById('/contacts', cid)
  const c = data?.contact || data
  if (!c?.contact_id) throw new Error('Product categories catalog contact not found in Zoho')
  const raw = getCustomFieldValue(c, fid)
  if (!raw || raw.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    const err = new Error('Invalid product categories JSON in Zoho custom field')
    err.statusCode = 400
    throw err
  }
  return productCategoriesArraySchema.parse(parsed)
}

export async function listProductCategories() {
  if (!isProductCategoryConfigured()) return []
  const now = Date.now()
  if (categoriesCache && now - categoriesCacheAt < CATEGORIES_TTL_MS) return categoriesCache
  categoriesCache = await loadCategoriesUncached()
  categoriesCacheAt = now
  return categoriesCache
}

export async function saveProductCategoriesFull(categories) {
  const list = productCategoriesArraySchema.parse(categories)
  const seen = new Set()
  for (const row of list) {
    if (seen.has(row.id)) {
      const err = new Error(`Duplicate category id: ${row.id}`)
      err.statusCode = 400
      throw err
    }
    seen.add(row.id)
  }
  if (!isProductCategoryConfigured()) {
    const err = new Error('Product categories are not configured (missing Zoho env vars)')
    err.statusCode = 503
    throw err
  }
  const cid = String(env.ZOHO_PRODUCT_CATEGORIES_CONTACT_ID).trim()
  const fid = String(env.ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID).trim()
  const data = await getModuleById('/contacts', cid)
  const c = data?.contact || data
  if (!c?.contact_id) {
    const err = new Error('Product categories catalog contact not found')
    err.statusCode = 404
    throw err
  }
  const custom_fields = mergeContactCustomField(c, fid, JSON.stringify(list))
  await updateModule('/contacts', cid, { contact_id: cid, custom_fields })
  invalidateProductCategoryCache()
  return listProductCategories()
}

export function newProductCategoryId() {
  return randomBytes(10).toString('hex')
}

export function getItemProductCategoryName(item) {
  const fid = getZohoItemCategoryFieldId()
  if (!fid || !item || typeof item !== 'object') return ''
  const cfs = item.custom_fields
  if (!Array.isArray(cfs)) return ''
  const row = cfs.find((x) => zohoCfRowId(x) === fid)
  if (!row || row.value == null) return ''
  return String(row.value).trim()
}

function rowItemId(item) {
  const raw = item?.item_id
  if (raw == null) return ''
  return String(raw).trim()
}

/**
 * Zoho GET /items list rows often omit `custom_fields` or omit the row for an empty value.
 * Detail GET fills `custom_fields` so category reads match the Zoho UI.
 */
export function itemListRowNeedsProductCategoryHydration(item) {
  if (!isProductCategoryConfigured()) return false
  const fid = getZohoItemCategoryFieldId()
  if (!fid || !item || typeof item !== 'object') return false
  const cfs = item.custom_fields
  if (!Array.isArray(cfs)) return true
  const row = cfs.find((x) => zohoCfRowId(x) === fid)
  return !row
}

/**
 * @param {unknown[]} items
 * @param {{ concurrency?: number }} [opts]
 * @returns {Promise<{ items: unknown[], detail_fetches: number }>}
 */
export async function hydrateItemsListRowsForProductCategoryField(items, { concurrency = 12 } = {}) {
  if (!isProductCategoryConfigured() || !Array.isArray(items)) {
    return { items: Array.isArray(items) ? items : [], detail_fetches: 0 }
  }

  const needIdx = []
  for (let i = 0; i < items.length; i += 1) {
    if (itemListRowNeedsProductCategoryHydration(items[i])) needIdx.push(i)
  }
  if (needIdx.length === 0) return { items, detail_fetches: 0 }

  const out = items.slice()
  const n = Math.max(1, Math.min(32, Number(concurrency) || 12))
  let cursor = 0

  async function worker() {
    while (true) {
      const j = cursor++
      if (j >= needIdx.length) return
      const i = needIdx[j]
      const row = out[i]
      const id = rowItemId(row)
      if (!id) continue
      try {
        const data = await getModuleById('/items', id)
        const full = data?.item || data
        if (full && typeof full === 'object') {
          const mergedCf = Array.isArray(full.custom_fields) ? full.custom_fields : row.custom_fields
          out[i] = { ...row, custom_fields: mergedCf }
        }
      } catch {
        /* keep list row */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(n, needIdx.length) }, () => worker()))
  return { items: out, detail_fetches: needIdx.length }
}

export function mergeProductCategoryNameIntoItemCustomFields(existingItem, categoryNameTrimmed) {
  const fid = getZohoItemCategoryFieldId()
  if (!fid) return undefined
  const base = Array.isArray(existingItem?.custom_fields) ? existingItem.custom_fields.map((x) => ({ ...x })) : []
  const idx = base.findIndex((x) => zohoCfRowId(x) === fid)
  const val = String(categoryNameTrimmed ?? '').trim()
  const row = { customfield_id: fid, value: val }
  if (idx >= 0) base[idx] = row
  else base.push(row)
  return base
}

/** Admin list/detail: attach resolved category id + display name when catalog is configured. */
export function withItemProductCategoryVirtual(item, categoriesList) {
  if (!item || typeof item !== 'object') return item
  if (!isProductCategoryConfigured()) return item
  const name = getItemProductCategoryName(item)
  const norm = String(name || '').trim().toLowerCase()
  const cat = Array.isArray(categoriesList)
    ? categoriesList.find((c) => String(c.name || '').trim().toLowerCase() === norm)
    : null
  return {
    ...item,
    product_category_name: name,
    product_category_id: cat?.id || ''
  }
}

/**
 * Customer API: normalize `category_name` for catalog filtering (matches client `zohoItemCategory`).
 * @param {Record<string, unknown>} item
 */
export function enrichCustomerItemCategoryDisplay(item) {
  if (!item || typeof item !== 'object') return item
  const fromCf = getItemProductCategoryName(item)
  if (fromCf) return { ...item, category_name: fromCf }
  const native = item.category_name
  if (typeof native === 'string' && native.trim()) return { ...item, category_name: native.trim() }
  return { ...item, category_name: 'Catalog' }
}

/**
 * Display category string used for catalog `category_name` filtering (no object clone).
 * Keep in sync with {@link enrichCustomerItemCategoryDisplay}.
 */
export function getItemCatalogCategoryForCustomerFilter(item) {
  if (!item || typeof item !== 'object') return ''
  if (isProductCategoryConfigured()) {
    const fromCf = getItemProductCategoryName(item)
    if (fromCf) return fromCf.trim()
    const native = item.category_name
    if (typeof native === 'string' && native.trim()) return native.trim()
    return 'Catalog'
  }
  const native = item.category_name
  return typeof native === 'string' ? native.trim() : ''
}

export function enrichCustomerItemsResponse(data) {
  if (!data || typeof data !== 'object' || !isProductCategoryConfigured()) return data
  const items = data.items
  if (!Array.isArray(items)) return data
  return {
    ...data,
    items: items.map((row) => enrichCustomerItemCategoryDisplay(row))
  }
}

export function enrichCustomerSingleItemResponse(data) {
  if (!data || typeof data !== 'object' || !isProductCategoryConfigured()) return data
  const nested = data.item
  if (nested && typeof nested === 'object') {
    return { ...data, item: enrichCustomerItemCategoryDisplay(nested) }
  }
  if (data.item_id != null || typeof data.name === 'string') {
    return enrichCustomerItemCategoryDisplay(data)
  }
  return data
}
