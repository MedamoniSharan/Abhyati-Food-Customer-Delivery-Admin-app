import { env } from '../config/env.js'
import { createModule, listModule } from './zohoBooksService.js'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('zoho-payment')

let cachedAccountId = null

async function resolvePaymentAccountId() {
  if (env.ZOHO_PAYMENT_ACCOUNT_ID) return env.ZOHO_PAYMENT_ACCOUNT_ID
  if (cachedAccountId) return cachedAccountId

  const data = await listModule('/bankaccounts', { per_page: 50 })
  const rows = Array.isArray(data?.bankaccounts) ? data.bankaccounts : []
  const active = rows.find((a) => a.is_active !== false && a.account_id)
  if (active?.account_id) {
    cachedAccountId = String(active.account_id)
    return cachedAccountId
  }

  const err = new Error(
    'No Zoho payment account found. Set ZOHO_PAYMENT_ACCOUNT_ID in backend .env or add an active bank account in Zoho Books.'
  )
  err.statusCode = 502
  throw err
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

export async function recordInvoicePayment({ customerId, invoiceId, amount, paymentId, paymentMode = 'Razorpay' }) {
  const accountId = await resolvePaymentAccountId()
  const payload = {
    customer_id: String(customerId),
    payment_mode: paymentMode,
    amount: Number(amount),
    date: todayIsoDate(),
    account_id: accountId,
    reference_number: String(paymentId || ''),
    invoices: [
      {
        invoice_id: String(invoiceId),
        amount_applied: Number(amount)
      }
    ]
  }

  try {
    const data = await createModule('/customerpayments', payload)
    return data?.payment || data
  } catch (err) {
    log.error('Zoho customer payment failed', serializeError(err))
    throw err
  }
}
