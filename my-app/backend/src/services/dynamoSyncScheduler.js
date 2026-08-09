import cron from 'node-cron'
import { env } from '../config/env.js'
import { createLogger, serializeError } from '../util/logger.js'
import { isDynamoConfigured, isDynamoReadsEnabled, isDynamoWritesEnabled, tableNameForEntityType } from './dynamo/dynamoClient.js'
import { scanAll } from './dynamo/dynamoRepository.js'
import { syncZohoBooksToDynamo } from './dynamo/zohoDynamoSyncService.js'

const log = createLogger('dynamo-sync-cron')

let scheduled = false
let running = false

/** Prefetch hot table scans so admin/customer list pages are warm after boot. */
export function warmDynamoListCaches() {
  if (!isDynamoReadsEnabled()) return
  const priority = ['item', 'contact']
  const heavy = ['salesorder', 'invoice']

  void (async () => {
    for (const entityType of priority) {
      const tableName = tableNameForEntityType(entityType)
      const started = Date.now()
      try {
        const items = await scanAll(tableName)
        log.info('Warmed Dynamo scan cache', {
          tableName,
          rows: items.length,
          ms: Date.now() - started
        })
      } catch (err) {
        log.warn('Dynamo scan warm failed', { tableName, ...serializeError(err) })
      }
    }
    // Heavy tables: warm after catalogs so Orders/Delivery don't pay 60s+ on first open.
    // Until ready, list endpoints fall through to Zoho pagination (fast).
    for (const entityType of heavy) {
      const tableName = tableNameForEntityType(entityType)
      const started = Date.now()
      try {
        const items = await scanAll(tableName)
        log.info('Warmed Dynamo scan cache', {
          tableName,
          rows: items.length,
          ms: Date.now() - started
        })
      } catch (err) {
        log.warn('Dynamo scan warm failed', { tableName, ...serializeError(err) })
      }
    }
  })()
}

export async function runZohoDynamoSyncNow(reason = 'manual') {
  if (!isDynamoWritesEnabled()) {
    return { ok: false, skipped: true, reason: 'DynamoDB not enabled' }
  }
  if (running) {
    return { ok: false, skipped: true, reason: 'sync already running' }
  }
  running = true
  log.info('Starting Zoho → DynamoDB sync', { reason })
  try {
    const summary = await syncZohoBooksToDynamo()
    log.info('Zoho → DynamoDB sync finished', {
      reason,
      errors: summary.results?.filter((r) => r.error).length || 0
    })
    return summary
  } catch (err) {
    log.error('Zoho → DynamoDB sync crashed', serializeError(err))
    throw err
  } finally {
    running = false
  }
}

/**
 * Schedule full sync daily at 18:00 Asia/Kolkata on the Render Express process.
 */
export function startZohoDynamoSyncCron() {
  if (scheduled) return false
  if (!isDynamoConfigured()) {
    log.info('Dynamo sync cron not started (DYNAMODB_TABLE_PREFIX unset)')
    return false
  }
  if (!env.DYNAMODB_SYNC_CRON_ENABLED) {
    log.info('Dynamo sync cron disabled via DYNAMODB_SYNC_CRON_ENABLED')
    return false
  }

  // 18:00 every day, India Standard Time
  cron.schedule(
    '0 18 * * *',
    () => {
      void runZohoDynamoSyncNow('cron-1800-ist').catch(() => {})
    },
    { timezone: 'Asia/Kolkata' }
  )
  scheduled = true
  log.info('Scheduled Zoho → DynamoDB sync at 18:00 Asia/Kolkata')
  return true
}
