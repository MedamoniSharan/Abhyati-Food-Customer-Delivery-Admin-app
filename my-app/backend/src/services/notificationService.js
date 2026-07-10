import { createNotification } from './notificationStore.js'

function invoiceLabel(invoiceNumber, invoiceId) {
  const n = String(invoiceNumber || invoiceId || '').trim()
  return n || 'your order'
}

export function notifyCustomerOrderPlaced({ customerEmail, invoiceId, invoiceNumber, amountInr }) {
  const label = invoiceLabel(invoiceNumber, invoiceId)
  const amount = Number(amountInr) || 0
  return createNotification({
    audience: 'customer',
    recipientEmail: customerEmail,
    type: 'order_placed',
    title: 'Order placed',
    body: amount > 0 ? `Order ${label} was placed (${amount} INR).` : `Order ${label} was placed.`,
    meta: { invoiceId: String(invoiceId || ''), invoiceNumber: String(invoiceNumber || '') }
  })
}

export function notifyCustomerDriverAssigned({
  customerEmail,
  invoiceId,
  invoiceNumber,
  driverName
}) {
  const label = invoiceLabel(invoiceNumber, invoiceId)
  const driver = String(driverName || 'a driver').trim()
  return createNotification({
    audience: 'customer',
    recipientEmail: customerEmail,
    type: 'order_assigned',
    title: 'Driver assigned',
    body: `${driver} was assigned to deliver order ${label}.`,
    meta: { invoiceId: String(invoiceId || ''), invoiceNumber: String(invoiceNumber || '') }
  })
}

export function notifyCustomerOrderShipped({ customerEmail, invoiceId, invoiceNumber, driverName }) {
  const label = invoiceLabel(invoiceNumber, invoiceId)
  const driver = String(driverName || 'Your driver').trim()
  return createNotification({
    audience: 'customer',
    recipientEmail: customerEmail,
    type: 'order_shipped',
    title: 'Out for delivery',
    body: `${driver} accepted order ${label} and is on the way.`,
    meta: { invoiceId: String(invoiceId || ''), invoiceNumber: String(invoiceNumber || '') }
  })
}

export function notifyCustomerOrderDelivered({ customerEmail, invoiceId, invoiceNumber }) {
  const label = invoiceLabel(invoiceNumber, invoiceId)
  return createNotification({
    audience: 'customer',
    recipientEmail: customerEmail,
    type: 'order_delivered',
    title: 'Delivered',
    body: `Order ${label} was delivered. View your delivery receipt in Orders.`,
    meta: { invoiceId: String(invoiceId || ''), invoiceNumber: String(invoiceNumber || '') }
  })
}

export function notifyDriverAssignment({
  driverEmail,
  assignmentId,
  invoiceId,
  invoiceNumber,
  customerName,
  address
}) {
  const label = invoiceLabel(invoiceNumber, invoiceId)
  const customer = String(customerName || 'Customer').trim()
  const addr = String(address || '').trim()
  const body = addr
    ? `Deliver order ${label} to ${customer} — ${addr}`
    : `You have a new delivery for order ${label} (${customer}).`
  return createNotification({
    audience: 'driver',
    recipientEmail: driverEmail,
    type: 'assignment_created',
    title: 'New delivery assigned',
    body,
    meta: {
      assignmentId: String(assignmentId || ''),
      invoiceId: String(invoiceId || ''),
      invoiceNumber: String(invoiceNumber || '')
    }
  })
}
