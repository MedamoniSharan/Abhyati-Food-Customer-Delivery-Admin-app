import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'

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
  try {
    ensureDir()
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      actor: entry.actor || 'admin',
      action: entry.action,
      ...(entry.meta && typeof entry.meta === 'object' ? { meta: entry.meta } : {})
    })
    appendFileSync(AUDIT_FILE, `${line}\n`, 'utf8')
  } catch (err) {
    log.error('Failed to append admin audit line', serializeError(err))
  }
}
