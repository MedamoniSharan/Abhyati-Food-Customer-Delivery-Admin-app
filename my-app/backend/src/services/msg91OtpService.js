import axios from 'axios'
import { env } from '../config/env.js'
import { createLogger } from '../util/logger.js'
import { digitsOnlyPhone } from '../util/phone.js'

const log = createLogger('msg91')
const MSG91_OTP_URL = 'https://control.msg91.com/api/v5/otp'

/** Minimum seconds between OTP sends to the same mobile. */
const SEND_COOLDOWN_SEC = 60
const lastSendByMobile = new Map()

export function isMsg91Configured() {
  return Boolean(String(env.MSG91_AUTH_KEY || '').trim() && String(env.MSG91_TEMPLATE_ID || '').trim())
}

export function isMsg91DevBypass() {
  return env.NODE_ENV !== 'production' && Boolean(env.MSG91_DEV_BYPASS)
}

/**
 * MSG91 expects mobile with country code, no plus (e.g. 919876543210).
 */
export function normalizeMobileForMsg91(mobile) {
  const cc = String(env.MSG91_COUNTRY_CODE || '91').replace(/\D/g, '') || '91'
  let digits = digitsOnlyPhone(mobile)
  if (!digits || digits.length < 8) {
    const err = new Error('Enter a valid mobile number')
    err.statusCode = 400
    throw err
  }
  if (digits.length === 10) digits = `${cc}${digits}`
  else if (digits.length === 11 && digits.startsWith('0')) digits = `${cc}${digits.slice(1)}`
  else if (!digits.startsWith(cc) && digits.length <= 10) digits = `${cc}${digits}`
  return digits
}

function assertSendCooldown(msg91Mobile) {
  const prev = lastSendByMobile.get(msg91Mobile)
  if (!prev) return
  const elapsed = (Date.now() - prev) / 1000
  if (elapsed < SEND_COOLDOWN_SEC) {
    const wait = Math.ceil(SEND_COOLDOWN_SEC - elapsed)
    const err = new Error(`Please wait ${wait}s before requesting another OTP`)
    err.statusCode = 429
    throw err
  }
}

function markSent(msg91Mobile) {
  lastSendByMobile.set(msg91Mobile, Date.now())
}

function parseMsg91Body(data) {
  if (!data || typeof data !== 'object') return data
  return data
}

function isMsg91Success(data) {
  if (!data || typeof data !== 'object') return false
  const t = String(data.type || '').toLowerCase()
  if (t === 'success') return true
  const msg = String(data.message || '').toLowerCase()
  return msg.includes('success') || msg.includes('verified')
}

/**
 * Send OTP via MSG91 (v5 API).
 * @returns {{ mobile: string, devBypass?: boolean }}
 */
export async function sendOtpToMobile(mobile) {
  const msg91Mobile = normalizeMobileForMsg91(mobile)

  if (!isMsg91Configured()) {
    if (isMsg91DevBypass()) {
      log.warn('MSG91 not configured — dev bypass active (use MSG91_DEV_OTP to verify)')
      return { mobile: msg91Mobile, devBypass: true }
    }
    const err = new Error('SMS OTP is not configured on the server')
    err.statusCode = 503
    throw err
  }

  assertSendCooldown(msg91Mobile)

  try {
    const response = await axios.post(
      MSG91_OTP_URL,
      {
        template_id: env.MSG91_TEMPLATE_ID,
        mobile: msg91Mobile,
        otp_length: String(env.MSG91_OTP_LENGTH),
        otp_expiry: env.MSG91_OTP_EXPIRY_MIN
      },
      {
        headers: {
          authkey: env.MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
          accept: 'application/json'
        },
        timeout: 20_000
      }
    )
    const body = parseMsg91Body(response.data)
    if (body && typeof body === 'object' && String(body.type || '').toLowerCase() === 'error') {
      const err = new Error(body.message || 'Failed to send OTP')
      err.statusCode = 502
      throw err
    }
    markSent(msg91Mobile)
    return { mobile: msg91Mobile }
  } catch (error) {
    if (error?.statusCode) throw error
    const msg =
      error?.response?.data?.message || error?.message || 'Failed to send OTP via MSG91'
    const err = new Error(msg)
    err.statusCode = error?.response?.status === 429 ? 429 : 502
    throw err
  }
}

/**
 * Verify OTP with MSG91. Throws on failure.
 */
export async function verifyOtpForMobile(mobile, otp) {
  const code = String(otp || '').trim()
  if (!code || code.length < 4) {
    const err = new Error('Enter the OTP sent to your mobile')
    err.statusCode = 400
    throw err
  }

  const msg91Mobile = normalizeMobileForMsg91(mobile)

  if (!isMsg91Configured()) {
    if (isMsg91DevBypass() && code === String(env.MSG91_DEV_OTP || '123456')) {
      return { mobile: msg91Mobile, devBypass: true }
    }
    const err = new Error('SMS OTP is not configured on the server')
    err.statusCode = 503
    throw err
  }

  try {
    const response = await axios.get(`${MSG91_OTP_URL}/verify`, {
      params: { mobile: msg91Mobile, otp: code },
      headers: {
        authkey: env.MSG91_AUTH_KEY,
        accept: 'application/json'
      },
      timeout: 20_000
    })
    const body = parseMsg91Body(response.data)
    if (!isMsg91Success(body)) {
      const err = new Error(body?.message || 'Invalid or expired OTP')
      err.statusCode = 401
      throw err
    }
    return { mobile: msg91Mobile }
  } catch (error) {
    if (error?.statusCode) throw error
    const msg = error?.response?.data?.message || error?.message || 'OTP verification failed'
    const err = new Error(msg)
    err.statusCode = 401
    throw err
  }
}
