import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('notifications')

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '..', 'data', 'notifications.json')

const notifications = new Map()
const MAX_PER_RECIPIENT = 80

function normEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function reloadFromDisk() {
  notifications.clear()
  if (!existsSync(FILE)) return
  try {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'))
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (!row?.id || !row?.recipientEmail || !row?.audience) continue
      notifications.set(String(row.id), row)
    }
  } catch (err) {
    log.error('Notification load failed', serializeError(err))
  }
}

function persist() {
  try {
    const dir = dirname(FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(FILE, JSON.stringify([...notifications.values()]), 'utf8')
  } catch (err) {
    log.error('Notification persist failed', serializeError(err))
  }
}

reloadFromDisk()

function newNotificationId() {
  return `notif_${Date.now()}_${Math.round(Math.random() * 10000)}`
}

export function listNotificationsForRecipient(audience, recipientEmail) {
  reloadFromDisk()
  const email = normEmail(recipientEmail)
  const aud = String(audience || '').trim()
  return [...notifications.values()]
    .filter((row) => String(row.audience) === aud && normEmail(row.recipientEmail) === email)
    .sort((a, b) => Date.parse(String(b.createdAt || '')) - Date.parse(String(a.createdAt || '')))
    .slice(0, MAX_PER_RECIPIENT)
}

export function countUnreadForRecipient(audience, recipientEmail) {
  return listNotificationsForRecipient(audience, recipientEmail).filter((row) => !row.readAt).length
}

export function createNotification({
  audience,
  recipientEmail,
  title,
  body,
  type,
  meta
}) {
  reloadFromDisk()
  const email = normEmail(recipientEmail)
  const aud = String(audience || '').trim()
  if (!email || !aud) return null
  const row = {
    id: newNotificationId(),
    audience: aud,
    recipientEmail: email,
    title: String(title || '').trim() || 'Notification',
    body: String(body || '').trim(),
    type: String(type || 'general'),
    meta: meta && typeof meta === 'object' ? meta : {},
    readAt: null,
    createdAt: new Date().toISOString()
  }
  notifications.set(row.id, row)

  const forRecipient = listNotificationsForRecipient(aud, email)
  if (forRecipient.length > MAX_PER_RECIPIENT) {
    for (const old of forRecipient.slice(MAX_PER_RECIPIENT)) {
      notifications.delete(old.id)
    }
  }

  persist()
  return row
}

export function getNotificationForRecipient(id, audience, recipientEmail) {
  reloadFromDisk()
  const row = notifications.get(String(id))
  if (!row) return null
  if (String(row.audience) !== String(audience)) return null
  if (normEmail(row.recipientEmail) !== normEmail(recipientEmail)) return null
  return row
}

export function markNotificationRead(id, audience, recipientEmail) {
  reloadFromDisk()
  const row = getNotificationForRecipient(id, audience, recipientEmail)
  if (!row) return null
  if (row.readAt) return row
  const next = { ...row, readAt: new Date().toISOString() }
  notifications.set(String(id), next)
  persist()
  return next
}

export function markAllNotificationsRead(audience, recipientEmail) {
  reloadFromDisk()
  const email = normEmail(recipientEmail)
  const aud = String(audience || '').trim()
  const now = new Date().toISOString()
  let changed = 0
  for (const row of notifications.values()) {
    if (String(row.audience) !== aud || normEmail(row.recipientEmail) !== email || row.readAt) continue
    notifications.set(row.id, { ...row, readAt: now })
    changed += 1
  }
  if (changed > 0) persist()
  return changed
}
