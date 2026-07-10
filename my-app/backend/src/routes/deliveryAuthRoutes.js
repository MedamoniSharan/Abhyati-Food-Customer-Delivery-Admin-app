import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { appendAdminAudit } from '../services/adminAuditService.js'
import { requireActiveDriver, requireDriver } from '../middleware/requireDriver.js'
import {
  getDriverPublicProfileByEmail,
  loginDriverUser,
  updateDriverRecord
} from '../services/driverStore.js'
import {
  getAssignmentById,
  updateAssignment
} from '../services/deliveryAssignmentStore.js'
import { resolveAssignmentsForDriver } from '../services/deliveryAssignmentResolve.js'
import { upsertInvoiceAssignmentNote } from '../services/zohoDeliveryAssignmentNotes.js'
import { signDriverToken } from '../services/jwtService.js'
import { uploadFullDeliveryProofToZoho } from '../services/zohoDeliveryProofService.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

const driverProfilePatchSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  mobile: z.string().max(50).optional(),
  password: z.string().min(6).max(128).optional(),
  currentPassword: z.string().min(1).max(200).optional()
})

export const deliveryAuthRoutes = Router()

const assignmentStatusSchema = z.object({
  status: z.enum(['accepted', 'in_transit', 'delivered'])
})

const allowedTransitions = {
  assigned: ['accepted'],
  accepted: ['in_transit', 'delivered'],
  in_transit: ['delivered'],
  delivered: []
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
})

deliveryAuthRoutes.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body)
    const { public: user, id } = await loginDriverUser(input)
    const token = signDriverToken(id, user.email)
    res.json({
      message: 'Login successful',
      user,
      token
    })
  } catch (error) {
    if (error.statusCode === 401) {
      appendAdminAudit({
        action: 'driver_login_failed',
        meta: { email: req.body?.email }
      })
    }
    next(error)
  }
})

deliveryAuthRoutes.use(requireDriver)

deliveryAuthRoutes.get('/assignments', async (req, res, next) => {
  try {
    const assignments = await resolveAssignmentsForDriver(req.driver.email)
    res.json({ assignments })
  } catch (error) {
    next(error)
  }
})

deliveryAuthRoutes.use(requireActiveDriver)

deliveryAuthRoutes.get('/me', async (req, res, next) => {
  try {
    const user = await getDriverPublicProfileByEmail(req.driver.email)
    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' })
    }
    res.json({ user })
  } catch (error) {
    next(error)
  }
})

deliveryAuthRoutes.patch('/profile', async (req, res, next) => {
  try {
    const body = driverProfilePatchSchema.parse(req.body)
    if (body.password) {
      if (!body.currentPassword) {
        const err = new Error('Current password is required to set a new password')
        err.statusCode = 400
        throw err
      }
      await loginDriverUser({ email: req.driver.email, password: body.currentPassword })
    }

    const updates = {}
    if (body.fullName !== undefined) updates.fullName = body.fullName
    if (body.mobile !== undefined) updates.mobile = body.mobile
    if (body.password) updates.password = body.password

    if (Object.keys(updates).length === 0) {
      const user = await getDriverPublicProfileByEmail(req.driver.email)
      if (!user) {
        return res.status(401).json({ message: 'Account no longer exists' })
      }
      const token = signDriverToken(user.id, user.email)
      return res.json({ user, token })
    }

    const user = await updateDriverRecord(req.driver.email, updates)
    if (!user) {
      const err = new Error('Account no longer exists')
      err.statusCode = 404
      throw err
    }
    const token = signDriverToken(user.id, user.email)
    res.json({ user, token })
  } catch (error) {
    next(error)
  }
})

deliveryAuthRoutes.post('/assignments/:id/accept', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = getAssignmentById(id)
    if (!row) {
      const err = new Error('Assignment not found')
      err.statusCode = 404
      throw err
    }
    if (row.driverEmail !== req.driver.email) {
      const err = new Error('Not allowed')
      err.statusCode = 403
      throw err
    }
    if (String(row.status || 'assigned').toLowerCase() !== 'assigned') {
      const err = new Error('Assignment is already accepted or completed')
      err.statusCode = 400
      throw err
    }
    const updated = updateAssignment(id, {
      status: 'accepted',
      acceptedAt: new Date().toISOString()
    })
    try {
      await upsertInvoiceAssignmentNote(updated.invoiceId, updated)
    } catch {
      /* keep local assignment even if Zoho sync fails */
    }
    res.json({ message: 'Assignment accepted', assignment: updated })
  } catch (error) {
    next(error)
  }
})

deliveryAuthRoutes.patch('/assignments/:id/status', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = getAssignmentById(id)
    if (!row) {
      const err = new Error('Assignment not found')
      err.statusCode = 404
      throw err
    }
    if (row.driverEmail !== req.driver.email) {
      const err = new Error('Not allowed')
      err.statusCode = 403
      throw err
    }
    const input = assignmentStatusSchema.parse(req.body)
    const current = String(row.status || 'assigned').toLowerCase()
    const nextStatus = String(input.status).toLowerCase()
    if (current !== nextStatus && !allowedTransitions[current]?.includes(nextStatus)) {
      const err = new Error(`Invalid status transition from ${current} to ${nextStatus}`)
      err.statusCode = 400
      throw err
    }
    const updated = updateAssignment(id, {
      status: nextStatus,
      ...(nextStatus === 'delivered' ? { deliveredAt: new Date().toISOString() } : {})
    })
    try {
      await upsertInvoiceAssignmentNote(updated.invoiceId, updated)
    } catch {
      /* keep local assignment even if Zoho sync fails */
    }
    res.json({ message: 'Status updated', assignment: updated })
  } catch (error) {
    next(error)
  }
})

const proofUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'signature', maxCount: 1 }
])

deliveryAuthRoutes.post('/assignments/:id/proof', proofUpload, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id)
    const row = getAssignmentById(id)
    if (!row) {
      const err = new Error('Assignment not found')
      err.statusCode = 404
      throw err
    }
    if (row.driverEmail !== req.driver.email) {
      const err = new Error('Not allowed')
      err.statusCode = 403
      throw err
    }
    const files = req.files
    const photo = files?.photo?.[0]
    const signature = files?.signature?.[0]
    if (!photo) {
      const err = new Error('Missing proof image')
      err.statusCode = 400
      throw err
    }
    const recipientName = typeof req.body?.recipient_name === 'string' ? req.body.recipient_name.trim() : ''
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : ''
    const zohoProof = await uploadFullDeliveryProofToZoho(row.invoiceId, {
      photo: {
        buffer: photo.buffer,
        mimetype: photo.mimetype,
        originalname: photo.originalname || 'signed-invoice.jpg'
      },
      signature: signature
        ? { buffer: signature.buffer, mimetype: signature.mimetype || 'image/png' }
        : null,
      recipientName,
      notes
    })
    const updated = updateAssignment(id, {
      status: 'delivered',
      deliveredAt: zohoProof.deliveredAt,
      proof: {
        recipientName,
        fileName: photo.originalname || 'signed-invoice.jpg',
        mimeType: photo.mimetype,
        uploadedAt: zohoProof.deliveredAt,
        notes,
        signatureDocumentId: zohoProof.signatureDocumentId,
        zoho: {
          photo: zohoProof.photoUpload,
          signatureDocumentId: zohoProof.signatureDocumentId
        }
      }
    })
    try {
      await upsertInvoiceAssignmentNote(updated.invoiceId, updated)
    } catch {
      /* keep local assignment even if Zoho sync fails */
    }
    appendAdminAudit({
      action: 'driver_uploaded_invoice_proof',
      meta: { assignmentId: id, invoiceId: row.invoiceId, driverEmail: req.driver.email }
    })
    res.json({ message: 'Proof uploaded to Zoho invoice', assignment: updated })
  } catch (error) {
    next(error)
  }
})
