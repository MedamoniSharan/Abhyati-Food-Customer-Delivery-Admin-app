import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'
import { putAuditEntry } from './dynamo/appDataDynamo.js'

const log = createLogger('audit')

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUDIT_FILE = join(__dirname, '..', '..', 'data', 'admin-audit.jsonl')

function ensureDir() {
  const dir = dirname(AUDIT_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * @param {object} entry
 * @param {string} entry.action
 * @param {string} [entry.actor]
 * @param {Record<string, unknown>} [entry.meta]
 */
export function appendAdminAudit(entry) {
  const payload = {
    ts: new Date().toISOString(),
    actor: entry.actor || 'admin',
    action: entry.action,
    ...(entry.meta && typeof entry.meta === 'object' ? { meta: entry.meta } : {})
  }
  try {
    ensureDir()
    appendFileSync(AUDIT_FILE, `${JSON.stringify(payload)}\n`, 'utf8')
  } catch (err) {
    log.error('Failed to append admin audit line', serializeError(err))
  }
  void putAuditEntry(payload).catch((err) => log.error('Dynamo audit mirror failed', serializeError(err)))
}
