import { Router } from 'express'
import { z } from 'zod'
import { requireActiveCustomer, requireCustomer } from '../middleware/requireCustomer.js'
import {
  getCustomerContactForApp,
  getCustomerUserByEmail,
  loginCustomerUser,
  signupCustomerUser,
  updateCustomerUserByEmail
} from '../services/authStore.js'
import { signCustomerToken, verifyCustomerToken } from '../services/jwtService.js'
import { getActiveTierForContact, isCustomerPricingConfigured } from '../services/customerPricingZohoService.js'

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required')
})

const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  mobile: z
    .string()
    .trim()
    .min(8, 'Mobile number is required')
    .max(50, 'Mobile number is too long')
    .refine((v) => /\d/.test(v), { message: 'Enter a valid mobile number' }),
  deliveryAddress: z.string().max(2000).optional()
})

const profilePatchSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  mobile: z.string().max(50).optional(),
  email: z.string().email().max(254).optional(),
  password: z.string().min(6).max(128).optional(),
  currentPassword: z.string().min(1).max(200).optional(),
  deliveryAddress: z.string().max(2000).optional()
})

function normEmail(e) {
  return String(e || '')
    .trim()
    .toLowerCase()
}

export const authRoutes = Router()

authRoutes.post('/signup', async (req, res, next) => {
  try {
    const input = signupSchema.parse(req.body)
    const { user } = await signupCustomerUser(input)
    const token = signCustomerToken(user.email)
    res.status(201).json({
      message: 'Account created successfully',
      user,
      token
    })
  } catch (error) {
    next(error)
  }
})

authRoutes.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body)
    const user = await loginCustomerUser(input)
    const token = signCustomerToken(user.email)
    res.json({
      message: 'Login successful',
      user,
      token
    })
  } catch (error) {
    next(error)
  }
})

authRoutes.get('/me', async (req, res, next) => {
  try {
    const header = req.headers.authorization || ''
    const m = header.match(/^Bearer\s+(.+)$/i)
    if (!m) {
      return res.status(401).json({ message: 'Missing Authorization Bearer token' })
    }
    const payload = verifyCustomerToken(m[1].trim())
    const user = await getCustomerUserByEmail(payload.email)
    if (!user) {
      return res.status(401).json({ message: 'Account inactive or unavailable' })
    }
    let pricingTier = null
    if (isCustomerPricingConfigured()) {
      const contact = await getCustomerContactForApp(payload.email)
      if (contact) {
        const tier = await getActiveTierForContact(contact)
        if (tier) pricingTier = { id: tier.id, name: tier.name }
      }
    }
    res.json({ user, pricingTier })
  } catch (error) {
    next(error)
  }
})

authRoutes.patch('/profile', requireCustomer, requireActiveCustomer, async (req, res, next) => {
  try {
    const body = profilePatchSchema.parse(req.body)
    const tokenEmail = normEmail(req.customer.email)
    const wantsEmailChange = body.email != null && normEmail(body.email) !== tokenEmail
    const wantsPasswordChange = Boolean(body.password?.length)
    if (wantsEmailChange || wantsPasswordChange) {
      if (!body.currentPassword) {
        const err = new Error('Current password is required to change email or password')
        err.statusCode = 400
        throw err
      }
      await loginCustomerUser({ email: tokenEmail, password: body.currentPassword })
    }

    const updates = {}
    if (body.fullName !== undefined) updates.fullName = body.fullName
    if (body.mobile !== undefined) updates.mobile = body.mobile
    if (body.email !== undefined) updates.email = body.email
    if (body.password) updates.password = body.password
    if (body.deliveryAddress !== undefined) updates.deliveryAddress = body.deliveryAddress

    if (Object.keys(updates).length === 0) {
      const user = await getCustomerUserByEmail(tokenEmail)
      if (!user) {
        const err = new Error('Account no longer exists')
        err.statusCode = 401
        throw err
      }
      return res.json({ user, token: signCustomerToken(user.email) })
    }

    const user = await updateCustomerUserByEmail(tokenEmail, updates)
    if (!user) {
      const err = new Error('Account no longer exists')
      err.statusCode = 404
      throw err
    }
    res.json({ user, token: signCustomerToken(user.email) })
  } catch (error) {
    next(error)
  }
})
