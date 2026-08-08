import cron from 'node-cron'
import { env } from '../config/env.js'
import { createLogger, serializeError } from '../util/logger.js'
import { isDynamoConfigured, isDynamoWritesEnabled } from './dynamo/dynamoClient.js'
import { syncZohoBooksToDynamo } from './dynamo/zohoDynamoSyncService.js'

const log = createLogger('dynamo-sync-cron')

let scheduled = false
let running = false

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
