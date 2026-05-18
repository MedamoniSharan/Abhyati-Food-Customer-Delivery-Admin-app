import type { AuthUser } from '../services/authApi'

function hasMeaningfulName(name?: string | null): boolean {
  return String(name || '').trim().length >= 2
}

function hasValidMobile(m?: string | null): boolean {
  const digits = String(m || '').replace(/\D/g, '')
  return digits.length >= 8
}

function hasDeliveryAddress(user: AuthUser): boolean {
  return String(user.deliveryAddress || '').trim().length >= 5
}

/** Human-readable gaps to fix before checkout (order: name, phone, address). */
export function getCheckoutProfileGaps(user: AuthUser): string[] {
  const gaps: string[] = []
  if (!hasMeaningfulName(user.fullName)) gaps.push('your full name')
  if (!hasValidMobile(user.mobile)) gaps.push('a contact mobile number (at least 8 digits)')
  if (!hasDeliveryAddress(user)) gaps.push('your delivery address')
  return gaps
}

export function checkoutProfileBlocked(user: AuthUser): boolean {
  return getCheckoutProfileGaps(user).length > 0
}
