import { isDynamoReadsEnabled, isDynamoWritesEnabled, tableNameForAppKind } from './dynamoClient.js'
import { appEntityKeys, driverAssignmentGsiKeys, recipientGsiKeys } from './dynamoKeys.js'
import {
  getItem,
  putItem,
  queryGsi1,
  safeDeleteItem,
  safePutItem,
  scanAll
} from './dynamoRepository.js'

export async function putAppRecord(appKind, row, { gsi1 } = {}) {
  if (!isDynamoWritesEnabled() || !row?.id) return
  const keys = appEntityKeys(appKind, row.id)
  const item = {
    ...keys,
    payload: row,
    source: 'app',
    syncedAt: new Date().toISOString(),
    ...(gsi1 || {})
  }
  await safePutItem(tableNameForAppKind(appKind), item)
}

export async function getAppRecord(appKind, id) {
  if (!isDynamoReadsEnabled()) return null
  const item = await getItem(tableNameForAppKind(appKind), id)
  return item?.payload || null
}

export async function listAppRecords(appKind) {
  if (!isDynamoReadsEnabled()) return null
  const items = await scanAll(tableNameForAppKind(appKind))
  return items.map((i) => i.payload).filter(Boolean)
}

export async function deleteAppRecord(appKind, id) {
  if (!isDynamoWritesEnabled()) return
  await safeDeleteItem(tableNameForAppKind(appKind), id)
}

export async function putAssignment(row) {
  const gsi1 = driverAssignmentGsiKeys(row.driverEmail, row.id)
  await putAppRecord('assignment', row, { gsi1 })
}

export async function listAssignmentsByDriver(driverEmail) {
  if (!isDynamoReadsEnabled()) return null
  const e = String(driverEmail || '')
    .trim()
    .toLowerCase()
  if (!e) return []
  const { items } = await queryGsi1(tableNameForAppKind('assignment'), `DRIVER#${e}`)
  return items.map((i) => i.payload).filter(Boolean)
}

export async function putNotification(row) {
  const gsi1 = recipientGsiKeys(row.audience, row.recipientEmail, row.id)
  await putAppRecord('notification', row, { gsi1 })
}

export async function listNotificationsByRecipient(audience, recipientEmail) {
  if (!isDynamoReadsEnabled()) return null
  const e = String(recipientEmail || '')
    .trim()
    .toLowerCase()
  const a = String(audience || '').trim()
  if (!e || !a) return []
  const { items } = await queryGsi1(tableNameForAppKind('notification'), `NOTIF#${a}#${e}`)
  return items.map((i) => i.payload).filter(Boolean)
}

export async function putPaymentRecord(row) {
  await putAppRecord('payment', row)
}

export async function putAuditEntry(entry) {
  if (!isDynamoWritesEnabled()) return
  const id = `audit_${Date.now()}_${Math.round(Math.random() * 10000)}`
  const row = { id, ...entry }
  await putAppRecord('audit', row)
}

export { isDynamoReadsEnabled, isDynamoWritesEnabled, putItem }
