import { createLogger, serializeError } from '../../util/logger.js'
import { isDynamoReadsEnabled, isDynamoWritesEnabled, tableNameForEntityType } from './dynamoClient.js'
import {
  customerGsiKeys,
  emailGsiKeys,
  entityTypeFromModulePath,
  idFieldForEntityType,
  listKeyForEntityType,
  zohoEntityKeys
} from './dynamoKeys.js'
import { getItem, queryGsi1, queryGsi2, safeDeleteItem, safePutItem, scanAll } from './dynamoRepository.js'

const log = createLogger('dynamo-mirror')

function pickEntityId(entityType, entity) {
  if (!entity || typeof entity !== 'object') return null
  const field = idFieldForEntityType(entityType)
  const id = entity[field] ?? entity.id
  return id != null && String(id).trim() ? String(id) : null
}

function extractEntityFromZohoBody(modulePath, body) {
  const entityType = entityTypeFromModulePath(modulePath)
  const listKey = listKeyForEntityType(entityType)
  if (body?.[entityType] && typeof body[entityType] === 'object') {
    return { entityType, entity: body[entityType] }
  }
  if (Array.isArray(body?.[listKey]) && body[listKey][0]) {
    return { entityType, entity: body[listKey][0] }
  }
  if (body && typeof body === 'object' && pickEntityId(entityType, body)) {
    return { entityType, entity: body }
  }
  return { entityType, entity: null }
}

export function buildZohoMirrorItem(entityType, entity) {
  const id = pickEntityId(entityType, entity)
  if (!id) return null
  const keys = zohoEntityKeys(entityType, id)
  const item = {
    ...keys,
    payload: entity,
    syncedAt: new Date().toISOString(),
    source: 'zoho'
  }
  const email =
    entity.email ||
    (Array.isArray(entity.contact_persons)
      ? entity.contact_persons.find((p) => p?.is_primary_contact)?.email || entity.contact_persons[0]?.email
      : null)
  if (entityType === 'contact') {
    const gsi1 = emailGsiKeys(email, id)
    if (gsi1) Object.assign(item, gsi1)
  }

  const customerId = entity.customer_id || entity.contact_id
  const date =
    entity.date || entity.created_time || entity.last_modified_time || new Date().toISOString().slice(0, 10)
  if (entityType === 'invoice' || entityType === 'salesorder' || entityType === 'customerpayment') {
    const gsi2 = customerGsiKeys(customerId, id, String(date).slice(0, 10))
    if (gsi2) Object.assign(item, gsi2)
  }
  return item
}

export async function mirrorZohoEntity(entityType, entity) {
  if (!isDynamoWritesEnabled()) return
  const item = buildZohoMirrorItem(entityType, entity)
  if (!item) return
  await safePutItem(tableNameForEntityType(entityType), item)
}

export async function mirrorZohoModuleResponse(modulePath, body) {
  if (!isDynamoWritesEnabled()) return
  try {
    const { entityType, entity } = extractEntityFromZohoBody(modulePath, body)
    if (entity) await mirrorZohoEntity(entityType, entity)
  } catch (err) {
    log.error('mirrorZohoModuleResponse failed', serializeError(err))
  }
}

export async function mirrorZohoListPage(modulePath, body) {
  if (!isDynamoWritesEnabled()) return
  try {
    const entityType = entityTypeFromModulePath(modulePath)
    const listKey = listKeyForEntityType(entityType)
    const rows = Array.isArray(body?.[listKey]) ? body[listKey] : []
    for (const row of rows) {
      await mirrorZohoEntity(entityType, row)
    }
  } catch (err) {
    log.error('mirrorZohoListPage failed', serializeError(err))
  }
}

export async function deleteMirroredEntity(modulePath, id) {
  if (!isDynamoWritesEnabled()) return
  const entityType = entityTypeFromModulePath(modulePath)
  await safeDeleteItem(tableNameForEntityType(entityType), id)
}

function applyContactFilters(rows, query = {}) {
  let out = rows
  if (query.contact_type) {
    const want = String(query.contact_type).toLowerCase()
    out = out.filter((c) => String(c.contact_type || '').toLowerCase() === want)
  }
  if (query.email) {
    const email = String(query.email).trim().toLowerCase()
    out = out.filter((c) => {
      if (String(c.email || '').trim().toLowerCase() === email) return true
      const persons = Array.isArray(c.contact_persons) ? c.contact_persons : []
      return persons.some((p) => String(p?.email || '').trim().toLowerCase() === email)
    })
  }
  if (query.email_contains) {
    const frag = String(query.email_contains).trim().toLowerCase()
    out = out.filter((c) => {
      if (String(c.email || '').toLowerCase().includes(frag)) return true
      const persons = Array.isArray(c.contact_persons) ? c.contact_persons : []
      return persons.some((p) => String(p?.email || '').toLowerCase().includes(frag))
    })
  }
  if (query.contact_name_contains) {
    const frag = String(query.contact_name_contains).trim().toLowerCase()
    out = out.filter((c) => String(c.contact_name || '').toLowerCase().includes(frag))
  }
  if (query.search_text) {
    const frag = String(query.search_text).trim().toLowerCase()
    out = out.filter((c) => {
      const blob = `${c.contact_name || ''} ${c.email || ''} ${c.notes || ''}`.toLowerCase()
      return blob.includes(frag)
    })
  }
  if (query.status) {
    const st = String(query.status).toLowerCase()
    out = out.filter((c) => String(c.status || '').toLowerCase() === st)
  }
  return out
}

function applyGenericFilters(rows, query = {}) {
  let out = rows
  if (query.customer_id) {
    const cid = String(query.customer_id)
    out = out.filter((r) => String(r.customer_id || r.contact_id || '') === cid)
  }
  if (query.status) {
    const st = String(query.status).toLowerCase()
    out = out.filter((r) => String(r.status || '').toLowerCase() === st)
  }
  if (query.search_text) {
    const frag = String(query.search_text).trim().toLowerCase()
    out = out.filter((r) => {
      const name = String(r.name || r.item_name || r.contact_name || '')
      const sku = String(r.sku || r.rate || '')
      const desc = String(r.description || r.purchase_description || '')
      const id = String(
        r.item_id || r.invoice_id || r.salesorder_id || r.payment_id || r.contact_id || r.id || ''
      )
      return `${name} ${sku} ${desc} ${id}`.toLowerCase().includes(frag)
    })
  }
  return out
}

function paginate(rows, query = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(200, Math.max(1, Number(query.per_page) || 200))
  const start = (page - 1) * perPage
  const slice = rows.slice(start, start + perPage)
  return {
    slice,
    page_context: {
      page,
      per_page: perPage,
      has_more_page: start + perPage < rows.length,
      total: rows.length
    }
  }
}

export async function readEntityFromDynamo(modulePath, id) {
  if (!isDynamoReadsEnabled()) return null
  const entityType = entityTypeFromModulePath(modulePath)
  const item = await getItem(tableNameForEntityType(entityType), id)
  if (!item?.payload) return null
  return { [entityType]: item.payload, code: 0 }
}

export async function listEntitiesFromDynamo(modulePath, query = {}) {
  if (!isDynamoReadsEnabled()) return null
  const entityType = entityTypeFromModulePath(modulePath)
  const listKey = listKeyForEntityType(entityType)
  const tableName = tableNameForEntityType(entityType)

  if (entityType === 'contact' && query.email && !query.contact_name_contains && !query.search_text) {
    const email = String(query.email).trim().toLowerCase()
    const { items } = await queryGsi1(tableName, `EMAIL#${email}`)
    let rows = items.map((i) => i.payload).filter(Boolean)
    rows = applyContactFilters(rows, query)
    const { slice, page_context } = paginate(rows, query)
    return { [listKey]: slice, page_context, code: 0 }
  }

  if (
    (entityType === 'invoice' || entityType === 'salesorder' || entityType === 'customerpayment') &&
    query.customer_id
  ) {
    const { items } = await queryGsi2(tableName, `CUSTOMER#${String(query.customer_id)}`)
    let rows = items.map((i) => i.payload).filter(Boolean)
    rows = applyGenericFilters(rows, query)
    const { slice, page_context } = paginate(rows, query)
    return { [listKey]: slice, page_context, code: 0 }
  }

  const items = await scanAll(tableName)
  let rows = items.map((i) => i.payload).filter(Boolean)
  if (entityType === 'contact') rows = applyContactFilters(rows, query)
  else rows = applyGenericFilters(rows, query)

  if (query.sort_column && query.sort_order) {
    const col = String(query.sort_column)
    const desc = String(query.sort_order).toUpperCase() === 'D'
    rows.sort((a, b) => {
      const av = a?.[col]
      const bv = b?.[col]
      if (av === bv) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return desc ? (av < bv ? 1 : -1) : av < bv ? -1 : 1
    })
  }

  const { slice, page_context } = paginate(rows, query)
  return { [listKey]: slice, page_context, code: 0 }
}

export async function findContactPayloadByEmail(email, contactType) {
  if (!isDynamoReadsEnabled()) return null
  const normalized = String(email || '')
    .trim()
    .toLowerCase()
  if (!normalized) return null
  const tableName = tableNameForEntityType('contact')
  const { items } = await queryGsi1(tableName, `EMAIL#${normalized}`)
  const want = contactType ? String(contactType).toLowerCase() : null
  for (const item of items) {
    const c = item.payload
    if (!c) continue
    if (want && String(c.contact_type || '').toLowerCase() !== want) continue
    return c
  }
  return null
}
