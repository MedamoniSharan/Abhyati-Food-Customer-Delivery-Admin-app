import { getCustomerUserByEmail } from '../services/authStore.js'
import { verifyCustomerToken } from '../services/jwtService.js'

const activeCustomerCache = new Map()
const ACTIVE_CUSTOMER_TTL_MS = 45_000

export function requireCustomer(req, _res, next) {
  try {
    const auth = req.headers.authorization || ''
    if (!auth.toLowerCase().startsWith('bearer ')) {
      const err = new Error('Missing bearer token')
      err.statusCode = 401
      throw err
    }
    const token = auth.slice(7).trim()
    const payload = verifyCustomerToken(token)
    req.customer = { email: payload.email }
    next()
  } catch (error) {
    next(error)
  }
}

/** After `requireCustomer`: Zoho contact must be active and have a valid customer app login. */
export async function requireActiveCustomer(req, res, next) {
  try {
    const email = req.customer?.email
    if (!email) {
      const err = new Error('Unauthorized')
      err.statusCode = 401
      return next(err)
    }
    const key = String(email).trim().toLowerCase()
    const cached = activeCustomerCache.get(key)
    if (cached && Date.now() - cached.at < ACTIVE_CUSTOMER_TTL_MS) {
      if (!cached.ok) {
        const err = new Error(cached.message || 'Account inactive or unavailable')
        err.statusCode = 401
        return next(err)
      }
      if (cached.user) {
        req.customer.fullName = cached.user.fullName || cached.user.name || req.customer.fullName
        req.customer.id = cached.user.id || cached.user.contactId || req.customer.id
      }
      return next()
    }

    const user = await getCustomerUserByEmail(email)
    if (!user) {
      activeCustomerCache.set(key, {
        at: Date.now(),
        ok: false,
        message: 'Account inactive or unavailable'
      })
      const err = new Error('Account inactive or unavailable')
      err.statusCode = 401
      return next(err)
    }
    activeCustomerCache.set(key, { at: Date.now(), ok: true, user })
    req.customer.fullName = user.fullName || user.name || req.customer.fullName
    req.customer.id = user.id || user.contactId || req.customer.id
    next()
  } catch (err) {
    next(err)
  }
}
