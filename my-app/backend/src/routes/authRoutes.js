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
import { isGoogleMapsUrl } from '../util/customerMapsLink.js'
import { isTenDigitIndiaMobileInput, normalizeIndiaMobile } from '../util/indiaMobile.js'
import {
  isMsg91Configured,
  resendOtp,
  sendOtp,
  verifyOtp
} from '../services/msg91OtpService.js'
import { appendAuditEvent, maskEmail } from '../services/adminAuditService.js'

const mapsLinkField = z
  .string()
  .max(500)
  .optional()
  .refine((v) => !v || !String(v).trim() || isGoogleMapsUrl(String(v).trim()), {
    message: 'Enter a valid Google Maps link (for example maps.app.goo.gl or google.com/maps/...)'
  })

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Invalid password')
})

const TEN_DIGIT_MOBILE_MSG = 'Enter a 10-digit mobile number (without +91)'

/** Signup / OTP: user must send plain 10 digits only (no +91 / 91 prefix). */
const mobileSchema = z
  .string()
  .trim()
  .min(1, 'Mobile number is required')
  .refine((v) => isTenDigitIndiaMobileInput(v), {
    message: TEN_DIGIT_MOBILE_MSG
  })

const otpSendSchema = z.object({
  mobile: mobileSchema
})

const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  mobile: mobileSchema,
  otp: z
    .string()
    .trim()
    .regex(/^\d{4,9}$/, 'Enter the OTP sent to your mobile'),
  deliveryAddress: z.string().max(2000).optional(),
  mapsLink: mapsLinkField
})

const profilePatchSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(200).optional(),
  mobile: z
    .string()
    .trim()
    .optional()
    .refine((v) => v === undefined || v === '' || isTenDigitIndiaMobileInput(v), {
      message: TEN_DIGIT_MOBILE_MSG
    }),
  email: z.string().email().max(254).optional(),
  password: z.string().min(6).max(128).optional(),
  currentPassword: z.string().min(1).max(200).optional(),
  deliveryAddress: z.string().max(2000).optional(),
  mapsLink: mapsLinkField
})

function normEmail(e) {
  return String(e || '')
    .trim()
    .toLowerCase()
}

export const authRoutes = Router()

authRoutes.post('/otp/send', async (req, res, next) => {
  try {
    if (!isMsg91Configured()) {
      const err = new Error('Phone verification is not configured. Contact support.')
      err.statusCode = 503
      throw err
    }
    const { mobile } = otpSendSchema.parse(req.body)
    const result = await sendOtp(mobile)
    appendAuditEvent({
      action: 'otp.send',
      outcome: 'ok',
      stage: 'msg91_queued',
      actorType: 'anonymous',
      req,
      meta: {
        mobile: result.mobile,
        msg91RequestId: result.requestId || null,
        note: 'MSG91 accepted request — not proof of SMS delivery. Check MSG91 Logs with msg91RequestId.'
      }
    })
    res.json({
      message: 'OTP sent successfully',
      mobile: result.mobile,
      // MSG91 request id — use this in MSG91 → Reports to see if SMS was delivered or DLT-failed.
      requestId: result.requestId || undefined
    })
  } catch (error) {
    next(error)
  }
})

authRoutes.post('/otp/resend', async (req, res, next) => {
  try {
    if (!isMsg91Configured()) {
      const err = new Error('Phone verification is not configured. Contact support.')
      err.statusCode = 503
      throw err
    }
    const { mobile } = otpSendSchema.parse(req.body)
    const result = await resendOtp(mobile)
    const normalized = result?.mobile || normalizeIndiaMobile(mobile)
    appendAuditEvent({
      action: 'otp.resend',
      outcome: 'ok',
      stage: 'msg91_queued',
      actorType: 'anonymous',
      req,
      meta: {
        mobile: normalized,
        msg91RequestId: result?.requestId || null
      }
    })
    res.json({
      message: 'OTP resent successfully',
      mobile: normalized,
      requestId: result?.requestId || undefined
    })
  } catch (error) {
    next(error)
  }
})

authRoutes.post('/signup', async (req, res, next) => {
  try {
    if (!isMsg91Configured()) {
      const err = new Error('Phone verification is not configured. Contact support.')
      err.statusCode = 503
      throw err
    }
    const input = signupSchema.parse(req.body)
    appendAuditEvent({
      action: 'customer.signup',
      outcome: 'ok',
      stage: 'otp_verify_start',
      actor: maskEmail(input.email),
      actorType: 'anonymous',
      req,
      meta: { email: input.email, mobile: input.mobile }
    })
    await verifyOtp(input.mobile, input.otp)
    appendAuditEvent({
      action: 'otp.verify',
      outcome: 'ok',
      stage: 'otp_verified',
      actor: maskEmail(input.email),
      actorType: 'anonymous',
      req,
      meta: { mobile: input.mobile }
    })
    const { otp: _otp, ...rest } = input
    const signupInput = {
      ...rest,
      mobile: normalizeIndiaMobile(input.mobile) || rest.mobile
    }
    const { user } = await signupCustomerUser(signupInput)
    const token = signCustomerToken(user.email)
    appendAuditEvent({
      action: 'customer.signup',
      outcome: 'ok',
      stage: 'account_created',
      actor: maskEmail(user.email),
      actorType: 'customer',
      req,
      meta: {
        email: user.email,
        mobile: user.mobile,
        userId: user.id
      }
    })
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
    appendAuditEvent({
      action: 'customer.login',
      outcome: 'ok',
      stage: 'session_issued',
      actor: maskEmail(user.email),
      actorType: 'customer',
      req,
      meta: { email: user.email, userId: user.id }
    })
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
    if (body.mobile !== undefined) {
      updates.mobile = body.mobile.trim() ? normalizeIndiaMobile(body.mobile) || body.mobile.trim() : ''
    }
    if (body.email !== undefined) updates.email = body.email
    if (body.password) updates.password = body.password
    if (body.deliveryAddress !== undefined) updates.deliveryAddress = body.deliveryAddress
    if (body.mapsLink !== undefined) updates.mapsLink = body.mapsLink

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
    appendAuditEvent({
      action: 'customer.profile.update',
      outcome: 'ok',
      stage: 'saved',
      actor: maskEmail(user.email),
      actorType: 'customer',
      req,
      meta: {
        email: user.email,
        fields: Object.keys(updates).filter((k) => k !== 'password')
      }
    })
    res.json({ user, token: signCustomerToken(user.email) })
  } catch (error) {
    next(error)
  }
})
