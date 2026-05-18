import { createLogger } from '../util/logger.js'

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
    case 'GET': return COLORS.green
    case 'POST': return COLORS.cyan
    case 'PUT': return COLORS.yellow
    case 'PATCH': return COLORS.magenta
    case 'DELETE': return COLORS.red
    default: return COLORS.reset
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
  for (const key of ['password', 'token', 'secret', 'refresh_token', 'client_secret']) {
    if (key in clone) clone[key] = '***'
  }
  return clone
}

export function requestLogger(req, res, next) {
  const start = Date.now()
  const { method, originalUrl } = req

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
      terminalLine: coloredLine
    })

    if (method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
      log.debug('Request body', {
        body: sanitizeBody(req.body),
        terminalLine: `  ${COLORS.dim}→ body:${COLORS.reset} ${JSON.stringify(sanitizeBody(req.body))}`
      })
    }

    if (responseBody) {
      const summary = JSON.stringify(responseBody)
      const truncated = summary.length > 300 ? summary.slice(0, 300) + '…' : summary
      log.debug('Response body (truncated)', {
        truncated,
        terminalLine: `  ${COLORS.dim}← resp:${COLORS.reset} ${truncated}`
      })
    }

    if (status >= 400 && responseBody?.message) {
      log.warn('Error response', {
        status,
        path: originalUrl,
        message: responseBody.message,
        terminalLine: `  ${COLORS.red}✗ ${responseBody.message}${COLORS.reset}`
      })
    }
  })

  next()
}
