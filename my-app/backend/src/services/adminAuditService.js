import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createLogger, serializeError } from '../util/logger.js'
import { putAuditEntry } from './dynamo/appDataDynamo.js'

const log = createLogger('audit')

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Durable JSONL trail for all app actors (admin, customer, driver, system). */
const AUDIT_FILE = join(__dirname, '..', '..', 'data', 'admin-audit.jsonl')

const SECRET_KEYS = new Set([
  'password',
  'currentpassword',
  'otp',
  'token',
  'secret',
  'refresh_token',
  'client_secret',
  'authorization',
  'razorpay_signature',
  'authkey'
])

function ensureDir() {
  const dir = dirname(AUDIT_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function newEventId() {
  return `aud_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

/** Mask India mobile: 9198****10 */
export function maskMobile(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '')
  if (digits.length < 6) return '****'
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`
}

/** Mask email: sh***@gmail.com */
export function maskEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase()
  const at = e.indexOf('@')
  if (at < 1) return e ? '***' : ''
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  const keep = local.slice(0, Math.min(2, local.length))
  return `${keep}***@${domain}`
}

/**
 * Deep-ish sanitize: strip secrets, mask mobile/email fields.
 * @param {unknown} value
 * @param {number} [depth]
 */
export function sanitizeAuditMeta(value, depth = 0) {
  if (value == null) return value
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((v) => sanitizeAuditMeta(v, depth + 1))
  }
  if (typeof value !== 'object') {
    const s = String(value)
    return s.length > 500 ? `${s.slice(0, 500)}…` : value
  }
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    const key = k.toLowerCase()
    if (SECRET_KEYS.has(key) || key.includes('password') || key.endsWith('_secret')) {
      out[k] = '***'
      continue
    }
    if (key === 'mobile' || key === 'phone' || key === 'phonenumber') {
      out[k] = maskMobile(v)
      continue
    }
    if (key === 'email' || key === 'customeremail' || key === 'actoremail') {
      out[k] = maskEmail(v)
      continue
    }
    out[k] = sanitizeAuditMeta(v, depth + 1)
  }
  return out
}

function actorFromReq(req) {
  if (!req || typeof req !== 'object') return { actor: 'system', actorType: 'system' }
  if (req.customer?.email) {
    return { actor: maskEmail(req.customer.email), actorType: 'customer' }
  }
  if (req.driver?.email) {
    return { actor: maskEmail(req.driver.email), actorType: 'driver' }
  }
  if (req.admin?.email) {
    return { actor: maskEmail(req.admin.email), actorType: 'admin' }
  }
  if (req.admin === true || req.isAdmin) {
    return { actor: 'admin', actorType: 'admin' }
  }
  return { actor: 'anonymous', actorType: 'anonymous' }
}

function clientIp(req) {
  if (!req) return undefined
  const xf = req.headers?.['x-forwarded-for']
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim()
  return req.ip || req.socket?.remoteAddress || undefined
}

/**
 * Append a structured audit event (JSONL + Dynamo mirror + console).
 *
 * @param {object} entry
 * @param {string} entry.action - e.g. otp.send, customer.login, order.create
 * @param {string} [entry.actor]
 * @param {'customer'|'admin'|'driver'|'system'|'anonymous'} [entry.actorType]
 * @param {'ok'|'fail'|'warn'} [entry.outcome]
 * @param {Record<string, unknown>} [entry.meta]
 * @param {import('express').Request} [entry.req]
 * @param {string} [entry.stage] - optional pipeline stage for multi-step flows
 */
export function appendAuditEvent(entry) {
  const fromReq = actorFromReq(entry.req)
  const payload = {
    id: newEventId(),
    ts: new Date().toISOString(),
    action: String(entry.action || 'unknown'),
    outcome: entry.outcome || 'ok',
    actor: entry.actor || fromReq.actor,
    actorType: entry.actorType || fromReq.actorType,
    ...(entry.stage ? { stage: entry.stage } : {}),
    ...(entry.req?.auditRequestId ? { requestId: entry.req.auditRequestId } : {}),
    ...(entry.req?.method ? { method: entry.req.method } : {}),
    ...(entry.req?.originalUrl || entry.req?.url
      ? { path: entry.req.originalUrl || entry.req.url }
      : {}),
    ...(clientIp(entry.req) ? { ip: clientIp(entry.req) } : {}),
    ...(entry.meta && typeof entry.meta === 'object'
      ? { meta: sanitizeAuditMeta(entry.meta) }
      : {})
  }

  try {
    ensureDir()
    appendFileSync(AUDIT_FILE, `${JSON.stringify(payload)}\n`, 'utf8')
  } catch (err) {
    log.error('Failed to append audit line', serializeError(err))
  }

  const level = payload.outcome === 'fail' || payload.outcome === 'warn' ? 'warn' : 'info'
  log[level](payload.action, {
    auditId: payload.id,
    outcome: payload.outcome,
    actor: payload.actor,
    actorType: payload.actorType,
    requestId: payload.requestId,
    path: payload.path,
    ...(payload.meta || {})
  })

  void putAuditEntry(payload).catch((err) => log.error('Dynamo audit mirror failed', serializeError(err)))
  return payload
}

/**
 * Backward-compatible admin helper.
 * @param {object} entry
 * @param {string} entry.action
 * @param {string} [entry.actor]
 * @param {Record<string, unknown>} [entry.meta]
 * @param {'ok'|'fail'|'warn'} [entry.outcome]
 * @param {import('express').Request} [entry.req]
 */
export function appendAdminAudit(entry) {
  return appendAuditEvent({
    action: entry.action,
    actor: entry.actor || 'admin',
    actorType: 'admin',
    outcome: entry.outcome || 'ok',
    meta: entry.meta,
    req: entry.req
  })
}

/**
 * High-signal HTTP paths worth auditing on mutate or any failure.
 * @param {string} path
 */
export function isAuditableApiPath(path) {
  const p = String(path || '')
  return (
    p.startsWith('/api/auth') ||
    p.startsWith('/api/customer') ||
    p.startsWith('/api/delivery') ||
    p.startsWith('/api/admin') ||
    p.startsWith('/api/zoho')
  )
}

/**
 * @param {{ limit?: number, action?: string, outcome?: string, q?: string }} [opts]
 */
export function readRecentAuditEvents(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500)
  const actionFilter = String(opts.action || '')
    .trim()
    .toLowerCase()
  const outcomeFilter = String(opts.outcome || '')
    .trim()
    .toLowerCase()
  const q = String(opts.q || '')
    .trim()
    .toLowerCase()

  if (!existsSync(AUDIT_FILE)) {
    return { events: [], file: AUDIT_FILE, totalMatched: 0 }
  }

  let raw = ''
  try {
    const size = statSync(AUDIT_FILE).size
    const maxBytes = 512 * 1024
    if (size <= maxBytes) {
      raw = readFileSync(AUDIT_FILE, 'utf8')
    } else {
      const fd = openSync(AUDIT_FILE, 'r')
      try {
        const buf = Buffer.alloc(maxBytes)
        readSync(fd, buf, 0, maxBytes, size - maxBytes)
        raw = buf.toString('utf8')
        const firstNl = raw.indexOf('\n')
        if (firstNl >= 0) raw = raw.slice(firstNl + 1)
      } finally {
        closeSync(fd)
      }
    }
  } catch (err) {
    log.error('Failed to read audit file', serializeError(err))
    return { events: [], file: AUDIT_FILE, totalMatched: 0, error: 'read_failed' }
  }

  const lines = raw.split('\n').filter((l) => l.trim())
  /** @type {object[]} */
  const parsed = []
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i])
      if (actionFilter && !String(row.action || '')
        .toLowerCase()
        .includes(actionFilter)) {
        continue
      }
      if (outcomeFilter && String(row.outcome || 'ok').toLowerCase() !== outcomeFilter) {
        continue
      }
      if (q) {
        const hay = JSON.stringify(row).toLowerCase()
        if (!hay.includes(q)) continue
      }
      parsed.push(row)
      if (parsed.length >= limit) break
    } catch {
      /* skip bad line */
    }
  }

  return { events: parsed, file: AUDIT_FILE, totalMatched: parsed.length }
}
