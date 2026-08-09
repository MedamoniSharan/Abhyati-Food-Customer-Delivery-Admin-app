/**
 * Normalize to India E.164 without plus: 91 + 10 digits.
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

export function isValidIndiaMobile(input: string | null | undefined): boolean {
  return Boolean(normalizeIndiaMobile(input))
}

export function formatIndiaMobileDisplay(input: string | null | undefined): string {
  const n = normalizeIndiaMobile(input)
  if (!n) return String(input || '').trim()
  const local = n.slice(2)
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
}

export function formatIndiaMobileTel(input: string | null | undefined): string {
  const n = normalizeIndiaMobile(input)
  if (n) return `+${n}`
  return String(input || '').replace(/[^\d+]/g, '')
}
