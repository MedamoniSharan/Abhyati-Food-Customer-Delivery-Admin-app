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
  return { written }
}

export async function scanAll(tableName) {
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
