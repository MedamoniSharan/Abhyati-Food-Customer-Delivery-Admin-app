import { env } from '../config/env.js'
import { findCustomerByEmail, getModuleById, updateModule } from './zohoBooksService.js'
import {
  applyCustomerPrice,
  parseTiersJson,
  serializeTiersForZoho,
  validateSingleTier
} from './customerPricingMath.js'
import { applyCustomerDisplayNameToItemRecord } from './zohoItemCustomerDisplay.js'

export { applyCustomerPrice, parseTiersJson } from './customerPricingMath.js'

let tiersCache = null
let tiersCacheAt = 0
const TIERS_TTL_MS = 30_000

export function isCustomerPricingConfigured() {
  const a = String(env.ZOHO_PRICING_TIERS_CONTACT_ID || '').trim()
  const b = String(env.ZOHO_CUSTOM_FIELD_TIERS_JSON_ID || '').trim()
  const c = String(env.ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID || '').trim()
  return Boolean(a && b && c)
}

export function invalidatePricingTierCache() {
  tiersCache = null
  tiersCacheAt = 0
}

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

/** Zoho Books may return `customfield_id` or `customfieldid` on contact/item payloads. */
function zohoCfRowId(row) {
  if (!row || typeof row !== 'object') return ''
  return String(row.customfield_id ?? row.customfieldid ?? '').trim()
}

export function getCustomFieldValue(contact, customFieldId) {
  if (!contact || typeof contact !== 'object' || !customFieldId) return ''
  const cfs = contact.custom_fields
  if (!Array.isArray(cfs)) return ''
  const want = String(customFieldId).trim()
  const row = cfs.find((x) => zohoCfRowId(x) === want)
  if (!row || row.value == null) return ''
  return String(row.value)
}

function mergeCustomFieldArray(contact, fieldId, value) {
  const id = String(fieldId)
  const cfs = Array.isArray(contact?.custom_fields) ? contact.custom_fields.map((x) => ({ ...x })) : []
  const idx = cfs.findIndex((x) => zohoCfRowId(x) === id)
  const row = { customfield_id: id, value }
  if (idx >= 0) cfs[idx] = row
  else cfs.push(row)
  return cfs
}

async function loadTiersCatalogUncached() {
  if (!isCustomerPricingConfigured()) return []
  const cid = String(env.ZOHO_PRICING_TIERS_CONTACT_ID).trim()
  const fid = String(env.ZOHO_CUSTOM_FIELD_TIERS_JSON_ID).trim()
  const data = await getModuleById('/contacts', cid)
  const c = data?.contact || data
  if (!c?.contact_id) throw new Error('Pricing tiers catalog contact not found in Zoho')
  const raw = getCustomFieldValue(c, fid)
  if (!raw || raw.trim() === '') return []
  return parseTiersJson(raw)
}

export async function listPricingTiers() {
  if (!isCustomerPricingConfigured()) return []
  const now = Date.now()
  if (tiersCache && now - tiersCacheAt < TIERS_TTL_MS) return tiersCache
  tiersCache = await loadTiersCatalogUncached()
  tiersCacheAt = now
  return tiersCache
}

export async function savePricingTiers(tiers) {
  if (!isCustomerPricingConfigured()) {
    const err = new Error('Customer pricing is not configured (missing Zoho env vars)')
    err.statusCode = 503
    throw err
  }
  const body = serializeTiersForZoho(tiers)
  const cid = String(env.ZOHO_PRICING_TIERS_CONTACT_ID).trim()
  const fid = String(env.ZOHO_CUSTOM_FIELD_TIERS_JSON_ID).trim()
  const data = await getModuleById('/contacts', cid)
  const c = data?.contact || data
  if (!c?.contact_id) {
    const err = new Error('Pricing tiers catalog contact not found')
    err.statusCode = 404
    throw err
  }
  const custom_fields = mergeCustomFieldArray(c, fid, body)
  await updateModule('/contacts', cid, { contact_id: cid, custom_fields })
  invalidatePricingTierCache()
  return listPricingTiers()
}

export async function getContactById(contactId) {
  const data = await getModuleById('/contacts', String(contactId))
  return data?.contact || data || null
}

export async function getActiveTierForContact(contact) {
  if (!isCustomerPricingConfigured() || !contact) return null
  const fid = String(env.ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID).trim()
  const tierId = getCustomFieldValue(contact, fid).trim()
  if (!tierId) return null
  const tiers = await listPricingTiers()
  return tiers.find((t) => t.id === tierId) || null
}

export async function getActiveTierForCustomerEmail(email) {
  const listed = await findCustomerByEmail(normEmail(email))
  if (!listed?.contact_id) return null
  const full = await getContactById(String(listed.contact_id))
  return getActiveTierForContact(full)
}

export function resolvePricingTierDisplay(contact, tiersList) {
  if (!isCustomerPricingConfigured() || !contact) {
    return { pricing_tier_id: null, pricing_tier_name: null }
  }
  const fid = String(env.ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID).trim()
  const tierId = getCustomFieldValue(contact, fid).trim()
  if (!tierId) return { pricing_tier_id: null, pricing_tier_name: null }
  const t = Array.isArray(tiersList) ? tiersList.find((x) => x.id === tierId) : null
  return { pricing_tier_id: tierId, pricing_tier_name: t?.name || null }
}

export async function setCustomerPricingTier(contactId, tierIdOrNull) {
  if (!isCustomerPricingConfigured()) {
    const err = new Error('Customer pricing is not configured (missing Zoho env vars)')
    err.statusCode = 503
    throw err
  }
  const id = String(contactId).trim()
  const fid = String(env.ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID).trim()
  const value = tierIdOrNull == null || String(tierIdOrNull).trim() === '' ? '' : String(tierIdOrNull).trim()

  if (value) {
    const tiers = await listPricingTiers()
    if (!tiers.some((t) => t.id === value)) {
      const err = new Error(`Unknown pricing tier id: ${value}`)
      err.statusCode = 400
      throw err
    }
  }

  const c = await getContactById(id)
  if (!c?.contact_id) {
    const err = new Error('Contact not found')
    err.statusCode = 404
    throw err
  }
  if (String(c.contact_type || '').toLowerCase() !== 'customer') {
    const err = new Error('Contact is not a customer')
    err.statusCode = 400
    throw err
  }

  const custom_fields = mergeCustomFieldArray(c, fid, value)
  await updateModule('/contacts', id, { contact_id: id, custom_fields })
  invalidatePricingTierCache()
  return getContactById(id)
}

/**
 * @param {Record<string, unknown>} item
 * @param {object|null} tier
 */
export function applyTierToItemRecord(item, tier) {
  if (!item || typeof item !== 'object') return item
  const out = { ...item }
  for (const key of ['rate', 'sales_rate']) {
    if (!(key in out)) continue
    const raw = out[key]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    out[key] = applyCustomerPrice(n, tier)
  }
  return applyCustomerDisplayNameToItemRecord(out)
}

export function applyTierToItemsResponse(zohoData, tier) {
  if (!zohoData || typeof zohoData !== 'object') return zohoData
  const items = zohoData.items
  if (!Array.isArray(items)) return zohoData
  return {
    ...zohoData,
    items: items.map((row) => applyTierToItemRecord(row, tier))
  }
}

export function applyTierToSingleItemResponse(zohoData, tier) {
  if (!zohoData || typeof zohoData !== 'object') return zohoData
  const nested = zohoData.item
  if (nested && typeof nested === 'object') {
    return { ...zohoData, item: applyTierToItemRecord(nested, tier) }
  }
  if (zohoData.item_id != null || typeof zohoData.name === 'string') {
    return applyTierToItemRecord(zohoData, tier)
  }
  return zohoData
}

function slugFromName(name) {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `tier_${Date.now()}`
}

export async function addPricingTier({ id, name, discountPercent, discountAmountInr }) {
  const tiers = await listPricingTiers()
  const tid = (id && String(id).trim()) || slugFromName(name)
  if (tiers.some((t) => t.id === tid)) {
    const err = new Error(`Pricing tier id already exists: ${tid}`)
    err.statusCode = 409
    throw err
  }
  const next = [
    ...tiers,
    {
      id: tid,
      name: String(name).trim(),
      ...(discountPercent != null ? { discountPercent: Number(discountPercent) } : {}),
      ...(discountAmountInr != null ? { discountAmountInr: Number(discountAmountInr) } : {})
    }
  ]
  return savePricingTiers(next)
}

export async function updatePricingTier(tierId, { name, discountPercent, discountAmountInr }) {
  const tiers = await listPricingTiers()
  const idx = tiers.findIndex((t) => t.id === tierId)
  if (idx < 0) {
    const err = new Error('Pricing tier not found')
    err.statusCode = 404
    throw err
  }
  const cur = tiers[idx]
  const merged = {
    ...cur,
    ...(name != null ? { name: String(name).trim() } : {}),
    ...(discountPercent !== undefined ? { discountPercent: Number(discountPercent) } : {}),
    ...(discountAmountInr !== undefined ? { discountAmountInr: Number(discountAmountInr) } : {})
  }
  validateSingleTier(merged)
  const next = [...tiers.slice(0, idx), merged, ...tiers.slice(idx + 1)]
  return savePricingTiers(next)
}

export async function deletePricingTier(tierId) {
  const tiers = await listPricingTiers()
  const next = tiers.filter((t) => t.id !== tierId)
  if (next.length === tiers.length) {
    const err = new Error('Pricing tier not found')
    err.statusCode = 404
    throw err
  }
  return savePricingTiers(next)
}
