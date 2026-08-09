import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createLogger, serializeAxiosError, serializeError } from '../util/logger.js'
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
  deleteModule,
  ensureCustomerContact,
  findCustomerByEmail,
  getModuleById,
  listContactsDetailBySearchText,
  updateModule
} from './zohoBooksService.js'
import { normalizeMapsLink, pickMapsLinkFromZohoAddressBlock, isGoogleMapsUrl } from '../util/customerMapsLink.js'
import { formatIndiaMobileDisplay, normalizeIndiaMobile } from '../util/indiaMobile.js'

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
    const street2Raw = String(a.street2 || '').trim()
    const street2 = street2Raw && !isGoogleMapsUrl(street2Raw) ? street2Raw : ''
    const rest = [street2, a.city, a.state, a.zip, a.country].map((x) => String(x || '').trim()).filter(Boolean)
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

function pickMapsLinkFromContact(contact) {
  const ship = contact?.shipping_address && typeof contact.shipping_address === 'object' ? contact.shipping_address : {}
  const bill = contact?.billing_address && typeof contact.billing_address === 'object' ? contact.billing_address : {}
  return pickMapsLinkFromZohoAddressBlock(ship) || pickMapsLinkFromZohoAddressBlock(bill)
}

function toPublicUserFromContact(contact) {
  const id = String(contact?.contact_id ?? '')
  const mobileRaw = pickMobileFromContact(contact)
  const mobileNorm = normalizeIndiaMobile(mobileRaw)
  const mobile = mobileNorm ? formatIndiaMobileDisplay(mobileNorm) : mobileRaw
  const deliveryAddress = formatDeliveryAddressFromContact(contact)
  const mapsLink = pickMapsLinkFromContact(contact)
  return {
    id,
    fullName: String(contact?.contact_name || contact?.email || 'Customer'),
    email: normalizeEmail(String(contact?.email || '')),
    ...(mobile ? { mobile } : {}),
    ...(deliveryAddress ? { deliveryAddress } : {}),
    ...(mapsLink ? { mapsLink } : {})
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

/**
 * Self-service signup: ensures Zoho customer contact + app password in notes.
 * @returns {{ user: object, zohoContactCreated: boolean }}
 */
export async function signupCustomerUser({ fullName, email, password, mobile, deliveryAddress, mapsLink }) {
  const normalizedEmail = normalizeEmail(email)
  const prior = await findCustomerByEmail(normalizedEmail)
  const zohoContactCreated = !prior?.contact_id

  if (prior?.contact_id) {
    const data = await getModuleById('/contacts', prior.contact_id)
    const c = data?.contact || data || prior
    if (parseDriverPasswordHashFromNotes(c.notes)) {
      const err = new Error('This email is registered as a driver. Use the driver app or another email.')
      err.statusCode = 409
      throw err
    }
    if (parseCustomerPasswordHashFromNotes(c.notes)) {
      const err = new Error('An account with this email already exists. Log in instead.')
      err.statusCode = 409
      throw err
    }
    if (c.is_active === false || c.is_active === 'false') {
      const err = new Error('This customer account is inactive. Contact support.')
      err.statusCode = 400
      throw err
    }
  }

  const mob = normalizeIndiaMobile(mobile) || String(mobile ?? '').trim()
  if (!mob || mob.length < 8) {
    const err = new Error('Mobile number is required')
    err.statusCode = 400
    throw err
  }

  const contact = await ensureCustomerContact({
    fullName: String(fullName || '').trim(),
    email: normalizedEmail,
    mobile: mob
  })
  if (!contact?.contact_id) {
    const err = new Error('Could not create your account. Try again later.')
    err.statusCode = 502
    throw err
  }

  const addr = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : ''
  const profileSeed = { mobile: mob }
  if (addr) profileSeed.deliveryAddress = addr
  if (typeof mapsLink === 'string') profileSeed.mapsLink = mapsLink

  try {
    // Persist mobile (and optional address) on the Zoho Books contact before app-login hash.
    await updateCustomerUserByEmail(normalizedEmail, profileSeed)

    let user = await createCustomerUser({
      email: normalizedEmail,
      password,
      contactId: contact.contact_id
    })
    user = (await updateCustomerUserByEmail(normalizedEmail, profileSeed)) || user
    return { user, zohoContactCreated }
  } catch (err) {
    if (zohoContactCreated) {
      try {
        await deleteModule('/contacts', contact.contact_id)
      } catch {
        try {
          await updateModule('/contacts', contact.contact_id, {
            contact_id: contact.contact_id,
            is_active: false
          })
        } catch {
          /* best-effort rollback */
        }
      }
    }
    if (err?.message === 'App login already set for this Zoho customer') {
      const friendly = new Error('An account with this email already exists. Log in instead.')
      friendly.statusCode = 409
      throw friendly
    }
    throw err
  }
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
let appLoginCountCache = null
let appLoginCountCacheAt = 0
const APP_LOGIN_COUNT_TTL_MS = 60_000

export async function countCustomerAppLoginsInZoho() {
  if (appLoginCountCache != null && Date.now() - appLoginCountCacheAt < APP_LOGIN_COUNT_TTL_MS) {
    return appLoginCountCache
  }
  const rows = await listContactsDetailBySearchText({ searchText: CUST_PW_PREFIX, contactType: 'customer', maxPages: 25 })
  let n = 0
  for (const c of rows) {
    if (hasDriverAppLoginNotes(c.notes)) continue
    if (c.is_active === false || c.is_active === 'false') continue
    if (hasCustomerAppLoginNotes(c.notes)) n += 1
  }
  appLoginCountCache = n
  appLoginCountCacheAt = Date.now()
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
  const prevShip =
    current?.shipping_address && typeof current.shipping_address === 'object' ? { ...current.shipping_address } : {}
  const addressPatch =
    typeof updates.deliveryAddress === 'string' || updates.mapsLink !== undefined
      ? (() => {
          const nextAddress =
            typeof updates.deliveryAddress === 'string'
              ? String(updates.deliveryAddress ?? '').trim()
              : String(prevBill.address || prevShip.address || '').trim()
          const nextMaps =
            updates.mapsLink !== undefined ? normalizeMapsLink(updates.mapsLink) : pickMapsLinkFromContact(current)
          return {
            billing_address: {
              ...prevBill,
              address: nextAddress,
              street2: nextMaps
            },
            shipping_address: {
              ...prevShip,
              address: nextAddress,
              street2: nextMaps
            }
          }
        })()
      : null

  const zohoPayload = {
    contact_id: contact.contact_id,
    ...(typeof updates.fullName === 'string' && updates.fullName.trim()
      ? { contact_name: updates.fullName.trim() }
      : {}),
    ...(updates.email ? { email: nextEmail } : {}),
    ...(updates.mobile !== undefined
      ? (() => {
          const raw = String(updates.mobile ?? '').trim()
          const m = normalizeIndiaMobile(raw) || raw
          const nextPersons = contactPersonsWithPrimaryPhone(current, m)
          return {
            mobile: m,
            phone: m,
            ...(nextPersons ? { contact_persons: nextPersons } : {})
          }
        })()
      : {}),
    ...(addressPatch || {})
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
 * Skipped on production unless AUTH_SEED_DEFAULT_CUSTOMER=true.
 */
export async function seedDefaultUser() {
  const isProd = env.NODE_ENV === 'production'
  if (isProd && !env.AUTH_SEED_DEFAULT_CUSTOMER) {
    log.info('seedDefaultUser skipped (production). Set AUTH_SEED_DEFAULT_CUSTOMER=true to enable.')
    return
  }

  try {
    const email = normalizeEmail(env.AUTH_DEFAULT_CUSTOMER_EMAIL)
    const listed = await findCustomerByEmail(email)
    if (listed?.contact_id) {
      const detail = await getModuleById('/contacts', listed.contact_id)
      const c = detail?.contact || detail || listed
      if (parseCustomerPasswordHashFromNotes(c?.notes)) {
        log.info('seedDefaultUser: default customer already has app login', { email })
        return
      }
      await attachCustomerCredentialOnZoho(listed.contact_id, env.AUTH_DEFAULT_CUSTOMER_PASSWORD)
      log.info('seedDefaultUser: attached app login to existing Zoho customer', { email })
      return
    }

    const contact = await ensureCustomerContact({
      fullName: 'Default Customer',
      email,
      mobile: undefined
    })
    if (!contact?.contact_id) {
      log.warn('seedDefaultUser: no Zoho contact id')
      return
    }
    const detail = await getModuleById('/contacts', contact.contact_id)
    const c = detail?.contact || detail || contact
    if (parseCustomerPasswordHashFromNotes(c?.notes)) return
    await attachCustomerCredentialOnZoho(contact.contact_id, env.AUTH_DEFAULT_CUSTOMER_PASSWORD)
    log.info('seedDefaultUser: ensured Zoho customer + app login', { email })
  } catch (err) {
    const payload = err?.response ? serializeAxiosError(err) : serializeError(err)
    log.warn('seedDefaultUser failed (non-fatal)', payload)
  }
}
