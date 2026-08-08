import { createLogger, serializeError } from '../../util/logger.js'
import { getModuleByIdFromZoho, listModuleFromZoho } from '../zohoBooksService.js'
import { isDynamoWritesEnabled, tableNameForEntityType } from './dynamoClient.js'
import { entityTypeFromModulePath, listKeyForEntityType } from './dynamoKeys.js'
import { batchPutItems } from './dynamoRepository.js'
import { buildZohoMirrorItem } from './zohoDynamoMirror.js'

const log = createLogger('zoho-dynamo-sync')

/** Modules synced from Zoho Books into DynamoDB. */
export const SYNC_MODULES = [
  '/contacts',
  '/items',
  '/invoices',
  '/salesorders',
  '/customerpayments',
  '/inventoryadjustments',
  '/deliverychallans',
  '/users',
  '/bankaccounts'
]

const DETAIL_CONCURRENCY = Math.max(1, Number(process.env.ZOHO_SYNC_DETAIL_CONCURRENCY) || 3)

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next
      next += 1
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function syncModulePages(modulePath, { maxPages = 500, detailFetch = false } = {}) {
  const entityType = entityTypeFromModulePath(modulePath)
  const listKey = listKeyForEntityType(entityType)
  let fetched = 0
  let written = 0
  const seen = new Set()

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await listModuleFromZoho(modulePath, { per_page: 200, page })
    const pageRows = Array.isArray(data?.[listKey]) ? data[listKey] : []
    if (pageRows.length === 0) {
      log.info('Module page empty — done', { modulePath, page })
      break
    }

    const unique = []
    for (const row of pageRows) {
      const idField =
        row.contact_id ||
        row.item_id ||
        row.invoice_id ||
        row.salesorder_id ||
        row.payment_id ||
        row.inventory_adjustment_id ||
        row.deliverychallan_id ||
        row.user_id ||
        row.account_id ||
        row.id
      const id = idField != null ? String(idField) : null
      if (!id || seen.has(id)) continue
      seen.add(id)
      unique.push({ id, row })
    }

    let entities = unique.map((u) => u.row)
    if (detailFetch && unique.length) {
      log.info('Fetching contact details', { modulePath, page, count: unique.length })
      entities = await mapPool(unique, DETAIL_CONCURRENCY, async ({ id, row }) => {
        try {
          const detail = await getModuleByIdFromZoho(modulePath, id)
          return detail?.[entityType] || detail || row
        } catch {
          return row
        }
      })
    }

    const items = entities.map((r) => buildZohoMirrorItem(entityType, r)).filter(Boolean)
    const result = await batchPutItems(tableNameForEntityType(entityType), items)
    fetched += entities.length
    written += result.written || 0
    log.info('Module page synced', {
      modulePath,
      page,
      pageRows: pageRows.length,
      fetchedTotal: fetched,
      writtenTotal: written
    })

    if (!data?.page_context?.has_more_page) break
  }

  return { fetched, written }
}

/**
 * Full Zoho Books → DynamoDB sync for configured modules.
 * Writes page-by-page so partial progress is visible and durable.
 */
export async function syncZohoBooksToDynamo({
  modules = SYNC_MODULES,
  detailForContacts = process.env.ZOHO_SYNC_CONTACT_DETAILS === 'true'
} = {}) {
  if (!isDynamoWritesEnabled()) {
    return { ok: false, skipped: true, reason: 'DynamoDB not enabled' }
  }

  const startedAt = new Date().toISOString()
  const results = []

  for (const modulePath of modules) {
    const entityType = entityTypeFromModulePath(modulePath)
    try {
      const detailFetch = detailForContacts && modulePath === '/contacts'
      log.info('Syncing module', { modulePath, detailFetch })
      const { fetched, written } = await syncModulePages(modulePath, { detailFetch })
      results.push({ modulePath, entityType, fetched, written })
      log.info('Module sync done', { modulePath, fetched, written })
    } catch (err) {
      log.error('Module sync failed', { modulePath, ...serializeError(err) })
      results.push({ modulePath, entityType, error: err.message || String(err) })
    }
  }

  const finishedAt = new Date().toISOString()
  const summary = { ok: true, startedAt, finishedAt, results }
  log.info('Zoho → DynamoDB sync complete', {
    modules: results.length,
    errors: results.filter((r) => r.error).length
  })
  return summary
}
