import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { env } from '../../config/env.js'
import { tableSuffixForAppKind, tableSuffixForEntityType } from './dynamoKeys.js'

let docClient = null

/** Prefer DYNAMODB_TABLE_PREFIX; fall back to legacy DYNAMODB_TABLE_NAME as prefix. */
export function getDynamoTablePrefix() {
  const prefix = String(env.DYNAMODB_TABLE_PREFIX || env.DYNAMODB_TABLE_NAME || '')
    .trim()
    .replace(/_+$/, '')
  // Legacy single-table name AbhyatiApp → use Abhyati as prefix for multi-table
  if (prefix === 'AbhyatiApp') return 'Abhyati'
  return prefix
}

export function isDynamoConfigured() {
  return Boolean(getDynamoTablePrefix())
}

export function isDynamoWritesEnabled() {
  return isDynamoConfigured() && env.DYNAMODB_ENABLED !== false
}

export function isDynamoReadsEnabled() {
  return isDynamoWritesEnabled() && env.DYNAMODB_READS !== false
}

export function tableNameForSuffix(suffix) {
  const prefix = getDynamoTablePrefix()
  if (!prefix) {
    const err = new Error('DynamoDB is not configured (set DYNAMODB_TABLE_PREFIX)')
    err.statusCode = 503
    throw err
  }
  return `${prefix}_${suffix}`
}

export function tableNameForEntityType(entityType) {
  return tableNameForSuffix(tableSuffixForEntityType(entityType))
}

export function tableNameForAppKind(appKind) {
  return tableNameForSuffix(tableSuffixForAppKind(appKind))
}

/** @deprecated use tableNameForEntityType / tableNameForAppKind */
export function getDynamoTableName() {
  return getDynamoTablePrefix()
}

export function getDocClient() {
  if (!isDynamoConfigured()) {
    const err = new Error('DynamoDB is not configured (set DYNAMODB_TABLE_PREFIX)')
    err.statusCode = 503
    throw err
  }
  if (docClient) return docClient

  const clientConfig = {
    region: env.AWS_REGION || 'ap-south-1'
  }
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {})
    }
  }

  const raw = new DynamoDBClient(clientConfig)
  docClient = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    unmarshallOptions: { wrapNumbers: false }
  })
  return docClient
}
