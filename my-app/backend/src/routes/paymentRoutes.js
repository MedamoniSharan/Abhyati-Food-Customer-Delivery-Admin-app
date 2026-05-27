import { Router } from 'express'
import { z } from 'zod'
import { requireActiveCustomer, requireCustomer } from '../middleware/requireCustomer.js'
import {
  adjustInventoryForCheckout,
  computeLineItemsTotalInr,
  createZohoOrderAndInvoice,
  resolveCheckoutLineItems,
  resolveCustomerContactForCheckout
} from '../services/orderCheckoutService.js'
import { mapInvoiceToOrder } from '../services/orderMapping.js'
import {
  createPendingPaymentRecord,
  getPaymentRecordByRazorpayOrderId,
  updatePaymentRecord
} from '../services/paymentRecordStore.js'
import {
  createRazorpayOrder,
  getRazorpayKeyId,
  isRazorpayConfigured,
  verifyPaymentSignature
} from '../services/razorpayService.js'
import { recordInvoicePayment } from '../services/zohoPaymentService.js'
import { createLogger, serializeError } from '../util/logger.js'

const log = createLogger('payment-routes')

const lineItemSchema = z.object({
  item_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative()
})

const createPaymentOrderSchema = z.object({
  line_items: z.array(lineItemSchema).min(1),
  reference_number: z.string().optional()
})

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1)
})

export const paymentRoutes = Router()

paymentRoutes.use(requireCustomer, requireActiveCustomer)

paymentRoutes.post('/razorpay/order', async (req, res, next) => {
  try {
    if (!isRazorpayConfigured()) {
      const err = new Error('Online payment is not configured')
      err.statusCode = 503
      throw err
    }

    const body = createPaymentOrderSchema.parse(req.body)
    const customer = req.customer
    const { customerId } = await resolveCustomerContactForCheckout(customer)
    const resolvedLines = await resolveCheckoutLineItems(body.line_items, customer.email)
    const totalInr = computeLineItemsTotalInr(resolvedLines)

    if (totalInr <= 0) {
      const err = new Error('Order total must be greater than zero')
      err.statusCode = 400
      throw err
    }

    const amountPaise = Math.round(totalInr * 100)
    const receipt = `checkout_${Date.now()}`
    const razorpayOrder = await createRazorpayOrder({
      amountPaise,
      receipt,
      notes: {
        customer_email: customer.email,
        reference_number: body.reference_number || ''
      }
    })

    createPendingPaymentRecord({
      customerEmail: customer.email,
      customerId,
      razorpayOrderId: razorpayOrder.id,
      amountInr: totalInr,
      lineItems: resolvedLines,
      referenceNumber: body.reference_number
    })

    res.json({
      key_id: getRazorpayKeyId(),
      order_id: razorpayOrder.id,
      amount: amountPaise,
      currency: 'INR'
    })
  } catch (error) {
    next(error)
  }
})

paymentRoutes.post('/razorpay/verify', async (req, res, next) => {
  try {
    if (!isRazorpayConfigured()) {
      const err = new Error('Online payment is not configured')
      err.statusCode = 503
      throw err
    }

    const body = verifyPaymentSchema.parse(req.body)
    const valid = verifyPaymentSignature({
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature
    })

    if (!valid) {
      const err = new Error('Invalid payment signature')
      err.statusCode = 401
      throw err
    }

    const record = getPaymentRecordByRazorpayOrderId(body.razorpay_order_id)
    if (!record) {
      const err = new Error('Payment session not found or expired')
      err.statusCode = 404
      throw err
    }

    if (record.customerEmail !== String(req.customer.email || '').trim().toLowerCase()) {
      const err = new Error('Payment session does not belong to this customer')
      err.statusCode = 403
      throw err
    }

    if (record.status === 'paid' && record.invoiceId) {
      const order = mapInvoiceToOrder(
        {
          invoice_id: record.invoiceId,
          invoice_number: record.invoiceNumber,
          total: record.amountInr,
          date: record.paidAt?.slice(0, 10) || record.createdAt?.slice(0, 10),
          status: 'paid',
          line_items: record.lineItems
        },
        null
      )
      res.json({
        message: 'Payment already processed',
        payment: record,
        order
      })
      return
    }

    const resolvedLines = record.lineItems || []
    const { invoice, salesorder } = await createZohoOrderAndInvoice({
      customerId: record.customerId,
      resolvedLines,
      referenceNumber: record.referenceNumber || `rzp_${body.razorpay_payment_id}`
    })

    const invoiceId = String(invoice?.invoice_id || '')
    const invoiceNumber = String(invoice?.invoice_number || invoice?.reference_number || invoiceId)
    const amountInr = Number(invoice?.total) || record.amountInr

    let zohoPaymentError = null
    try {
      await recordInvoicePayment({
        customerId: record.customerId,
        invoiceId,
        amount: amountInr,
        paymentId: body.razorpay_payment_id,
        paymentMode: 'Razorpay'
      })
    } catch (err) {
      zohoPaymentError = err
      log.error('Failed to record Zoho payment after Razorpay success', serializeError(err))
    }

    const refLabel = invoiceNumber || 'app-order'
    const inventory_adjustments = await adjustInventoryForCheckout(resolvedLines, refLabel)

    const paidAt = new Date().toISOString()
    const updatedPayment = updatePaymentRecord(record.id, {
      razorpayPaymentId: body.razorpay_payment_id,
      invoiceId,
      invoiceNumber,
      amountInr,
      status: zohoPaymentError ? 'zoho_payment_failed' : 'paid',
      paidAt
    })

    const order = invoice ? mapInvoiceToOrder(invoice, null) : null

    res.status(201).json({
      message: zohoPaymentError
        ? 'Payment verified; invoice created but Zoho payment recording failed'
        : 'Payment verified and order created',
      payment: updatedPayment,
      invoice,
      salesorder,
      inventory_adjustments,
      ...(zohoPaymentError ? { zoho_payment_warning: zohoPaymentError.message } : {}),
      ...(order ? { order } : {})
    })
  } catch (error) {
    next(error)
  }
})
