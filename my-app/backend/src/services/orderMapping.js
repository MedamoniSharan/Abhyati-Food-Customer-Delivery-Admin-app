function buildOrderItemsLabel(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return 'Items'
  return lineItems
    .slice(0, 3)
    .map((line) => {
      const qty = Number(line?.quantity) || 1
      const name = line?.name || line?.description || 'Item'
      return `${qty}x ${name}`
    })
    .join(', ')
}

function mapStatus(invoiceStatus, assignmentStatus) {
  const status = String(assignmentStatus || invoiceStatus || '').toLowerCase()
  if (status.includes('deliver')) return 'Delivered'
  if (status.includes('transit') || status.includes('ship') || status.includes('sent')) return 'Shipped'
  return 'Processing'
}

export function mapInvoiceToOrder(invoice, assignment) {
  const invoiceId = String(invoice?.invoice_id || '')
  const lineItems = Array.isArray(invoice?.line_items) ? invoice.line_items : []
  const proof = assignment?.proof || null
  return {
    id: invoiceId,
    invoiceId,
    invoiceNumber: String(invoice?.invoice_number || invoice?.reference_number || invoiceId),
    date: String(invoice?.date || invoice?.invoice_date || ''),
    status: mapStatus(invoice?.status, assignment?.status),
    items: buildOrderItemsLabel(lineItems),
    amountInr: Number(invoice?.total) || 0,
    deliveredAt: assignment?.deliveredAt || null,
    proofAvailable: Boolean(proof),
    proofMeta: proof
      ? {
          fileName: proof.fileName || '',
          mimeType: proof.mimeType || '',
          uploadedAt: proof.uploadedAt || null,
          recipientName: proof.recipientName || ''
        }
      : null
  }
}

export function compareOrderDateDesc(a, b) {
  const ta = Date.parse(String(a?.date || '')) || 0
  const tb = Date.parse(String(b?.date || '')) || 0
  return tb - ta
}
