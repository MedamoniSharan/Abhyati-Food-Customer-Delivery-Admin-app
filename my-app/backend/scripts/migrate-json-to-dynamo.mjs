#!/usr/bin/env node
/**
 * Import local JSON app data (assignments, payments, notifications) into DynamoDB.
 *
 * Usage (from my-app/backend):
 *   node scripts/migrate-json-to-dynamo.mjs
 */
import dotenv from 'dotenv'
dotenv.config()

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { putAssignment, putNotification, putPaymentRecord, putAuditEntry } from '../src/services/dynamo/appDataDynamo.js'
import { isDynamoWritesEnabled } from '../src/services/dynamo/dynamoClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')

function readJsonArray(name) {
  const file = join(dataDir, name)
  if (!existsSync(file)) return []
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  return Array.isArray(rows) ? rows : []
}

if (!isDynamoWritesEnabled()) {
  console.error('DynamoDB not enabled — set DYNAMODB_TABLE_NAME and AWS credentials')
  process.exit(2)
}

const assignments = readJsonArray('delivery-assignments.json')
const payments = readJsonArray('payment-records.json')
const notifications = readJsonArray('notifications.json')

let a = 0
let p = 0
let n = 0
for (const row of assignments) {
  await putAssignment(row)
  a += 1
}
for (const row of payments) {
  await putPaymentRecord(row)
  p += 1
}
for (const row of notifications) {
  await putNotification(row)
  n += 1
}

const auditFile = join(dataDir, 'admin-audit.jsonl')
let auditCount = 0
if (existsSync(auditFile)) {
  const lines = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      await putAuditEntry(JSON.parse(line))
      auditCount += 1
    } catch {
      /* skip bad line */
    }
  }
}

console.log(
  JSON.stringify({ ok: true, assignments: a, payments: p, notifications: n, auditLines: auditCount }, null, 2)
)
