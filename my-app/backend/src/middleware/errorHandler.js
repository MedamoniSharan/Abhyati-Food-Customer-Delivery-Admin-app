import axios from 'axios'
import multer from 'multer'
import { ZodError } from 'zod'
import { createLogger, serializeAxiosError, serializeError } from '../util/logger.js'
import { isZohoRateLimitError } from '../services/zohoRateLimit.js'
import { appendAuditEvent, isAuditableApiPath } from '../services/adminAuditService.js'

const log = createLogger('errors')

function auditFail(req, action, meta = {}) {
  if (!isAuditableApiPath(req.originalUrl || req.url || '')) return
  appendAuditEvent({
    action,
    outcome: 'fail',
    stage: 'errorHandler',
    req,
    meta
  })
}

/**
 * @param {unknown} error
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(error, req, res, _next) {
  const path = req.originalUrl || req.url
  const method = req.method

  if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
    log.warn('JWT rejected', { method, path, reason: error?.name, requestId: req.auditRequestId })
    auditFail(req, 'auth.jwt_rejected', { reason: error?.name })
    return res.status(401).json({ message: 'Invalid or expired token' })
  }

  if (error instanceof ZodError) {
    log.info('Validation failed (Zod)', {
      method,
      path,
      issues: error.issues.slice(0, 8),
      requestId: req.auditRequestId
    })
    auditFail(req, 'http.validation_failed', {
      issues: error.issues.slice(0, 8).map((i) => ({ path: i.path, message: i.message }))
    })
    const first = error.issues[0]
    const firstMsg =
      first && typeof first.message === 'string' && first.message.trim() ? first.message.trim() : null
    return res.status(400).json({
      message: firstMsg || 'Invalid request payload',
      errors: error.flatten().fieldErrors
    })
  }

  if (error instanceof multer.MulterError) {
    const msg =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Image too large (max 6 MB)'
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field (use field name: image)'
          : error.message
    log.info('Multer error', { method, path, code: error.code, message: error.message })
    auditFail(req, 'http.upload_failed', { code: error.code, message: msg })
    return res.status(400).json({ message: msg })
  }

  if (axios.isAxiosError(error)) {
    const rawStatus = error.response?.status || 500
    // Zoho OAuth / org errors sometimes come back as 401. The admin SPA clears its JWT on *any* HTTP 401,
    // so never forward upstream 401 as 401 for API routes (avoid false "logged out" after a good admin login).
    const status = rawStatus === 401 ? 502 : rawStatus
    log.warn('Upstream (Zoho) request failed', {
      method,
      path,
      requestId: req.auditRequestId,
      ...serializeAxiosError(error)
    })
    const zohoBody = error.response?.data
    const zohoMsg =
      typeof zohoBody === 'object' && zohoBody != null && typeof zohoBody.message === 'string'
        ? zohoBody.message
        : ''
    const isRateLimited = isZohoRateLimitError(error)
    const needsAuthHint =
      !isRateLimited &&
      (rawStatus === 401 ||
        (typeof zohoBody === 'object' && zohoBody != null && Number(zohoBody.code) === 57) ||
        /not authorized/i.test(zohoMsg))
    auditFail(req, 'zoho.upstream_failed', {
      status: rawStatus,
      message: zohoMsg || error.message,
      rateLimited: isRateLimited
    })
    return res.status(status).json({
      message: isRateLimited
        ? 'Zoho API is busy — automatic retries were exhausted. Try again shortly.'
        : zohoMsg || 'Zoho API request failed',
      zoho: zohoBody || error.message,
      ...(isRateLimited ? { zoho_rate_limit: true } : {}),
      ...(needsAuthHint
        ? { zoho_auth_hint: 'Check ZOHO_REFRESH_TOKEN and OAuth scopes (Books full access).' }
        : {})
    })
  }

  if (typeof error?.statusCode === 'number') {
    const code = error.statusCode
    const errMessage = error instanceof Error ? error.message : String(error?.message || error)
    if (code >= 500) {
      log.error('Application error', {
        method,
        path,
        statusCode: code,
        requestId: req.auditRequestId,
        ...serializeError(error)
      })
    } else {
      log.info('Client error', {
        method,
        path,
        statusCode: code,
        errMessage,
        requestId: req.auditRequestId
      })
    }
    auditFail(req, inferActionFromPath(path), {
      statusCode: code,
      message: errMessage
    })
    return res.status(error.statusCode).json({
      message: error.message || 'Request failed'
    })
  }

  log.error('Unhandled error', { method, path, requestId: req.auditRequestId, ...serializeError(error) })
  auditFail(req, 'http.unhandled_error', {
    message: error instanceof Error ? error.message : String(error)
  })
  return res.status(500).json({
    message: error.message || 'Internal server error'
  })
}

function inferActionFromPath(path) {
  const p = String(path || '')
  if (p.includes('/otp/send')) return 'otp.send.failed'
  if (p.includes('/otp/resend')) return 'otp.resend.failed'
  if (p.includes('/auth/signup')) return 'customer.signup.failed'
  if (p.includes('/auth/login')) return 'customer.login.failed'
  if (p.includes('/auth/profile')) return 'customer.profile.failed'
  if (p.includes('/payments')) return 'payment.failed'
  if (p.includes('/orders')) return 'order.failed'
  if (p.includes('/delivery')) return 'delivery.failed'
  if (p.includes('/admin')) return 'admin.failed'
  return 'http.request.failed'
}
