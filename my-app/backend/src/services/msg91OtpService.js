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
  return Boolean(env.MSG91_AUTH_KEY?.trim() && env.MSG91_TEMPLATE_ID?.trim())
}

function requireConfigured() {
  if (!isMsg91Configured()) {
    const err = new Error('Phone verification is not configured. Contact support.')
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
  const normalized = normalizeIndiaMobile(mobile)
  if (!normalized) {
    throw msg91Error('Enter a valid 10-digit Indian mobile number')
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
 */
export async function verifyOtp(mobile, otp) {
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
 * Resend the same OTP (SMS retry). Falls back to a fresh send if retry fails.
 * @param {string} mobile
 */
export async function resendOtp(mobile) {
  const normalized = normalizeIndiaMobile(mobile)
  if (!normalized) {
    throw msg91Error('Enter a valid 10-digit Indian mobile number')
  }

  try {
    await msg91Request('/otp/retry', {
      method: 'GET',
      query: {
        retrytype: 'text',
        mobile: normalized
      },
      mapFailure: mapResendFailure
    })
    return { mobile: normalized }
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
