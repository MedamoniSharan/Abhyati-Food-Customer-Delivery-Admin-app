import { getAssignmentById, listAssignments, getAssignmentForInvoice } from './deliveryAssignmentStore.js'
import {
  fetchZohoProofPhoto,
  fetchZohoProofSignature,
  getInvoiceDocumentFile
} from './zohoDeliveryProofService.js'

export function findAssignmentByInvoiceId(invoiceId) {
  const id = String(invoiceId || '').trim()
  return listAssignments().find((row) => String(row.invoiceId) === id) || null
}

export async function findAssignmentByInvoiceIdAsync(invoiceId) {
  return getAssignmentForInvoice(invoiceId)
}

export async function resolveProofPhotoResponse(assignment) {
  const invoiceId = assignment?.invoiceId
  // Prefer the exact signed-invoice document id when Zoho stored it on the proof record.
  const docId =
    assignment?.proof?.zoho?.photo?.documents?.[0]?.document_id ||
    assignment?.proof?.zoho?.documents?.[0]?.document_id ||
    null

  if (docId && invoiceId) {
    try {
      const fromDoc = await getInvoiceDocumentFile(invoiceId, docId)
      if (fromDoc?.data?.length) {
        return {
          data: fromDoc.data,
          contentType: fromDoc.contentType || assignment?.proof?.mimeType || 'image/jpeg',
          fileName: assignment?.proof?.fileName || fromDoc.fileName || 'signed-invoice.jpg'
        }
      }
    } catch {
      /* fall through to invoice attachment */
    }
  }

  const zohoPhoto = await fetchZohoProofPhoto(invoiceId)
  if (zohoPhoto?.data?.length) {
    return {
      data: zohoPhoto.data,
      contentType: zohoPhoto.contentType || assignment?.proof?.mimeType || 'image/jpeg',
      fileName: assignment?.proof?.fileName || zohoPhoto.fileName || 'signed-invoice.jpg'
    }
  }
  if (!assignment?.proof) return null
  return null
}

export async function resolveProofSignatureResponse(assignment) {
  if (!assignment?.proof) return null
  const docId = assignment.proof.signatureDocumentId
  if (!docId) return null
  const zohoSig = await fetchZohoProofSignature(assignment.invoiceId, docId)
  if (!zohoSig) return null
  return zohoSig
}

export function buildProofSummary(assignment) {
  const proof = assignment?.proof
  if (!proof) return null
  return {
    assignmentId: assignment.id,
    invoiceId: assignment.invoiceId,
    invoiceNumber: assignment.invoiceNumber,
    recipientName: proof.recipientName || '',
    uploadedAt: proof.uploadedAt || null,
    deliveredAt: assignment.deliveredAt || null,
    fileName: proof.fileName || '',
    hasPhoto: true,
    hasSignature: Boolean(proof.signatureDocumentId),
    storedInZoho: true,
    notes: proof.notes || ''
  }
}

export function getAssignmentForProofDownload(assignmentId) {
  const row = getAssignmentById(assignmentId)
  if (row) return row
  return listAssignments().find((a) => String(a.invoiceId) === String(assignmentId)) || null
}
