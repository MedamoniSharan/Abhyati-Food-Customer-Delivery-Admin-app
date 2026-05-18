/**
 * App login credentials live only in Zoho Books contact `notes` (single-line marker + scrypt hash).
 * Prefixes distinguish customers vs drivers when both use contact_type "customer".
 */
export const CUST_PW_PREFIX = '__abh_cust_v1:'
export const DRV_PW_PREFIX = '__abh_drv_v1:'

function firstLine(notes) {
  const s = String(notes ?? '').trim()
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i).trim()
}

export function parseCustomerPasswordHashFromNotes(notes) {
  const line = firstLine(notes)
  if (!line.startsWith(CUST_PW_PREFIX)) return null
  return line.slice(CUST_PW_PREFIX.length) || null
}

export function parseDriverPasswordHashFromNotes(notes) {
  const line = firstLine(notes)
  if (!line.startsWith(DRV_PW_PREFIX)) return null
  return line.slice(DRV_PW_PREFIX.length) || null
}

export function hasCustomerAppLoginNotes(notes) {
  return Boolean(parseCustomerPasswordHashFromNotes(notes))
}

export function hasDriverAppLoginNotes(notes) {
  return Boolean(parseDriverPasswordHashFromNotes(notes))
}

/** Replace first credential line or set notes to marker+hash only (drops prior free-text notes for app-managed rows). */
export function buildNotesWithCustomerHash(passwordHash) {
  return `${CUST_PW_PREFIX}${passwordHash}`
}

export function buildNotesWithDriverHash(passwordHash) {
  return `${DRV_PW_PREFIX}${passwordHash}`
}

/** Strip credential line for API responses to admin UI. */
export function redactNotesForAdmin(contact) {
  if (!contact || typeof contact !== 'object') return contact
  const n = contact.notes
  if (typeof n === 'string' && (n.includes(CUST_PW_PREFIX) || n.includes(DRV_PW_PREFIX))) {
    return { ...contact, notes: '' }
  }
  return contact
}
