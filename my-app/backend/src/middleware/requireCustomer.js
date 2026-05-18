import { getCustomerUserByEmail } from '../services/authStore.js'
import { verifyCustomerToken } from '../services/jwtService.js'

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
    const user = await getCustomerUserByEmail(email)
    if (!user) {
      const err = new Error('Account inactive or unavailable')
      err.statusCode = 401
      return next(err)
    }
    next()
  } catch (err) {
    next(err)
  }
}
