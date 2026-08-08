import { parseDriverPasswordHashFromNotes } from '../services/zohoAppCredentialNotes.js'
import { getModuleById } from '../services/zohoBooksService.js'
import { verifyDriverToken } from '../services/jwtService.js'

const activeDriverCache = new Map()
const ACTIVE_DRIVER_TTL_MS = 45_000

export function requireDriver(req, _res, next) {
  try {
    const auth = req.headers.authorization || ''
    if (!auth.toLowerCase().startsWith('bearer ')) {
      const err = new Error('Missing bearer token')
      err.statusCode = 401
      throw err
    }
    const token = auth.slice(7)
    const payload = verifyDriverToken(token)
    const email = String(payload.email || '')
      .trim()
      .toLowerCase()
    req.driver = { id: String(payload.sub || email).trim(), email }
    next()
  } catch (error) {
    next(error)
  }
}

/** After `requireDriver`: Zoho driver contact must still exist, be active, and match the JWT email. */
export async function requireActiveDriver(req, res, next) {
  try {
    const id = String(req.driver?.id ?? '').trim()
    const email = String(req.driver?.email ?? '').trim().toLowerCase()
    if (!id || !email) {
      const err = new Error('Unauthorized')
      err.statusCode = 401
      return next(err)
    }

    const cacheKey = `${id}|${email}`
    const cached = activeDriverCache.get(cacheKey)
    if (cached && Date.now() - cached.at < ACTIVE_DRIVER_TTL_MS) {
      if (!cached.ok) {
        const err = new Error(cached.message || 'Unauthorized')
        err.statusCode = cached.statusCode || 401
        return next(err)
      }
      return next()
    }

    const data = await getModuleById('/contacts', id)
    const c = data?.contact || data
    if (!c?.contact_id || parseDriverPasswordHashFromNotes(c.notes) == null) {
      activeDriverCache.set(cacheKey, { at: Date.now(), ok: false, statusCode: 401, message: 'Account no longer exists' })
      const err = new Error('Account no longer exists')
      err.statusCode = 401
      return next(err)
    }
    if (c.is_active === false || c.is_active === 'false') {
      activeDriverCache.set(cacheKey, { at: Date.now(), ok: false, statusCode: 401, message: 'Account inactive' })
      const err = new Error('Account inactive')
      err.statusCode = 401
      return next(err)
    }
    const contactEmail = String(c.email || '').trim().toLowerCase()
    if (contactEmail && contactEmail !== email) {
      activeDriverCache.set(cacheKey, { at: Date.now(), ok: false, statusCode: 401, message: 'Invalid session' })
      const err = new Error('Invalid session')
      err.statusCode = 401
      return next(err)
    }
    activeDriverCache.set(cacheKey, { at: Date.now(), ok: true })
    next()
  } catch (err) {
    next(err)
  }
}
