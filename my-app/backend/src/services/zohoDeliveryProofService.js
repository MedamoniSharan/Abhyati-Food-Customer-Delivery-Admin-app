import axios from 'axios'
import { env } from '../config/env.js'
import {
  getInvoiceAttachment,
  getModuleById,
  getOrganizationId,
  updateModule,
  uploadInvoiceAttachment
} from './zohoBooksService.js'
import { getZohoAccessToken } from './zohoAuthService.js'

function parseInvoiceDocuments(invoice) {
  const raw = invoice?.documents
  if (Array.isArray(raw)) {
    return raw
      .map((d) => ({ document_id: String(d?.document_id || d?.id || '').trim() }))
      .filter((d) => d.document_id)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed
          .map((d) => ({ document_id: String(d?.document_id || '').trim() }))
          .filter((d) => d.document_id)
      }
    } catch {
      /* ignore */
    }
  }
  return []
}

/** Upload a file to Zoho Books Documents (used for customer signature). */
export async function uploadZohoDocument({ buffer, mimetype, originalname }) {
  const organizationId = await getOrganizationId()
  const accessToken = await getZohoAccessToken()
  const form = new FormData()
  const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' })
  form.append('attachment', blob, originalname || 'document.bin')

  const response = await axios({
    method: 'post',
    url: `${env.ZOHO_BOOKS_BASE_URL}/documents`,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    params: { organization_id: organizationId },
    data: form
  })

  const body = response.data
  if (body && typeof body === 'object' && 'code' in body) {
    const codeNum = Number(body.code)
    if (Number.isFinite(codeNum) && codeNum !== 0) {
      const err = new Error(body.message || `Zoho document upload failed (code ${codeNum})`)
      err.statusCode = 400
      throw err
    }
  }

  const doc =
    body?.document ||
    (body?.documents && !Array.isArray(body.documents) ? body.documents : null) ||
    (Array.isArray(body?.documents) ? body.documents[0] : null) ||
    body
  const documentId = String(doc?.document_id || doc?.id || '').trim()
  if (!documentId) {
    const err = new Error(
      `Zoho did not return document_id after upload: ${JSON.stringify(body).slice(0, 400)}`
    )
    err.statusCode = 502
    throw err
  }
  return { documentId, document: doc, raw: body }
}

export async function attachDocumentToInvoice(invoiceId, documentId) {
  const data = await getModuleById('/invoices', invoiceId)
  const invoice = data?.invoice || data
  const docs = parseInvoiceDocuments(invoice)
  const id = String(documentId).trim()
  if (!docs.some((d) => d.document_id === id)) {
    docs.push({ document_id: id })
  }
  await updateModule('/invoices', invoiceId, { documents: docs })
}

/** Download file bytes from Zoho Books Documents (signature storage). */
export async function getZohoDocumentFile(documentId) {
  const organizationId = await getOrganizationId()
  const accessToken = await getZohoAccessToken()
  const response = await axios({
    method: 'get',
    url: `${env.ZOHO_BOOKS_BASE_URL}/documents/${encodeURIComponent(documentId)}`,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    params: { organization_id: organizationId },
    responseType: 'arraybuffer'
  })
  const contentType = String(response.headers['content-type'] || 'image/png').split(';')[0].trim()
  return {
    data: Buffer.from(response.data),
    contentType: contentType || 'image/png',
    fileName: 'delivery-signature.png'
  }
}

export async function getInvoiceDocumentFile(invoiceId, documentId) {
  return getZohoDocumentFile(documentId)
}

export async function appendInvoiceDeliveryNotes(invoiceId, addition) {
  const data = await getModuleById('/invoices', invoiceId)
  const invoice = data?.invoice || data
  const prev = String(invoice?.notes || '').trim()
  const notes = prev ? `${prev}\n\n${addition}` : addition
  await updateModule('/invoices', invoiceId, { notes })
}

export async function addInvoiceDeliveryComment(invoiceId, description) {
  const organizationId = await getOrganizationId()
  const accessToken = await getZohoAccessToken()
  const response = await axios({
    method: 'post',
    url: `${env.ZOHO_BOOKS_BASE_URL}/invoices/${encodeURIComponent(invoiceId)}/comments`,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json'
    },
    params: { organization_id: organizationId },
    data: {
      description: String(description || '').slice(0, 2000),
      show_comment_to_clients: true
    }
  })
  const body = response.data
  if (body && typeof body === 'object' && 'code' in body) {
    const codeNum = Number(body.code)
    if (Number.isFinite(codeNum) && codeNum !== 0) {
      const err = new Error(body.message || `Zoho comment failed (code ${codeNum})`)
      err.statusCode = 400
      throw err
    }
  }
  return body
}

/**
 * Store delivery proof entirely in Zoho Books:
 * - Signed invoice photo → invoice attachment (receipt)
 * - Signature → Documents + linked on invoice
 * - Recipient / delivery summary → invoice notes + comment
 */
export async function uploadFullDeliveryProofToZoho(
  invoiceId,
  { photo, signature, recipientName, notes }
) {
  const invId = String(invoiceId).trim()
  const photoUpload = await uploadInvoiceAttachment(invId, {
    buffer: photo.buffer,
    mimetype: photo.mimetype,
    originalname: photo.originalname || 'signed-invoice.jpg'
  })

  let signatureDocumentId = null
  let signatureUpload = null
  if (signature?.buffer?.length) {
    signatureUpload = await uploadZohoDocument({
      buffer: signature.buffer,
      mimetype: signature.mimetype || 'image/png',
      originalname: 'delivery-signature.png'
    })
    signatureDocumentId = signatureUpload.documentId
    await attachDocumentToInvoice(invId, signatureDocumentId)
  }

  const deliveredAt = new Date().toISOString()
  const recipient = String(recipientName || '').trim()
  const noteBlock = [
    '--- Abhyati delivery proof ---',
    recipient ? `Received by: ${recipient}` : '',
    `Delivered at: ${deliveredAt}`,
    notes ? `Driver notes: ${notes}` : '',
    'Signed invoice photo: attached to this invoice.',
    signatureDocumentId ? 'Customer signature: attached as invoice document.' : ''
  ]
    .filter(Boolean)
    .join('\n')

  await appendInvoiceDeliveryNotes(invId, noteBlock)
  if (recipient) {
    await addInvoiceDeliveryComment(
      invId,
      `Delivery completed via Abhyati driver app. Received by ${recipient}.`
    )
  }

  return {
    deliveredAt,
    photoUpload,
    signatureDocumentId,
    signatureUpload
  }
}

export async function fetchZohoProofPhoto(invoiceId) {
  try {
    const attachment = await getInvoiceAttachment(invoiceId)
    return {
      data: attachment.data,
      contentType: attachment.contentType,
      fileName: 'signed-invoice.jpg'
    }
  } catch {
    return null
  }
}

export async function fetchZohoProofSignature(invoiceId, signatureDocumentId) {
  const docId = String(signatureDocumentId || '').trim()
  if (!docId) return null
  try {
    return await getInvoiceDocumentFile(invoiceId, docId)
  } catch {
    return null
  }
}
