/**
 * Normalize to India E.164 without plus: 91 + 10 digits.
 * Accepts flexible stored/legacy values for reads (10-digit, 91…, +91…, 0…).
 * User-facing OTP/signup input must use {@link isTenDigitIndiaMobileInput}.
 */
export function normalizeIndiaMobile(input) {
  const digits = String(input || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91') && /^91[6-9]\d{9}$/.test(digits)) return digits
  if (digits.length === 11 && digits.startsWith('0') && /^0[6-9]\d{9}$/.test(digits)) {
    return `91${digits.slice(1)}`
  }
  return ''
}

/** True only for plain 10-digit Indian mobile (no +91 / 91 / spaces). */
export function isTenDigitIndiaMobileInput(input) {
  return /^[6-9]\d{9}$/.test(String(input || '').trim())
}

export function isValidIndiaMobile(input) {
  return Boolean(normalizeIndiaMobile(input))
}

/** Local 10 digits for forms (strips +91 / formatting from stored values). */
export function toTenDigitIndiaMobile(input) {
  const n = normalizeIndiaMobile(input)
  return n ? n.slice(2) : ''
}

/** Display as +91 XXXXX XXXXX when valid; otherwise trimmed raw. */
export function formatIndiaMobileDisplay(input) {
  const n = normalizeIndiaMobile(input)
  if (!n) return String(input || '').trim()
  const local = n.slice(2)
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
}

/** tel:/sms: href value (+9198…). */
export function formatIndiaMobileTel(input) {
  const n = normalizeIndiaMobile(input)
  if (n) return `+${n}`
  const fallback = String(input || '').replace(/[^\d+]/g, '')
  return fallback
}
