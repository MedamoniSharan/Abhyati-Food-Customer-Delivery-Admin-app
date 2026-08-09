import { env } from '../config/env.js'
import {
  buildNotesWithDriverHash,
  parseDriverPasswordHashFromNotes
} from './zohoAppCredentialNotes.js'
import { findContactByEmail, getModuleById, updateModule } from './zohoBooksService.js'
import { hashPassword, verifyPassword } from './authStore.js'

let driversListCache = null
let driversListCacheAt = 0
const DRIVERS_LIST_TTL_MS = 60_000

export function invalidateDriversListCache() {
  driversListCache = null
  driversListCacheAt = 0
}

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

function toPublicDriver(contact) {
  const id = String(contact?.contact_id ?? '')
  const active = contact?.is_active !== false && contact?.is_active !== 'false'
  const mobile = String(contact?.mobile ?? '').trim()
  return {
    id,
    fullName: String(contact?.contact_name || contact?.email || 'Driver'),
    email: normalizeEmail(String(contact?.email || '')),
    ...(mobile ? { mobile } : {}),
    zohoContactId: id,
    disabled: !active,
    createdAt: contact?.created_time || new Date().toISOString()
  }
}

async function getDriverContactForApp(email) {
  const listed = await findContactByEmail(email, env.DRIVER_ZOHO_CONTACT_TYPE)
  if (!listed?.contact_id) return null
  /** List endpoints often omit `notes`; app credentials live only in detail. */
  const data = await getModuleById('/contacts', String(listed.contact_id))
  const c = data?.contact || data
  if (!c?.contact_id) return null
  if (parseDriverPasswordHashFromNotes(c.notes) == null) return null
  return c
}

export async function attachDriverCredentialOnZoho(contactId, password) {
  const hash = hashPassword(password)
  const notes = buildNotesWithDriverHash(hash)
  await updateModule('/contacts', contactId, {
    contact_id: contactId,
    notes,
    is_active: true
  })
  invalidateDriversListCache()
}

export async function createDriverRecord({ email, password, zohoContactId }) {
  const normalizedEmail = normalizeEmail(email)
  const existing = await getDriverContactForApp(normalizedEmail)
  if (existing) {
    const error = new Error('Driver email already exists')
    error.statusCode = 409
    throw error
  }
  const data = await getModuleById('/contacts', zohoContactId)
  const contact = data.contact || data
  if (!contact?.contact_id) {
    const err = new Error('Driver Zoho contact not found')
    err.statusCode = 404
    throw err
  }
  if (parseDriverPasswordHashFromNotes(contact.notes)) {
    const err = new Error('App login already set for this Zoho driver contact')
    err.statusCode = 409
    throw err
  }
  await attachDriverCredentialOnZoho(zohoContactId, password)
  invalidateDriversListCache()
  const fresh = (await getModuleById('/contacts', zohoContactId)).contact || contact
  return toPublicDriver(fresh)
}

export async function getDriverPublicProfileByEmail(email) {
  const contact = await getDriverContactForApp(normalizeEmail(email))
  if (!contact) return null
  if (contact.is_active === false || contact.is_active === 'false') return null
  return toPublicDriver(contact)
}

export async function loginDriverUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email)
  const contact = await getDriverContactForApp(normalizedEmail)
  if (!contact) {
    const error = new Error('Invalid email or password')
    error.statusCode = 401
    throw error
  }
  if (contact.is_active === false || contact.is_active === 'false') {
    const error = new Error('Invalid email or password')
    error.statusCode = 401
    throw error
  }
  const hash = parseDriverPasswordHashFromNotes(contact.notes)
  if (!hash || !verifyPassword(password, hash)) {
    const error = new Error('Invalid email or password')
    error.statusCode = 401
    throw error
  }
  return { public: toPublicDriver(contact), id: String(contact.contact_id) }
}

/** Resolve the driver app-login email for a Zoho contact id (detail fetch). */
export async function getDriverEmailByZohoContactId(contactId) {
  const id = String(contactId ?? '').trim()
  if (!id) return null
  const data = await getModuleById('/contacts', id)
  const c = data?.contact || data
  if (!c?.contact_id || parseDriverPasswordHashFromNotes(c.notes) == null) return null
  return normalizeEmail(String(c.email || ''))
}

export async function getDriverByEmail(email) {
  const contact = await getDriverContactForApp(normalizeEmail(email))
  if (!contact) return null
  return {
    id: String(contact.contact_id),
    fullName: String(contact.contact_name || contact.email || 'Driver'),
    email: normalizeEmail(String(contact.email || '')),
    zohoContactId: String(contact.contact_id),
    disabled: contact.is_active === false || contact.is_active === 'false',
    passwordHash: parseDriverPasswordHashFromNotes(contact.notes) || ''
  }
}

export async function setDriverDisabled(email, disabled) {
  const contact = await findContactByEmail(normalizeEmail(email), env.DRIVER_ZOHO_CONTACT_TYPE)
  if (!contact?.contact_id || parseDriverPasswordHashFromNotes(contact.notes) == null) return false
  await updateModule('/contacts', contact.contact_id, {
    contact_id: contact.contact_id,
    is_active: !disabled
  })
  invalidateDriversListCache()
  return true
}

/** Toggle active by Zoho contact id (avoids email-in-URL issues). */
export async function setDriverDisabledByContactId(contactId, disabled) {
  const id = String(contactId ?? '').trim()
  if (!id) return false
  const data = await getModuleById('/contacts', id)
  const c = data?.contact || data
  if (!c?.contact_id || parseDriverPasswordHashFromNotes(c.notes) == null) return false
  await updateModule('/contacts', id, { contact_id: id, is_active: !disabled })
  invalidateDriversListCache()
  return true
}

export async function deleteDriverRecord(email) {
  const contact = await getDriverContactForApp(normalizeEmail(email))
  if (!contact?.contact_id) return false
  return deleteDriverRecordByContactId(contact.contact_id)
}

/** Remove driver app-login credentials from Zoho notes (stops listing in Deliverers). */
export async function deleteDriverRecordByContactId(contactId) {
  const id = String(contactId ?? '').trim()
  if (!id) return false
  const data = await getModuleById('/contacts', id)
  const c = data?.contact || data
  if (!c?.contact_id || parseDriverPasswordHashFromNotes(c.notes) == null) return false
  await updateModule('/contacts', id, { contact_id: id, notes: '' })
  invalidateDriversListCache()
  return true
}

export async function updateDriverRecord(currentEmail, { fullName, email, password, mobile }) {
  const contact = await getDriverContactForApp(normalizeEmail(currentEmail))
  if (!contact?.contact_id) return null

  const nextEmail = email ? normalizeEmail(email) : normalizeEmail(String(contact.email || ''))
  const payload = {
    contact_id: contact.contact_id,
    ...(typeof fullName === 'string' && fullName.trim() ? { contact_name: fullName.trim() } : {}),
    ...(email ? { email: nextEmail } : {}),
    ...(mobile !== undefined ? { mobile: String(mobile ?? '').trim() } : {})
  }
  if (Object.keys(payload).length > 1) {
    await updateModule('/contacts', contact.contact_id, payload)
  }
  if (typeof password === 'string' && password) {
    await attachDriverCredentialOnZoho(contact.contact_id, password)
  }
  invalidateDriversListCache()
  const fresh = (await getModuleById('/contacts', contact.contact_id)).contact || contact
  return toPublicDriver(fresh)
}

export async function listDrivers() {
  if (driversListCache && Date.now() - driversListCacheAt < DRIVERS_LIST_TTL_MS) {
    return driversListCache
  }
  const { listContactsDetailBySearchText } = await import('./zohoBooksService.js')
  const { hasDriverAppLoginNotes, DRV_PW_PREFIX } = await import('./zohoAppCredentialNotes.js')
  const wantType = String(env.DRIVER_ZOHO_CONTACT_TYPE || 'customer').toLowerCase()
  const fullRows = await listContactsDetailBySearchText({
    searchText: DRV_PW_PREFIX,
    contactType: wantType,
    maxPages: 25
  })
  const drivers = fullRows.filter((c) => hasDriverAppLoginNotes(c.notes)).map((c) => toPublicDriver(c))
  driversListCache = drivers
  driversListCacheAt = Date.now()
  return drivers
}
