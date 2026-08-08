/** Multi-table DynamoDB naming and key helpers (one table per entity). */

export const ZOHO_TABLE_SUFFIXES = {
  contact: 'contacts',
  item: 'items',
  invoice: 'invoices',
  salesorder: 'salesorders',
  customerpayment: 'customerpayments',
  inventoryadjustment: 'inventoryadjustments',
  deliverychallan: 'deliverychallans',
  user: 'users',
  bankaccount: 'bankaccounts',
  quote: 'quotes',
  bill: 'bills',
  purchaseorder: 'purchaseorders',
  organization: 'organizations',
  project: 'projects',
  shipment: 'shipments',
  creditnote: 'creditnotes',
  estimate: 'estimates'
}

export const APP_TABLE_SUFFIXES = {
  assignment: 'assignments',
  payment: 'payment_records',
  notification: 'notifications',
  audit: 'audit'
}

export function entityTypeFromModulePath(modulePath) {
  const p = String(modulePath || '')
    .replace(/^\//, '')
    .split('/')[0]
    .toLowerCase()
  const map = {
    contacts: 'contact',
    items: 'item',
    invoices: 'invoice',
    salesorders: 'salesorder',
    customerpayments: 'customerpayment',
    inventoryadjustments: 'inventoryadjustment',
    deliverychallans: 'deliverychallan',
    users: 'user',
    quotes: 'quote',
    bills: 'bill',
    purchaseorders: 'purchaseorder',
    vendors: 'vendor',
    bankaccounts: 'bankaccount',
    organizations: 'organization',
    projects: 'project',
    shipments: 'shipment',
    creditnotes: 'creditnote',
    retainerinvoices: 'retainerinvoice',
    estimates: 'estimate'
  }
  return map[p] || p.replace(/s$/, '') || 'unknown'
}

export function idFieldForEntityType(entityType) {
  const map = {
    contact: 'contact_id',
    item: 'item_id',
    invoice: 'invoice_id',
    salesorder: 'salesorder_id',
    customerpayment: 'payment_id',
    inventoryadjustment: 'inventory_adjustment_id',
    deliverychallan: 'deliverychallan_id',
    user: 'user_id',
    quote: 'quote_id',
    bill: 'bill_id',
    purchaseorder: 'purchaseorder_id',
    bankaccount: 'account_id',
    organization: 'organization_id',
    project: 'project_id',
    shipment: 'shipment_id',
    creditnote: 'creditnote_id',
    estimate: 'estimate_id'
  }
  return map[entityType] || `${entityType}_id`
}

export function listKeyForEntityType(entityType) {
  return ZOHO_TABLE_SUFFIXES[entityType] || `${entityType}s`
}

export function tableSuffixForEntityType(entityType) {
  return ZOHO_TABLE_SUFFIXES[entityType] || `${entityType}s`
}

export function tableSuffixForAppKind(appKind) {
  return APP_TABLE_SUFFIXES[appKind] || String(appKind)
}

/** All physical table suffixes created by the setup script. */
export function allTableSuffixes() {
  return [
    ...Object.values(ZOHO_TABLE_SUFFIXES).filter((s, i, a) => a.indexOf(s) === i),
    ...Object.values(APP_TABLE_SUFFIXES)
  ]
}

export function zohoEntityKeys(entityType, id) {
  const eid = String(id)
  return {
    id: eid,
    entityType,
    entityId: eid
  }
}

export function appEntityKeys(appKind, id) {
  const eid = String(id)
  return {
    id: eid,
    entityType: `app_${appKind}`,
    entityId: eid
  }
}

export function emailGsiKeys(email, id) {
  const e = String(email || '')
    .trim()
    .toLowerCase()
  if (!e) return null
  return {
    GSI1PK: `EMAIL#${e}`,
    GSI1SK: `ID#${id}`
  }
}

export function customerGsiKeys(customerId, id, dateIso) {
  const cid = String(customerId || '').trim()
  if (!cid) return null
  const d = dateIso || '1970-01-01'
  return {
    GSI2PK: `CUSTOMER#${cid}`,
    GSI2SK: `DATE#${String(d).slice(0, 10)}#ID#${id}`
  }
}

export function recipientGsiKeys(audience, email, id) {
  const e = String(email || '')
    .trim()
    .toLowerCase()
  const a = String(audience || '').trim()
  if (!e || !a) return null
  return {
    GSI1PK: `NOTIF#${a}#${e}`,
    GSI1SK: `ID#${id}`
  }
}

export function driverAssignmentGsiKeys(driverEmail, id) {
  const e = String(driverEmail || '')
    .trim()
    .toLowerCase()
  if (!e) return null
  return {
    GSI1PK: `DRIVER#${e}`,
    GSI1SK: `ASG#${id}`
  }
}

/** Which GSIs a table should have. */
export function gsiConfigForSuffix(suffix) {
  if (suffix === 'contacts') return { gsi1: true, gsi2: false }
  if (suffix === 'invoices' || suffix === 'salesorders' || suffix === 'customerpayments') {
    return { gsi1: false, gsi2: true }
  }
  if (suffix === 'assignments' || suffix === 'notifications') return { gsi1: true, gsi2: false }
  return { gsi1: false, gsi2: false }
}
