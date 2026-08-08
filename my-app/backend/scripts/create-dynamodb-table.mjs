#!/usr/bin/env node
/**
 * Create one DynamoDB table per entity (multi-table design).
 *
 * Prefix from DYNAMODB_TABLE_PREFIX (or legacy DYNAMODB_TABLE_NAME).
 * Example tables: Abhyati_contacts, Abhyati_items, Abhyati_invoices, ...
 *
 * Usage:
 *   node scripts/create-dynamodb-table.mjs
 */
import dotenv from 'dotenv'
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists
} from '@aws-sdk/client-dynamodb'

dotenv.config()

const rawPrefix = (process.env.DYNAMODB_TABLE_PREFIX || process.env.DYNAMODB_TABLE_NAME || 'Abhyati')
  .trim()
  .replace(/_+$/, '')
const prefix = rawPrefix === 'AbhyatiApp' ? 'Abhyati' : rawPrefix
const region = process.env.AWS_REGION || 'ap-south-1'

const TABLES = [
  { suffix: 'contacts', gsi1: true, gsi2: false },
  { suffix: 'items', gsi1: false, gsi2: false },
  { suffix: 'invoices', gsi1: false, gsi2: true },
  { suffix: 'salesorders', gsi1: false, gsi2: true },
  { suffix: 'customerpayments', gsi1: false, gsi2: true },
  { suffix: 'inventoryadjustments', gsi1: false, gsi2: false },
  { suffix: 'deliverychallans', gsi1: false, gsi2: false },
  { suffix: 'users', gsi1: false, gsi2: false },
  { suffix: 'bankaccounts', gsi1: false, gsi2: false },
  { suffix: 'quotes', gsi1: false, gsi2: false },
  { suffix: 'bills', gsi1: false, gsi2: false },
  { suffix: 'purchaseorders', gsi1: false, gsi2: false },
  { suffix: 'organizations', gsi1: false, gsi2: false },
  { suffix: 'projects', gsi1: false, gsi2: false },
  { suffix: 'shipments', gsi1: false, gsi2: false },
  { suffix: 'creditnotes', gsi1: false, gsi2: false },
  { suffix: 'estimates', gsi1: false, gsi2: false },
  { suffix: 'assignments', gsi1: true, gsi2: false },
  { suffix: 'payment_records', gsi1: false, gsi2: false },
  { suffix: 'notifications', gsi1: true, gsi2: false },
  { suffix: 'audit', gsi1: false, gsi2: false }
]

const clientConfig = { region }
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {})
  }
}

const client = new DynamoDBClient(clientConfig)

function buildCreateInput(tableName, { gsi1, gsi2 }) {
  const AttributeDefinitions = [{ AttributeName: 'id', AttributeType: 'S' }]
  const GlobalSecondaryIndexes = []

  if (gsi1) {
    AttributeDefinitions.push(
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' }
    )
    GlobalSecondaryIndexes.push({
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' }
      ],
      Projection: { ProjectionType: 'ALL' }
    })
  }
  if (gsi2) {
    AttributeDefinitions.push(
      { AttributeName: 'GSI2PK', AttributeType: 'S' },
      { AttributeName: 'GSI2SK', AttributeType: 'S' }
    )
    GlobalSecondaryIndexes.push({
      IndexName: 'GSI2',
      KeySchema: [
        { AttributeName: 'GSI2PK', KeyType: 'HASH' },
        { AttributeName: 'GSI2SK', KeyType: 'RANGE' }
      ],
      Projection: { ProjectionType: 'ALL' }
    })
  }

  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    ...(GlobalSecondaryIndexes.length ? { GlobalSecondaryIndexes } : {})
  }
}

async function ensureTable(def) {
  const tableName = `${prefix}_${def.suffix}`
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }))
    console.log(`exists: ${tableName}`)
    return
  } catch (err) {
    if (err?.name !== 'ResourceNotFoundException') throw err
  }
  console.log(`creating: ${tableName}`)
  await client.send(new CreateTableCommand(buildCreateInput(tableName, def)))
  await waitUntilTableExists({ client, maxWaitTime: 180 }, { TableName: tableName })
  console.log(`ready: ${tableName}`)
}

console.log(`Creating multi-table set with prefix="${prefix}" in ${region}`)
for (const def of TABLES) {
  await ensureTable(def)
}
console.log('All tables ready.')
