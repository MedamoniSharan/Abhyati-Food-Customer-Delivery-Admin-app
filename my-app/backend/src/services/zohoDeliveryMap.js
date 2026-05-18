export function mapDeliveryStopFromSalesOrder(order, index) {
  const shipping = order.shipping_address || {}
  const billing = order.billing_address || {}
  const cityStateZip = [shipping.city, shipping.state, shipping.zip].filter(Boolean).join(', ')
  const addressLine1 = shipping.address || billing.address || 'Address unavailable'
  const addressLine2 = cityStateZip || shipping.country || billing.country || ''
  const mapsQuery = [addressLine1, addressLine2].filter(Boolean).join(', ')
  const contactName = shipping.attention || order.customer_name || 'Customer'
  const amount = Number(order.total) || 0
  const lineItems = Array.isArray(order.line_items) ? order.line_items : []
  const status = (order.status || '').toLowerCase()
  const isNext = index === 0

  return {
    id: order.salesorder_id,
    salesorder_id: order.salesorder_id,
    deliveryNumber: order.salesorder_number || order.reference_number || order.salesorder_id,
    businessName: order.customer_name || 'Customer',
    orderId: `Order #${order.salesorder_number || order.salesorder_id}`,
    amount,
    paymentLabel: order.payment_terms_label || 'Credit',
    statusTag: status.includes('deliver') ? 'Delivered' : isNext ? 'Next Stop' : 'Scheduled',
    timeLabel: order.date || 'Today',
    isNext,
    address: [addressLine1, addressLine2].filter(Boolean).join(', '),
    contactName,
    contactRole: 'Receiving',
    initials: contactName
      .split(' ')
      .map((part) => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
    customerName: order.customer_name || 'Customer',
    verified: true,
    addressLine1,
    addressLine2,
    mapsQuery,
    phone: shipping.phone || billing.phone || '',
    contactLine: `Main Contact: ${contactName}`,
    arrivalWindow: order.date || 'Today',
    driverNote: order.notes || order.terms || 'Handle package with care.',
    podOrderLabel: `Order #${order.salesorder_number || order.salesorder_id}`,
    podSubtitle: `${order.customer_name || 'Customer'} • ${lineItems.length} Items`,
    items: lineItems.map((item) => ({
      name: item.name || 'Item',
      sku: item.sku || item.item_id || '',
      qty: Number(item.quantity) || 1,
      unit: item.unit || 'unit',
      image: ''
    }))
  }
}
