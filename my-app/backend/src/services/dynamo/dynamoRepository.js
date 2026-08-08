import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb'
import { createLogger, serializeError } from '../../util/logger.js'
import { getDocClient, isDynamoWritesEnabled } from './dynamoClient.js'

const log = createLogger('dynamo')

/** In-process scan cache: list endpoints should not re-scan the whole table every page. */
const SCAN_TTL_MS = Math.max(5_000, Number(process.env.DYNAMODB_SCAN_CACHE_TTL_MS) || 300_000)
/** @type {Map<string, { at: number, items: object[] }>} */
const scanCache = new Map()
/** @type {Map<string, Promise<object[]>>} */
const scanInflight = new Map()

export function invalidateScanCache(tableName) {
  if (tableName) {
    scanCache.delete(tableName)
    scanInflight.delete(tableName)
    return
  }
  scanCache.clear()
  scanInflight.clear()
}

export async function putItem(tableName, item) {
  if (!isDynamoWritesEnabled()) return
  const client = getDocClient()
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...item,
        updatedAt: item.updatedAt || new Date().toISOString()
      }
    })
  )
  invalidateScanCache(tableName)
}

export async function getItem(tableName, id) {
  const client = getDocClient()
  const res = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: String(id) }
    })
  )
  return res.Item || null
}

export async function deleteItem(tableName, id) {
  if (!isDynamoWritesEnabled()) return
  const client = getDocClient()
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { id: String(id) }
    })
  )
  invalidateScanCache(tableName)
}

export async function queryGsi1(tableName, gsi1pk, { skBeginsWith, limit, exclusiveStartKey } = {}) {
  const client = getDocClient()
  const values = { ':pk': gsi1pk }
  let keyCond = 'GSI1PK = :pk'
  if (skBeginsWith) {
    keyCond += ' AND begins_with(GSI1SK, :sk)'
    values[':sk'] = skBeginsWith
  }
  const res = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: keyCond,
      ExpressionAttributeValues: values,
      ...(limit ? { Limit: limit } : {}),
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
    })
  )
  return {
    items: Array.isArray(res.Items) ? res.Items : [],
    lastEvaluatedKey: res.LastEvaluatedKey || null
  }
}

export async function queryGsi2(tableName, gsi2pk, { limit, exclusiveStartKey } = {}) {
  const client = getDocClient()
  const res = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': gsi2pk },
      ScanIndexForward: false,
      ...(limit ? { Limit: limit } : {}),
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
    })
  )
  return {
    items: Array.isArray(res.Items) ? res.Items : [],
    lastEvaluatedKey: res.LastEvaluatedKey || null
  }
}

/** Batch write PutRequests in chunks of 25 to a specific table. */
export async function batchPutItems(tableName, items) {
  if (!isDynamoWritesEnabled() || !items?.length) return { written: 0 }
  const client = getDocClient()
  let written = 0
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25)
    let requestItems = {
      [tableName]: chunk.map((Item) => ({
        PutRequest: {
          Item: {
            ...Item,
            updatedAt: Item.updatedAt || new Date().toISOString()
          }
        }
      }))
    }
    let attempts = 0
    while (Object.keys(requestItems).length > 0 && attempts < 8) {
      attempts += 1
      const res = await client.send(new BatchWriteCommand({ RequestItems: requestItems }))
      const unprocessed = res.UnprocessedItems || {}
      const remaining = unprocessed[tableName] || []
      written += chunk.length - remaining.length
      if (remaining.length === 0) break
      requestItems = { [tableName]: remaining }
      await new Promise((r) => setTimeout(r, 50 * attempts))
    }
  }
  invalidateScanCache(tableName)
  return { written }
}

async function scanAllUncached(tableName) {
  const client = getDocClient()
  const out = []
  let exclusiveStartKey
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: tableName,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      })
    )
    out.push(...(Array.isArray(res.Items) ? res.Items : []))
    exclusiveStartKey = res.LastEvaluatedKey
  } while (exclusiveStartKey)
  return out
}

/** Single-page scan for overview/sample metrics — does not fill the full-table cache. */
export async function scanLimited(tableName, limit = 100) {
  const client = getDocClient()
  const res = await client.send(
    new ScanCommand({
      TableName: tableName,
      Limit: Math.max(1, Math.min(500, Number(limit) || 100))
    })
  )
  return Array.isArray(res.Items) ? res.Items : []
}

/**
 * Full-table scan with short TTL cache + single-flight coalescing.
 * List pagination (admin items page 1, 2, 3…) reuses one scan.
 */
export async function scanAll(tableName, { bypassCache = false } = {}) {
  if (!bypassCache) {
    const hit = scanCache.get(tableName)
    if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.items
    const inflight = scanInflight.get(tableName)
    if (inflight) return inflight
  }

  const promise = scanAllUncached(tableName)
    .then((items) => {
      scanCache.set(tableName, { at: Date.now(), items })
      scanInflight.delete(tableName)
      return items
    })
    .catch((err) => {
      scanInflight.delete(tableName)
      throw err
    })

  if (!bypassCache) scanInflight.set(tableName, promise)
  return promise
}

export async function safePutItem(tableName, item) {
  try {
    await putItem(tableName, item)
  } catch (err) {
    log.error('Dynamo put failed', { tableName, ...serializeError(err) })
  }
}

export async function safeDeleteItem(tableName, id) {
  try {
    await deleteItem(tableName, id)
  } catch (err) {
    log.error('Dynamo delete failed', { tableName, id, ...serializeError(err) })
  }
}
