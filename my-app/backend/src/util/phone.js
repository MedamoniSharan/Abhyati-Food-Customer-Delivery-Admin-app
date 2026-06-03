/** Strip to digits only (e.g. +91 98765 43210 → 919876543210). */
export function digitsOnlyPhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

/** Last 10 digits for India-style matching. */
export function phoneLast10(phone) {
  const d = digitsOnlyPhone(phone)
  return d.length >= 10 ? d.slice(-10) : d
}

export function phonesMatch(a, b) {
  const x = phoneLast10(a)
  const y = phoneLast10(b)
  return x.length >= 8 && y.length >= 8 && x === y
}
