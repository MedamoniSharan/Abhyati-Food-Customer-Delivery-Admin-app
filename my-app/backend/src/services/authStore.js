import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createLogger, serializeError } from '../util/logger.js'
import { env } from '../config/env.js'
import {
  buildNotesWithCustomerHash,
  parseCustomerPasswordHashFromNotes,
  parseDriverPasswordHashFromNotes,
  hasCustomerAppLoginNotes,
  hasDriverAppLoginNotes,
  CUST_PW_PREFIX
} from './zohoAppCredentialNotes.js'
import {
  ensureCustomerContact,
  findCustomerByEmail,
  getModuleById,
  listContactsDetailBySearchText,
  updateModule
} from './zohoBooksService.js'

const log = createLogger('auth')

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hashed = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hashed}`
}

export function verifyPassword(password, storedHash) {
  const [salt, originalHash] = storedHash.split(':')
  if (!salt || !originalHash) return false
  const currentHash = scryptSync(password, salt, 64).toString('hex')
  return timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(currentHash, 'hex'))
}

function formatDeliveryAddressFromContact(contact) {
  const ship = contact?.shipping_address && typeof contact.shipping_address === 'object' ? contact.shipping_address : {}
  const bill = contact?.billing_address && typeof contact.billing_address === 'object' ? contact.billing_address : {}
  const build = (a) => {
    const line1 = String(a.address || '').trim()
    const rest = [a.street2, a.city, a.state, a.zip, a.country].map((x) => String(x || '').trim()).filter(Boolean)
    return [line1, ...rest].filter(Boolean).join(', ')
  }
  const s = build(ship)
  const b = build(bill)
  return (s || b || '').trim()
}

/** Zoho often returns phone on `phone`, `work_phone`, or the primary contact person — not only `mobile`. */
function pickMobileFromContact(contact) {
  const root =
    String(contact?.mobile ?? '').trim() ||
    String(contact?.phone ?? '').trim() ||
    String(contact?.work_phone ?? '').trim()
  if (root) return root
  const persons = Array.isArray(contact?.contact_persons) ? contact.contact_persons : []
  const primary = persons.find((p) => p?.is_primary_contact === true) || persons[0]
  return String(primary?.mobile ?? primary?.phone ?? '').trim()
}

/**
 * Zoho Books persists customer numbers on the contact root (`mobile` / `phone`) and on the primary contact person.
 * PUT with only `mobile` at root is often ignored in the UI; mirror onto `phone` and primary `contact_persons`.
 */
function contactPersonsWithPrimaryPhone(contact, mobileVal) {
  const v = String(mobileVal ?? '').trim()
  const persons = Array.isArray(contact?.contact_persons) ? contact.contact_persons : []
  if (persons.length === 0) return undefined
  let idx = persons.findIndex((p) => p?.is_primary_contact === true)
  if (idx < 0) idx = 0
  return persons.map((p, i) => (i === idx ? { ...p, phone: v, mobile: v } : { ...p }))
}

function toPublicUserFromContact(contact) {
  const id = String(contact?.contact_id ?? '')
  const mobile = pickMobileFromContact(contact)
  const deliveryAddress = formatDeliveryAddressFromContact(contact)
  return {
    id,
    fullName: String(contact?.contact_name || contact?.email || 'Customer'),
    email: normalizeEmail(String(contact?.email || '')),
    ...(mobile ? { mobile } : {}),
    ...(deliveryAddress ? { deliveryAddress } : {})
  }
}

/** Full Zoho customer contact for an app login (detail GET, excludes drivers/inactive/no password). */
export async function getCustomerContactForApp(email) {
  const listed = await findCustomerByEmail(email)
  if (!listed?.contact_id) return null
  /** List endpoints often omit `notes`; app credentials live only in detail. */
  const data = await getModuleById('/contacts', String(listed.contact_id))
  const c = data?.contact || data
  if (!c?.contact_id) return null
  if (c.is_active === false || c.is_active === 'false') return null
  if (parseDriverPasswordHashFromNotes(c.notes)) return null
  if (parseCustomerPasswordHashFromNotes(c.notes) == null) return null
  return c
}

/**
 * Writes app-login password hash into Zoho contact `notes` (customer marker).
 */
export async function attachCustomerCredentialOnZoho(contactId, password) {
  const hash = hashPassword(password)
  const notes = buildNotesWithCustomerHash(hash)
  await updateModule('/contacts', contactId, { contact_id: contactId, notes })
}

/** Creates app login by writing password hash into Zoho contact `notes` (customer marker). */
export async function createCustomerUser({ email, password, contactId: explicitContactId }) {
  const normalizedEmail = normalizeEmail(email)
  let contact
  if (explicitContactId) {
    const data = await getModuleById('/contacts', explicitContactId)
    contact = data.contact || data
  } else {
    contact = await findCustomerByEmail(normalizedEmail)
  }
  if (!contact?.contact_id) {
    const err = new Error('Customer contact not found in Zoho')
    err.statusCode = 404
    throw err
  }
  if (contact.is_active === false || contact.is_active === 'false') {
    const err = new Error('Customer contact is inactive in Zoho; activate it before adding app login')
    err.statusCode = 400
    throw err
  }
  if (parseDriverPasswordHashFromNotes(contact.notes)) {
    const err = new Error('This email is linked to a driver contact in Zoho')
    err.statusCode = 409
    throw err
  }
  const existingHash = parseCustomerPasswordHashFromNotes(contact.notes)
  if (existingHash) {
    const err = new Error('App login already set for this Zoho customer')
    err.statusCode = 409
    throw err
  }
  await attachCustomerCredentialOnZoho(contact.contact_id, password)
  const fresh = (await getModuleById('/contacts', contact.contact_id)).contact
  return toPublicUserFromContact(fresh || contact)
}

export async function loginCustomerUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email)
  const contact = await getCustomerContactForApp(normalizedEmail)
  if (!contact) {
    const error = new Error('Invalid email or password')
    error.statusCode = 401
    throw error
  }
  const hash = parseCustomerPasswordHashFromNotes(contact.notes)
  if (!hash || !verifyPassword(password, hash)) {
    const error = new Error('Invalid email or password')
    error.statusCode = 401
    throw error
  }
  return toPublicUserFromContact(contact)
}

export async function getCustomerUserByEmail(email) {
  const contact = await getCustomerContactForApp(email)
  return contact ? toPublicUserFromContact(contact) : null
}

/** Count Zoho customer contacts that have a customer app password in notes. */
export async function countCustomerAppLoginsInZoho() {
  const rows = await listContactsDetailBySearchText({ searchText: CUST_PW_PREFIX, contactType: 'customer', maxPages: 25 })
  let n = 0
  for (const c of rows) {
    if (hasDriverAppLoginNotes(c.notes)) continue
    if (c.is_active === false || c.is_active === 'false') continue
    if (hasCustomerAppLoginNotes(c.notes)) n += 1
  }
  return n
}

/**
 * Activate/deactivate a Zoho customer contact (not driver contacts). `disabled: true` sets `is_active: false`.
 * @returns {Promise<boolean>} true if updated
 */
export async function setCustomerContactDisabled(contactId, disabled) {
  const id = String(contactId ?? '').trim()
  if (!id) return false
  const data = await getModuleById('/contacts', id)
  const c = data?.contact || data
  if (!c?.contact_id) return false
  if (String(c.contact_type || '').toLowerCase() !== 'customer') return false
  if (hasDriverAppLoginNotes(c.notes)) return false
  await updateModule('/contacts', id, { contact_id: id, is_active: !disabled })
  return true
}

export async function deleteCustomerUserByEmail(email) {
  const contact = await findCustomerByEmail(normalizeEmail(email))
  if (!contact?.contact_id) return false
  if (parseCustomerPasswordHashFromNotes(contact.notes) == null) return false
  await updateModule('/contacts', contact.contact_id, { contact_id: contact.contact_id, notes: '' })
  return true
}

export async function updateCustomerUserByEmail(email, updates) {
  const normalizedEmail = normalizeEmail(email)
  let contact = await findCustomerByEmail(normalizedEmail)
  if (!contact?.contact_id) return null
  if (parseDriverPasswordHashFromNotes(contact.notes)) return null

  const nextEmail = updates.email ? normalizeEmail(updates.email) : normalizedEmail
  const detailBefore = await getModuleById('/contacts', contact.contact_id)
  const current = detailBefore?.contact || detailBefore || contact
  const prevBill =
    current?.billing_address && typeof current.billing_address === 'object' ? { ...current.billing_address } : {}

  const zohoPayload = {
    contact_id: contact.contact_id,
    ...(typeof updates.fullName === 'string' && updates.fullName.trim()
      ? { contact_name: updates.fullName.trim() }
      : {}),
    ...(updates.email ? { email: nextEmail } : {}),
    ...(updates.mobile !== undefined
      ? (() => {
          const m = String(updates.mobile ?? '').trim()
          const nextPersons = contactPersonsWithPrimaryPhone(current, m)
          return {
            mobile: m,
            phone: m,
            ...(nextPersons ? { contact_persons: nextPersons } : {})
          }
        })()
      : {}),
    ...(typeof updates.deliveryAddress === 'string'
      ? {
          billing_address: {
            ...prevBill,
            address: String(updates.deliveryAddress ?? '').trim()
          }
        }
      : {})
  }

  if (Object.keys(zohoPayload).length > 1) {
    await updateModule('/contacts', contact.contact_id, zohoPayload)
  }

  if (typeof updates.password === 'string' && updates.password) {
    await attachCustomerCredentialOnZoho(contact.contact_id, updates.password)
  }

  const fresh = (await getModuleById('/contacts', contact.contact_id)).contact || contact
  return toPublicUserFromContact(fresh)
}

/**
 * Ensures default dev customer exists in Zoho with app password in notes (Zoho-only, no JSON).
 */
export async function seedDefaultUser() {
  try {
    const email = normalizeEmail(env.AUTH_DEFAULT_CUSTOMER_EMAIL)
    const existing = await findCustomerByEmail(email)
    if (existing?.contact_id && parseCustomerPasswordHashFromNotes(existing.notes)) return

    const contact = await ensureCustomerContact({
      fullName: 'Default Customer',
      email,
      mobile: undefined
    })
    if (!contact?.contact_id) {
      log.warn('seedDefaultUser: no Zoho contact id')
      return
    }
    if (parseCustomerPasswordHashFromNotes(contact.notes)) return
    await attachCustomerCredentialOnZoho(contact.contact_id, env.AUTH_DEFAULT_CUSTOMER_PASSWORD)
    log.info('seedDefaultUser: ensured Zoho customer + app login', { email })
  } catch (err) {
    log.error('seedDefaultUser failed', serializeError(err))
  }
}
