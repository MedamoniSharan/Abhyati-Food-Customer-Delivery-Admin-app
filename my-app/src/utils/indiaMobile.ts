/**
 * Normalize to India E.164 without plus: 91 + 10 digits.
 * Accepts flexible stored/legacy values for reads (10-digit, 91…, +91…, 0…).
 * User-facing forms must use {@link isTenDigitIndiaMobileInput} (plain 10 digits only).
 */
export function normalizeIndiaMobile(input: string | null | undefined): string {
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
export function isTenDigitIndiaMobileInput(input: string | null | undefined): boolean {
  return /^[6-9]\d{9}$/.test(String(input || '').trim())
}

export function isValidIndiaMobile(input: string | null | undefined): boolean {
  return Boolean(normalizeIndiaMobile(input))
}

/** Form validation: user must type exactly 10 digits, no country code. */
export function looksLikeIndiaMobile(value: string): boolean {
  return isTenDigitIndiaMobileInput(value)
}

/** Local 10 digits for form inputs (strips +91 / formatting from stored values). */
export function toTenDigitIndiaMobile(input: string | null | undefined): string {
  const n = normalizeIndiaMobile(input)
  return n ? n.slice(2) : ''
}

/** Keep only digits and cap at 10 — for controlled mobile inputs. */
export function sanitizeTenDigitMobileInput(raw: string): string {
  return String(raw || '')
    .replace(/\D/g, '')
    .slice(0, 10)
}

/** Display as +91 XXXXX XXXXX when valid; otherwise trimmed raw. */
export function formatIndiaMobileDisplay(input: string | null | undefined): string {
  const n = normalizeIndiaMobile(input)
  if (!n) return String(input || '').trim()
  const local = n.slice(2)
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
}

/** Digits for tel:/sms: (+9198…). */
export function formatIndiaMobileTel(input: string | null | undefined): string {
  const n = normalizeIndiaMobile(input)
  if (n) return `+${n}`
  return String(input || '').replace(/[^\d+]/g, '')
}
