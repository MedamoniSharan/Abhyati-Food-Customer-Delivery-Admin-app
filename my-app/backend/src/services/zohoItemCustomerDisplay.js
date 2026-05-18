import { env } from '../config/env.js'

/** Zoho Books item custom field id for the name shown in the customer app (optional). */
export function getZohoItemCustomerDisplayFieldId() {
  return String(env.ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID || '').trim()
}

export function getItemCustomerProductNameFromZoho(item) {
  const fid = getZohoItemCustomerDisplayFieldId()
  if (!fid || !item || typeof item !== 'object') return ''
  const cfs = item.custom_fields
  if (!Array.isArray(cfs)) return ''
  const row = cfs.find((x) => String(x?.customfield_id ?? x?.customfieldid ?? '') === fid)
  if (!row || row.value == null) return ''
  return String(row.value)
}

/**
 * Merge customer display name into an item's `custom_fields` for Zoho PUT.
 * @param {object|null|undefined} existingItem
 * @param {string} customerProductNameTrimmed
 * @returns {Array<{ customfield_id: string, value: string }>|undefined} `undefined` if not configured
 */
export function mergeCustomerProductNameIntoItemCustomFields(existingItem, customerProductNameTrimmed) {
  const fid = getZohoItemCustomerDisplayFieldId()
  if (!fid) return undefined
  const base = Array.isArray(existingItem?.custom_fields) ? existingItem.custom_fields.map((x) => ({ ...x })) : []
  const idx = base.findIndex((x) => String(x?.customfield_id ?? x?.customfieldid ?? '') === fid)
  if (idx >= 0) {
    base[idx] = { customfield_id: fid, value: customerProductNameTrimmed }
  } else {
    base.push({ customfield_id: fid, value: customerProductNameTrimmed })
  }
  return base
}

/** Virtual field for admin list/detail when env is set. */
export function withCustomerProductNameVirtual(item) {
  if (!item || typeof item !== 'object') return item
  const fid = getZohoItemCustomerDisplayFieldId()
  if (!fid) return item
  return {
    ...item,
    customer_product_name: getItemCustomerProductNameFromZoho(item)
  }
}

/**
 * Customer API: when custom field has a non-empty value, expose it as `name` so apps use one field.
 * @param {Record<string, unknown>} item
 */
export function applyCustomerDisplayNameToItemRecord(item) {
  if (!item || typeof item !== 'object') return item
  const display = getItemCustomerProductNameFromZoho(item).trim()
  if (!display) return item
  return { ...item, name: display }
}
