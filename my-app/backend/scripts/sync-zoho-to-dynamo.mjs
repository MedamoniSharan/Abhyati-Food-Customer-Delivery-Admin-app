#!/usr/bin/env node
/**
 * One-shot Zoho Books → DynamoDB full sync / backfill.
 *
 * Usage (from my-app/backend):
 *   node scripts/sync-zoho-to-dynamo.mjs
 *
 * Requires DYNAMODB_TABLE_NAME (+ AWS creds) and Zoho env vars.
 */
import dotenv from 'dotenv'
dotenv.config()

import { syncZohoBooksToDynamo } from '../src/services/dynamo/zohoDynamoSyncService.js'
import { createLogger, serializeError } from '../src/util/logger.js'

const log = createLogger('sync-script')

try {
  const summary = await syncZohoBooksToDynamo()
  console.log(JSON.stringify(summary, null, 2))
  if (summary.skipped) process.exit(2)
  const errors = (summary.results || []).filter((r) => r.error)
  process.exit(errors.length ? 1 : 0)
} catch (err) {
  log.error('Sync failed', serializeError(err))
  process.exit(1)
}
