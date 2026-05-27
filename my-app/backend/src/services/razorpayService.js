import crypto from 'node:crypto'
import Razorpay from 'razorpay'
import { env } from '../config/env.js'

let client = null

function getClient() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    const err = new Error('Razorpay is not configured on the server')
    err.statusCode = 503
    throw err
  }
  if (!client) {
    client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET
    })
  }
  return client
}

export function isRazorpayConfigured() {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)
}

export function getRazorpayKeyId() {
  return env.RAZORPAY_KEY_ID || ''
}

export async function createRazorpayOrder({ amountPaise, receipt, notes = {} }) {
  const rzp = getClient()
  const order = await rzp.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes
  })
  return order
}

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!env.RAZORPAY_KEY_SECRET) return false
  const body = `${orderId}|${paymentId}`
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(body).digest('hex')
  return expected === signature
}

export async function fetchPayment(paymentId) {
  const rzp = getClient()
  return rzp.payments.fetch(paymentId)
}
