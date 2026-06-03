import { getAssignmentById, listAssignments } from './deliveryAssignmentStore.js'
import {
  fetchZohoProofPhoto,
  fetchZohoProofSignature
} from './zohoDeliveryProofService.js'

export function findAssignmentByInvoiceId(invoiceId) {
  const id = String(invoiceId || '').trim()
  return listAssignments().find((row) => String(row.invoiceId) === id) || null
}

export async function resolveProofPhotoResponse(assignment) {
  if (!assignment?.proof) return null
  const zohoPhoto = await fetchZohoProofPhoto(assignment.invoiceId)
  if (!zohoPhoto) return null
  return {
    data: zohoPhoto.data,
    contentType: zohoPhoto.contentType,
    fileName: assignment.proof.fileName || zohoPhoto.fileName
  }
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
  if (!row?.proof) return null
  return row
}
