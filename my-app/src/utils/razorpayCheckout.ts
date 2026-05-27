type RazorpayPrefill = {
  name?: string
  email?: string
  contact?: string
}

type RazorpayHandlerResponse = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayCheckoutOptions = {
  key: string
  amount: number
  currency: string
  name?: string
  description?: string
  order_id: string
  prefill?: RazorpayPrefill
  theme?: { color?: string }
  handler: (response: RazorpayHandlerResponse) => void
  modal?: { ondismiss?: () => void }
}

type RazorpayInstance = {
  open: () => void
  on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance
  }
}

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'
let scriptPromise: Promise<void> | null = null

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay checkout')))
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout'))
    document.body.appendChild(script)
  })
  return scriptPromise
}

export type OpenRazorpayCheckoutInput = {
  keyId: string
  orderId: string
  amount: number
  currency: string
  user?: { fullName?: string; email?: string; mobile?: string } | null
}

export function openRazorpayCheckout(input: OpenRazorpayCheckoutInput): Promise<RazorpayHandlerResponse> {
  return loadRazorpayScript().then(
    () =>
      new Promise((resolve, reject) => {
        if (!window.Razorpay) {
          reject(new Error('Razorpay checkout is unavailable'))
          return
        }

        const rzp = new window.Razorpay({
          key: input.keyId,
          amount: input.amount,
          currency: input.currency,
          name: 'Abhyati Food',
          description: 'Order payment',
          order_id: input.orderId,
          prefill: {
            name: input.user?.fullName?.trim() || undefined,
            email: input.user?.email?.trim() || undefined,
            contact: input.user?.mobile?.trim() || undefined
          },
          theme: { color: '#c45c26' },
          handler: (response) => resolve(response),
          modal: {
            ondismiss: () => reject(new Error('Payment cancelled'))
          }
        })

        rzp.on('payment.failed', (response) => {
          reject(new Error(response.error?.description || 'Payment failed'))
        })

        rzp.open()
      })
  )
}
