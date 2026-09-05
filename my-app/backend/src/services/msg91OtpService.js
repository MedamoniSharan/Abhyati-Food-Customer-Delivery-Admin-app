import { env } from '../config/env.js'
import { createLogger } from '../util/logger.js'
import { normalizeIndiaMobile } from '../util/indiaMobile.js'

export { normalizeIndiaMobile } from '../util/indiaMobile.js'

const log = createLogger('msg91-otp')

const MSG91_BASE = 'https://control.msg91.com/api/v5'

/**
 * Normalize to India E.164 without plus: 91 + 10 digits.
 * Accepts 10-digit local, 91XXXXXXXXXX, or +91...
 */
// normalizeIndiaMobile imported from util/indiaMobile.js


export function isMsg91Configured() {
  // Server needs Auth Key to verify widget access tokens (and optional legacy SendOTP).
  return Boolean(env.MSG91_AUTH_KEY?.trim())
}

/** Prefer OTP Widget when widgetId + tokenAuth are set (server proxies → avoids browser IPBlocked). */
export function isMsg91WidgetConfigured() {
  return Boolean(env.MSG91_WIDGET_ID?.trim() && env.MSG91_WIDGET_AUTH_TOKEN?.trim() && isMsg91Configured())
}

function requireConfigured() {
  if (!isMsg91Configured()) {
    const err = new Error('Phone verification is not configured. Contact support.')
    err.statusCode = 503
    throw err
  }
}

function requireWidgetConfigured() {
  if (!isMsg91WidgetConfigured()) {
    const err = new Error('Phone verification widget is not configured. Contact support.')
    err.statusCode = 503
    throw err
  }
}

function msg91Error(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function mapMsg91Failure(data, fallback) {
  const raw = data?.message
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return msg91Error(fallback)
  const lower = text.toLowerCase()
  if (lower.includes('ipblocked') || lower.includes('ip blocked') || lower.includes('ip not allowed')) {
    return msg91Error(
      'MSG91 blocked this server IP. Whitelist the API host IP in MSG91 → Company Settings → IP Security, or use your Render backend.',
      403
    )
  }
  if (lower.includes('invalid mobile') || lower.includes('mobile number')) {
    return msg91Error('Enter a valid Indian mobile number')
  }
  if (lower.includes('otp') && (lower.includes('expire') || lower.includes('invalid') || lower.includes('mismatch'))) {
    return msg91Error('Invalid or expired OTP. Request a new one.')
  }
  if (lower.includes('auth') || lower.includes('template')) {
    return msg91Error('Phone verification service error. Try again later.', 502)
  }
  return msg91Error(text.length < 120 ? text : fallback)
}

function pickWidgetReqId(data) {
  const explicit = data?.reqId ?? data?.request_id ?? data?.requestId
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  if (data?.type === 'success' && typeof data.message === 'string') {
    const m = data.message.trim()
    if (/^[a-zA-Z0-9]{16,}$/.test(m)) return m
  }
  return null
}

function pickWidgetAccessToken(data) {
  const t =
    data?.['access-token'] ??
    data?.accessToken ??
    data?.token ??
    (typeof data?.message === 'string' && data?.type === 'success' ? data.message : null)
  return typeof t === 'string' && t.trim() ? t.trim() : null
}

async function widgetPost(path, body) {
  requireWidgetConfigured()
  let response
  try {
    response = await fetch(`${MSG91_BASE}/widget${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  } catch (err) {
    log.error('MSG91 widget request failed', { path, message: err?.message })
    throw msg91Error('Could not reach phone verification service. Try again.', 502)
  }

  let data = {}
  const text = await response.text()
  try {
    data = text.trim() ? JSON.parse(text) : {}
  } catch {
    data = { message: text }
  }

  const type = String(data.type || '').toLowerCase()
  if (!response.ok || type === 'error') {
    log.warn('MSG91 widget error', { path, status: response.status, data })
    throw mapMsg91Failure(data, 'Phone verification failed')
  }
  return data
}

function widgetCredsBody() {
  return {
    widgetId: env.MSG91_WIDGET_ID.trim(),
    tokenAuth: env.MSG91_WIDGET_AUTH_TOKEN.trim()
  }
}

/**
 * Send OTP via MSG91 Widget (server-side — MSG91 sees API host IP, not browser).
 * @param {string} mobile
 */
export async function sendWidgetOtp(mobile) {
  const normalized = normalizeIndiaMobile(mobile)
  if (!normalized) {
    throw msg91Error('Enter a valid 10-digit Indian mobile number')
  }
  const data = await widgetPost('/sendOtp', {
    ...widgetCredsBody(),
    identifier: normalized
  })
  const requestId = pickWidgetReqId(data)
  if (!requestId) {
    throw msg91Error('OTP sent but no request id returned. Try again.', 502)
  }
  log.info('MSG91 widget OTP accepted', {
    mobile: `${normalized.slice(0, 4)}****${normalized.slice(-2)}`,
    requestId
  })
  return { mobile: normalized, requestId }
}

/**
 * @param {string} requestId
 */
export async function retryWidgetOtp(requestId) {
  const reqId = String(requestId || '').trim()
  if (!reqId) {
    throw msg91Error('Send OTP first before resending.')
  }
  const data = await widgetPost('/retryOtp', {
    ...widgetCredsBody(),
    reqId,
    retryChannel: 11
  })
  const nextId = pickWidgetReqId(data) || reqId
  log.info('MSG91 widget OTP retry accepted', { requestId: nextId })
  return { requestId: nextId }
}

/**
 * Verify OTP digits via widget; returns access-token for verifyAccessToken.
 * @param {string} requestId
 * @param {string} otp
 */
export async function verifyWidgetOtp(requestId, otp) {
  const reqId = String(requestId || '').trim()
  const code = String(otp || '').trim()
  if (!reqId) {
    throw msg91Error('Send OTP to your mobile first')
  }
  if (!/^\d{4,9}$/.test(code)) {
    throw msg91Error('Enter the OTP sent to your mobile')
  }
  const data = await widgetPost('/verifyOtp', {
    ...widgetCredsBody(),
    reqId,
    otp: code
  })
  const accessToken = pickWidgetAccessToken(data)
  if (!accessToken) {
    throw mapMsg91Failure(data, 'Invalid or expired OTP. Request a new one.')
  }
  return { accessToken }
}

/** Resend/retry failures must not reuse verify-OTP copy ("Request a new one"). */
function mapResendFailure(data) {
  const raw = data?.message
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return msg91Error('Could not resend OTP. Try again.')
  const lower = text.toLowerCase()
  if (lower.includes('invalid mobile') || lower.includes('mobile number')) {
    return msg91Error('Enter a valid Indian mobile number')
  }
  if (lower.includes('auth') || lower.includes('template')) {
    return msg91Error('Phone verification service error. Try again later.', 502)
  }
  return msg91Error('Could not resend OTP. Try again.')
}

async function msg91Request(path, { method = 'GET', query = {}, mapFailure = mapMsg91Failure } = {}) {
  requireConfigured()
  const url = new URL(`${MSG91_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value))
  }

  let response
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authkey: env.MSG91_AUTH_KEY.trim()
      }
    })
  } catch (err) {
    log.error('MSG91 request failed', { path, message: err?.message })
    throw msg91Error('Could not reach phone verification service. Try again.', 502)
  }

  let data = {}
  const text = await response.text()
  try {
    data = text.trim() ? JSON.parse(text) : {}
  } catch {
    data = { message: text }
  }

  const type = String(data.type || '').toLowerCase()
  const okHttp = response.ok
  const okType = type === 'success' || type === ''
  const messageOk =
    typeof data.message === 'string' &&
    /otp verified|success/i.test(data.message) &&
    !/fail|invalid|error/i.test(data.message)

  if (!okHttp || (!okType && !messageOk && type === 'error')) {
    log.warn('MSG91 error response', { path, status: response.status, data })
    throw mapFailure(data, 'Phone verification failed')
  }

  if (type === 'error') {
    log.warn('MSG91 type=error', { path, data })
    throw mapFailure(data, 'Phone verification failed')
  }

  return data
}

/**
 * @param {string} mobile - raw or normalized
 */
export async function sendOtp(mobile) {
  if (isMsg91WidgetConfigured()) {
    return sendWidgetOtp(mobile)
  }
  const normalized = normalizeIndiaMobile(mobile)
  if (!normalized) {
    throw msg91Error('Enter a valid 10-digit Indian mobile number')
  }
  if (!env.MSG91_TEMPLATE_ID?.trim()) {
    throw msg91Error('Phone verification template is not configured. Contact support.', 503)
  }

  const data = await msg91Request('/otp', {
    method: 'POST',
    query: {
      template_id: env.MSG91_TEMPLATE_ID.trim(),
      mobile: normalized,
      otp_length: env.MSG91_OTP_LENGTH || 6,
      // Ask MSG91 for immediate delivery hint when available (still often "success" only).
      realTimeResponse: 1
    }
  })

  const requestId = data?.request_id || data?.requestId || null
  log.info('MSG91 OTP accepted (queued, not proof of SMS delivery)', {
    mobile: `${normalized.slice(0, 4)}****${normalized.slice(-2)}`,
    requestId,
    templateId: `${env.MSG91_TEMPLATE_ID.trim().slice(0, 6)}…`,
    msg91Type: data?.type,
    msg91Message: data?.message
  })

  return { mobile: normalized, requestId }
}

/**
 * @param {string} mobile
 * @param {string} otp
 * @param {{ requestId?: string }} [opts] - widget verify needs requestId from send
 */
export async function verifyOtp(mobile, otp, opts = {}) {
  if (isMsg91WidgetConfigured()) {
    const { accessToken } = await verifyWidgetOtp(opts.requestId, otp)
    return verifyWidgetAccessToken(accessToken, mobile)
  }
  const normalized = normalizeIndiaMobile(mobile)
  const code = String(otp || '').trim()
  if (!normalized) {
    throw msg91Error('Enter a valid 10-digit Indian mobile number')
  }
  if (!/^\d{4,9}$/.test(code)) {
    throw msg91Error('Enter the OTP sent to your mobile')
  }

  const data = await msg91Request('/otp/verify', {
    method: 'GET',
    query: { mobile: normalized, otp: code }
  })

  const msg = String(data.message || '').toLowerCase()
  if (msg.includes('otp verified') || data.type === 'success' || msg.includes('success')) {
    return { mobile: normalized }
  }

  throw mapMsg91Failure(data, 'Invalid or expired OTP. Request a new one.')
}

/**
 * Verify MSG91 OTP Widget access-token (after client-side widget verifyOtp).
 * @param {string} accessToken
 * @param {string} [expectedMobile] - optional 91XXXXXXXXXX to match
 */
export async function verifyWidgetAccessToken(accessToken, expectedMobile) {
  const token = String(accessToken || '').trim()
  if (!token) {
    throw msg91Error('Phone verification is incomplete. Verify OTP again.')
  }
  requireConfigured()

  let response
  try {
    response = await fetch('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authkey: env.MSG91_AUTH_KEY.trim()
      },
      body: JSON.stringify({
        authkey: env.MSG91_AUTH_KEY.trim(),
        'access-token': token
      })
    })
  } catch (err) {
    log.error('MSG91 verifyAccessToken failed', { message: err?.message })
    throw msg91Error('Could not reach phone verification service. Try again.', 502)
  }

  let data = {}
  const text = await response.text()
  try {
    data = text.trim() ? JSON.parse(text) : {}
  } catch {
    data = { message: text }
  }

  const type = String(data.type || '').toLowerCase()
  if (!response.ok || type === 'error') {
    log.warn('MSG91 verifyAccessToken error', { status: response.status, data })
    throw mapMsg91Failure(data, 'Invalid or expired OTP. Request a new one.')
  }

  const verifiedMobile = normalizeIndiaMobile(
    data.mobile || data.identifier || data.phone || data.message || ''
  )
  const expected = expectedMobile ? normalizeIndiaMobile(expectedMobile) : ''
  if (expected && verifiedMobile && verifiedMobile !== expected) {
    throw msg91Error('Verified mobile does not match the number you entered.')
  }

  log.info('MSG91 widget access token verified', {
    mobile: verifiedMobile
      ? `${verifiedMobile.slice(0, 4)}****${verifiedMobile.slice(-2)}`
      : expected
        ? `${expected.slice(0, 4)}****${expected.slice(-2)}`
        : null
  })

  return { mobile: verifiedMobile || expected || null }
}

/**
 * Resend the same OTP (SMS retry). Falls back to a fresh send if retry fails.
 * @param {string} mobile
 * @param {{ requestId?: string }} [opts]
 */
export async function resendOtp(mobile, opts = {}) {
  if (isMsg91WidgetConfigured()) {
    const reqId = String(opts.requestId || '').trim()
    if (reqId) {
      try {
        const result = await retryWidgetOtp(reqId)
        const normalized = normalizeIndiaMobile(mobile)
        return { mobile: normalized || mobile, requestId: result.requestId }
      } catch (err) {
        log.warn('MSG91 widget retry failed; falling back to fresh send', {
          message: err?.message
        })
      }
    }
    return sendWidgetOtp(mobile)
  }

  const normalized = normalizeIndiaMobile(mobile)
  if (!normalized) {
    throw msg91Error('Enter a valid 10-digit Indian mobile number')
  }

  try {
    const data = await msg91Request('/otp/retry', {
      method: 'GET',
      query: {
        retrytype: 'text',
        mobile: normalized
      },
      mapFailure: mapResendFailure
    })
    const requestId = data?.request_id || data?.requestId || null
    log.info('MSG91 OTP retry accepted', {
      mobile: `${normalized.slice(0, 4)}****${normalized.slice(-2)}`,
      requestId
    })
    return { mobile: normalized, requestId }
  } catch (err) {
    log.warn('MSG91 OTP retry failed; falling back to fresh send', {
      mobile: `${normalized.slice(0, 4)}****${normalized.slice(-2)}`,
      message: err?.message
    })
    try {
      return await sendOtp(normalized)
    } catch (sendErr) {
      throw msg91Error(
        sendErr?.message && !/request a new one/i.test(String(sendErr.message))
          ? sendErr.message
          : 'Could not resend OTP. Try again.',
        sendErr?.statusCode || 400
      )
    }
  }
}
