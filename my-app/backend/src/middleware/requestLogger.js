import { randomBytes } from 'node:crypto'
import { createLogger } from '../util/logger.js'
import { appendAuditEvent, isAuditableApiPath } from '../services/adminAuditService.js'

const log = createLogger('http')

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
}

function methodColor(method) {
  switch (method) {
    case 'GET':
      return COLORS.green
    case 'POST':
      return COLORS.cyan
    case 'PUT':
      return COLORS.yellow
    case 'PATCH':
      return COLORS.magenta
    case 'DELETE':
      return COLORS.red
    default:
      return COLORS.reset
  }
}

function statusColor(code) {
  if (code >= 500) return COLORS.red
  if (code >= 400) return COLORS.yellow
  if (code >= 300) return COLORS.magenta
  return COLORS.green
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return undefined
  const clone = { ...body }
  for (const key of Object.keys(clone)) {
    const lower = key.toLowerCase()
    if (
      ['password', 'token', 'secret', 'refresh_token', 'client_secret', 'otp', 'currentpassword'].includes(
        lower
      ) ||
      lower.includes('password') ||
      lower.includes('signature')
    ) {
      clone[key] = '***'
    }
  }
  return clone
}

function newRequestId() {
  return `req_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

export function requestLogger(req, res, next) {
  const start = Date.now()
  const { method, originalUrl } = req
  const incomingId = String(req.headers['x-request-id'] || '').trim()
  req.auditRequestId = incomingId || newRequestId()
  res.setHeader('X-Request-Id', req.auditRequestId)

  const originalJson = res.json.bind(res)
  let responseBody

  res.json = function (body) {
    responseBody = body
    return originalJson(body)
  }

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    const mc = methodColor(method)
    const sc = statusColor(status)
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: false })

    const coloredLine = `${COLORS.dim}${timestamp}${COLORS.reset} ${mc}${method}${COLORS.reset} ${originalUrl} ${sc}${status}${COLORS.reset} ${COLORS.dim}${duration}ms${COLORS.reset}`
    log.http('Request completed', {
      method,
      path: originalUrl,
      status,
      durationMs: duration,
      requestId: req.auditRequestId,
      terminalLine: coloredLine
    })

    if (method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
      log.debug('Request body', {
        requestId: req.auditRequestId,
        body: sanitizeBody(req.body),
        terminalLine: `  ${COLORS.dim}→ body:${COLORS.reset} ${JSON.stringify(sanitizeBody(req.body))}`
      })
    }

    if (responseBody) {
      const summary = JSON.stringify(responseBody)
      const truncated = summary.length > 300 ? summary.slice(0, 300) + '…' : summary
      log.debug('Response body (truncated)', {
        requestId: req.auditRequestId,
        truncated,
        terminalLine: `  ${COLORS.dim}← resp:${COLORS.reset} ${truncated}`
      })
    }

    if (status >= 400 && responseBody?.message) {
      log.warn('Error response', {
        status,
        path: originalUrl,
        message: responseBody.message,
        requestId: req.auditRequestId,
        terminalLine: `  ${COLORS.red}✗ ${responseBody.message}${COLORS.reset}`
      })
    }

    // Durable audit for API failures + mutating traffic on key surfaces.
    const auditable = isAuditableApiPath(originalUrl)
    const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    if (auditable && (status >= 400 || isMutating)) {
      // Skip noisy successful GETs; domain routes also emit richer events.
      const skipOkDuplicate =
        status < 400 &&
        (/\/api\/auth\/(otp\/send|otp\/resend|signup|login|profile)/.test(originalUrl) ||
          /\/api\/customer\/(orders|payments)/.test(originalUrl) ||
          /\/api\/delivery\/login/.test(originalUrl) ||
          /\/api\/admin\/login/.test(originalUrl))
      if (!skipOkDuplicate) {
        appendAuditEvent({
          action: status >= 400 ? 'http.error' : 'http.request',
          outcome: status >= 500 ? 'fail' : status >= 400 ? 'fail' : 'ok',
          stage: 'http',
          req,
          meta: {
            status,
            durationMs: duration,
            message: responseBody?.message,
            msg91RequestId: responseBody?.requestId
          }
        })
      }
    }
  })

  next()
}
