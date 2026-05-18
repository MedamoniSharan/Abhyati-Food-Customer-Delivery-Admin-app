import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

const ISS = 'abhyati-food-api'

export function signAdminToken() {
  return jwt.sign({ role: 'admin', typ: 'admin' }, env.JWT_SECRET, {
    issuer: ISS,
    subject: env.ADMIN_EMAIL,
    expiresIn: '12h'
  })
}

export function verifyAdminToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISS })
  if (payload.role !== 'admin' || payload.typ !== 'admin') {
    const err = new Error('Invalid token')
    err.statusCode = 401
    throw err
  }
  return payload
}

export function signCustomerToken(email) {
  return jwt.sign({ role: 'customer', typ: 'customer', email }, env.JWT_SECRET, {
    issuer: ISS,
    subject: email,
    expiresIn: '30d'
  })
}

export function verifyCustomerToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISS })
  if (payload.role !== 'customer' || payload.typ !== 'customer' || !payload.email) {
    const err = new Error('Invalid token')
    err.statusCode = 401
    throw err
  }
  return payload
}

/** `subject` becomes JWT `sub` and overwrites any payload `sub` — must be Zoho contact id for driver routes. */
export function signDriverToken(driverId, email) {
  const id = String(driverId ?? '').trim()
  return jwt.sign({ role: 'driver', typ: 'driver', email }, env.JWT_SECRET, {
    issuer: ISS,
    subject: id,
    expiresIn: '7d'
  })
}

export function verifyDriverToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISS })
  if (payload.role !== 'driver' || payload.typ !== 'driver') {
    const err = new Error('Invalid token')
    err.statusCode = 401
    throw err
  }
  return payload
}
