import axios from 'axios'
import multer from 'multer'
import { ZodError } from 'zod'
import { createLogger, serializeAxiosError, serializeError } from '../util/logger.js'

const log = createLogger('errors')

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
    log.warn('JWT rejected', { method, path, reason: error?.name })
    return res.status(401).json({ message: 'Invalid or expired token' })
  }

  if (error instanceof ZodError) {
    log.info('Validation failed (Zod)', {
      method,
      path,
      issues: error.issues.slice(0, 8)
    })
    return res.status(400).json({
      message: 'Invalid request payload',
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
      ...serializeAxiosError(error)
    })
    return res.status(status).json({
      message: 'Zoho API request failed',
      zoho: error.response?.data || error.message,
      ...(rawStatus === 401 ? { zoho_auth_hint: 'Check ZOHO_REFRESH_TOKEN and OAuth scopes (Books full access).' } : {})
    })
  }

  if (typeof error?.statusCode === 'number') {
    const code = error.statusCode
    if (code >= 500) {
      log.error('Application error', { method, path, statusCode: code, ...serializeError(error) })
    } else {
      log.info('Client error', {
        method,
        path,
        statusCode: code,
        errMessage: error instanceof Error ? error.message : String(error?.message || error)
      })
    }
    return res.status(error.statusCode).json({
      message: error.message || 'Request failed'
    })
  }

  log.error('Unhandled error', { method, path, ...serializeError(error) })
  return res.status(500).json({
    message: error.message || 'Internal server error'
  })
}
