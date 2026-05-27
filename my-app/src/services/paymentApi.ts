import { getApiBaseCandidates, logApiCandidatesOnce } from '../config/api'
import { readAuthToken } from '../utils/authSession'

const API_BASE_URL_CANDIDATES = getApiBaseCandidates()

type CheckoutLineInput = {
  item_id?: string
  name?: string
  description?: string
  quantity: number
  rate: number
}

export type RazorpayOrderResponse = {
  key_id: string
  order_id: string
  amount: number
  currency: string
}

export type RazorpayVerifyResult = {
  message?: string
  order?: Record<string, unknown>
  payment?: Record<string, unknown>
}

async function paymentRequest<T>(path: string, body: unknown): Promise<T> {
  logApiCandidatesOnce(API_BASE_URL_CANDIDATES)
  const token = readAuthToken()
  let lastError: unknown = null

  for (const baseUrl of API_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path}`
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      const data = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string }
      if (!response.ok) {
        const msg =
          typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
            ? data.message
            : `Payment request failed (${response.status})`
        throw new Error(msg)
      }
      return data
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to reach payment API')
}

export async function createRazorpayOrder(lineItems: CheckoutLineInput[]): Promise<RazorpayOrderResponse> {
  return paymentRequest<RazorpayOrderResponse>('/api/customer/payments/razorpay/order', { line_items: lineItems })
}

export async function verifyRazorpayPayment(input: {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}): Promise<RazorpayVerifyResult> {
  return paymentRequest<RazorpayVerifyResult>('/api/customer/payments/razorpay/verify', input)
}
