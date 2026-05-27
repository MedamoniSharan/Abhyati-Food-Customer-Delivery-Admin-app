/**
 * Unit smoke for Razorpay signature verification (no live API calls).
 * From my-app/backend: node scripts/smoke-razorpay-verify.mjs
 */
import crypto from 'node:crypto'
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

function verifyPaymentSignature({ orderId, paymentId, signature, secret }) {
  const body = `${orderId}|${paymentId}`
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return expected === signature
}

const secret = process.env.RAZORPAY_KEY_SECRET || 'test_secret'
const orderId = 'order_test123'
const paymentId = 'pay_test456'
const validSig = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')

if (!verifyPaymentSignature({ orderId, paymentId, signature: validSig, secret })) {
  console.error('FAIL: valid signature rejected')
  process.exit(1)
}

if (verifyPaymentSignature({ orderId, paymentId, signature: 'bad', secret })) {
  console.error('FAIL: invalid signature accepted')
  process.exit(1)
}

console.log('OK: Razorpay signature verification smoke passed')
