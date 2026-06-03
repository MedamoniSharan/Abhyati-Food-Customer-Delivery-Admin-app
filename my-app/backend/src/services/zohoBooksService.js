import axios from 'axios'
import { env } from '../config/env.js'
import { getZohoAccessToken } from './zohoAuthService.js'

async function request(method, path, { params, data } = {}) {
  const accessToken = await getZohoAccessToken()
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}` }

  const response = await axios({
    method,
    url: `${env.ZOHO_BOOKS_BASE_URL}${path}`,
    headers,
    params,
    data
  })

  const body = response.data
  // Zoho Books uses HTTP 2xx with a JSON `code` field: 0 = success, non-zero = error (see API "Response").
  if (body && typeof body === 'object' && 'code' in body) {
    const raw = body.code
    const codeNum = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(codeNum) && codeNum !== 0) {
      const err = new Error(body.message || `Zoho Books error (code ${codeNum})`)
      err.statusCode = 400
      throw err
    }
  }

  return body
}

export async function getOrganizations() {
  return request('get', '/organizations')
}

export async function getOrganizationId() {
  if (env.ZOHO_ORGANIZATION_ID) return env.ZOHO_ORGANIZATION_ID

  const organizations = await getOrganizations()
  const orgId = organizations?.organizations?.[0]?.organization_id

  if (!orgId) {
    throw new Error('No Zoho Books organization found. Set ZOHO_ORGANIZATION_ID in backend .env')
  }

  return orgId
}

export async function searchCustomerByEmail(email) {
  const organizationId = await getOrganizationId()
  return request('get', '/contacts', {
    params: { organization_id: organizationId, contact_name_contains: email }
  })
}

/** True if contact top-level email or any contact_person email matches (Zoho list filters use primary person). */
function contactMatchesPrimaryEmail(contact, normalized) {
  if (!contact || !normalized) return false
  if (String(contact.email || '').trim().toLowerCase() === normalized) return true
  const persons = Array.isArray(contact.contact_persons) ? contact.contact_persons : []
  return persons.some((p) => String(p?.email || '').trim().toLowerCase() === normalized)
}

export async function findContactByEmail(email, contactType) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null
  const organizationId = await getOrganizationId()
  const baseParams = { organization_id: organizationId, contact_type: contactType, per_page: 50 }

  const tryList = async (extra) => {
    const data = await request('get', '/contacts', { params: { ...baseParams, ...extra } })
    const contacts = Array.isArray(data?.contacts) ? data.contacts : []
    return contacts.find((c) => contactMatchesPrimaryEmail(c, normalized)) || null
  }

  let found = await tryList({ email: normalized })
  if (found) return found
  found = await tryList({ email_contains: normalized })
  return found
}

export async function findCustomerByEmail(email) {
  return findContactByEmail(email, 'customer')
}

/**
 * Ensure a Books contact for a driver (vendor or customer per env). Creates if missing.
 * @returns {{ contact: object, createdNew: boolean }}
 */
export async function ensureDriverContact({ fullName, email, contactType }) {
  const emailNorm = String(email || '').trim().toLowerCase()
  if (!emailNorm) {
    const err = new Error('Driver email is required for Zoho Books contact')
    err.statusCode = 400
    throw err
  }
  const existing = await findContactByEmail(emailNorm, contactType)
  if (existing?.contact_id) {
    return { contact: existing, createdNew: false }
  }

  const displayName = String(fullName || '').trim() || emailNorm
  const firstName = displayName.split(/\s+/).filter(Boolean)[0] || 'Driver'
  const payload = {
    contact_name: displayName.slice(0, 200),
    contact_type: contactType,
    email: emailNorm,
    contact_persons: [
      {
        first_name: firstName.slice(0, 100),
        email: emailNorm,
        is_primary_contact: true
      }
    ]
  }
  if (contactType === 'customer') {
    payload.customer_sub_type = 'individual'
  }

  const zoho = await createModule('/contacts', payload)
  const contact = zoho?.contact || zoho
  if (!contact?.contact_id) {
    const err = new Error('Zoho did not return a driver contact id')
    err.statusCode = 502
    throw err
  }
  return { contact, createdNew: true }
}

export async function ensureCustomerContact({ fullName, email, mobile }) {
  const existing = await findCustomerByEmail(email)
  if (existing?.contact_id) {
    return existing
  }
  try {
    const created = await createCustomer({
      contact_name: fullName || email,
      email,
      mobile
    })
    return created?.contact || null
  } catch (err) {
    /** Zoho may return 400 if contact already exists but list search did not find it. */
    const retry = await findCustomerByEmail(email)
    if (retry?.contact_id) return retry
    throw err
  }
}

export async function createCustomer({ contact_name, email, mobile }) {
  const organizationId = await getOrganizationId()
  const emailNorm = String(email || '').trim().toLowerCase()
  const name = String(contact_name || '').trim() || emailNorm
  const firstName = name.split(/\s+/).filter(Boolean)[0] || 'Customer'
  return request('post', '/contacts', {
    params: { organization_id: organizationId },
    data: {
      contact_name: name.slice(0, 200),
      contact_type: 'customer',
      customer_sub_type: 'individual',
      email: emailNorm,
      mobile: mobile != null && mobile !== '' ? String(mobile).trim() : undefined,
      contact_persons: [
        {
          first_name: firstName.slice(0, 100),
          email: emailNorm,
          is_primary_contact: true,
          ...(mobile != null && mobile !== ''
            ? { phone: String(mobile).trim(), mobile: String(mobile).trim() }
            : {})
        }
      ]
    }
  })
}

export async function createInvoice(payload) {
  const organizationId = await getOrganizationId()
  return request('post', '/invoices', {
    params: { organization_id: organizationId },
    data: payload
  })
}

export async function createSalesOrder(payload) {
  const organizationId = await getOrganizationId()
  return request('post', '/salesorders', {
    params: { organization_id: organizationId },
    data: payload
  })
}

export async function listModule(modulePath, query = {}) {
  const organizationId = await getOrganizationId()
  return request('get', modulePath, {
    params: { organization_id: organizationId, ...query }
  })
}

export async function getModuleById(modulePath, id, query = {}) {
  const organizationId = await getOrganizationId()
  return request('get', `${modulePath}/${id}`, {
    params: { organization_id: organizationId, ...query }
  })
}

/**
 * List contacts whose name or notes match search_text, then GET each by id (list payload often omits `notes`).
 * @param {{ searchText: string, contactType?: string, maxPages?: number }} opts
 * @returns {Promise<object[]>} Full contact objects (detail) matching contactType.
 */
export async function listContactsDetailBySearchText({ searchText, contactType = 'customer', maxPages = 25 }) {
  const want = String(contactType || 'customer').toLowerCase()
  const out = []
  const seen = new Set()
  const search = String(searchText || '').slice(0, 100)
  if (!search) return out

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await listModule('/contacts', { search_text: search, per_page: 200, page })
    const arr = Array.isArray(data?.contacts) ? data.contacts : []
    if (arr.length === 0) break

    for (const row of arr) {
      const id = row?.contact_id
      if (!id || seen.has(id)) continue
      const detail = await getModuleById('/contacts', id)
      const full = detail.contact || detail
      if (String(full.contact_type || '').toLowerCase() !== want) continue
      seen.add(id)
      out.push(full)
    }

    if (!data.page_context?.has_more_page) break
  }
  return out
}

export async function createModule(modulePath, payload, query = {}) {
  const organizationId = await getOrganizationId()
  return request('post', modulePath, {
    params: { organization_id: organizationId, ...query },
    data: payload
  })
}

export async function updateModule(modulePath, id, payload, query = {}) {
  const organizationId = await getOrganizationId()
  return request('put', `${modulePath}/${encodeURIComponent(id)}`, {
    params: { organization_id: organizationId, ...query },
    data: payload
  })
}

export async function deleteModule(modulePath, id, query = {}) {
  const organizationId = await getOrganizationId()
  return request('delete', `${modulePath}/${encodeURIComponent(id)}`, {
    params: { organization_id: organizationId, ...query }
  })
}

/** Zoho Books: POST /items/{id}/inactive — used when hard delete is not allowed (e.g. item on transactions). */
export async function markZohoItemInactive(itemId) {
  const organizationId = await getOrganizationId()
  return request('post', `/items/${encodeURIComponent(itemId)}/inactive`, {
    params: { organization_id: organizationId }
  })
}

export async function uploadInvoiceAttachment(invoiceId, { buffer, mimetype, originalname }) {
  const organizationId = await getOrganizationId()
  const accessToken = await getZohoAccessToken()
  const form = new FormData()
  const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' })
  form.append('attachment', blob, originalname || 'proof.jpg')

  const response = await axios({
    method: 'post',
    url: `${env.ZOHO_BOOKS_BASE_URL}/invoices/${encodeURIComponent(invoiceId)}/attachment`,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    params: { organization_id: organizationId },
    data: form
  })
  return response.data
}

export async function getInvoiceAttachment(invoiceId) {
  const organizationId = await getOrganizationId()
  const accessToken = await getZohoAccessToken()
  const response = await axios({
    method: 'get',
    url: `${env.ZOHO_BOOKS_BASE_URL}/invoices/${encodeURIComponent(invoiceId)}/attachment`,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    params: { organization_id: organizationId },
    responseType: 'arraybuffer'
  })
  return {
    data: Buffer.from(response.data),
    contentType: response.headers['content-type'] || 'application/octet-stream',
    contentDisposition: response.headers['content-disposition'] || ''
  }
}

export async function createInvoiceForOrder(orderPayload) {
  const organizationId = await getOrganizationId()
  const {
    customer_name,
    customer_email,
    customer_phone,
    invoice_number,
    reference_number,
    line_items
  } = orderPayload

  const contacts = await request('get', '/contacts', {
    params: { organization_id: organizationId, email: customer_email }
  })
  let customerId = contacts?.contacts?.[0]?.contact_id

  if (!customerId) {
    const customerResult = await createCustomer({
      contact_name: customer_name,
      email: customer_email,
      mobile: customer_phone
    })
    customerId = customerResult.contact.contact_id
  }

  return createInvoice({
    customer_id: customerId,
    currency_code: env.ZOHO_DEFAULT_CURRENCY_CODE,
    payment_terms_label: env.ZOHO_DEFAULT_PAYMENT_TERMS,
    invoice_number,
    reference_number,
    line_items
  })
}


function userLooksLikeSalesperson(u) {
  const role = String(u?.user_role || '').toLowerCase()
  if (role.includes('sales')) return true
  const roles = Array.isArray(u?.roles) ? u.roles : []
  return roles.some((r) => String(r?.role_name || '').toLowerCase().includes('sales'))
}

/**
 * Zoho Books orgs with mandatory salesperson: use ZOHO_DEFAULT_SALESPERSON_ID or first active user
 * whose role looks like sales (Zoho rejects other users with code 4050).
 * @returns {Promise<{ salesperson_id: string, salesperson_name?: string } | null>}
 */
export async function resolveDefaultSalespersonFieldsForTransactions() {
  const fromEnv = env.ZOHO_DEFAULT_SALESPERSON_ID?.trim()
  if (fromEnv) {
    const name = env.ZOHO_DEFAULT_SALESPERSON_NAME?.trim()
    return name ? { salesperson_id: fromEnv, salesperson_name: name } : { salesperson_id: fromEnv }
  }
  try {
    const recent = await listModule('/salesorders', { per_page: 30, sort_column: 'date', sort_order: 'D' })
    const orders = Array.isArray(recent?.salesorders) ? recent.salesorders : []
    for (const o of orders) {
      const id = String(o?.salesperson_id || '').trim()
      if (!id) continue
      const name = String(o?.salesperson_name || '').trim()
      return name ? { salesperson_id: id, salesperson_name: name } : { salesperson_id: id }
    }
    const invRecent = await listModule('/invoices', { per_page: 30, sort_column: 'date', sort_order: 'D' })
    const invs = Array.isArray(invRecent?.invoices) ? invRecent.invoices : []
    for (const o of invs) {
      const id = String(o?.salesperson_id || '').trim()
      if (!id) continue
      const name = String(o?.salesperson_name || '').trim()
      return name ? { salesperson_id: id, salesperson_name: name } : { salesperson_id: id }
    }
  } catch {
    /* non-fatal */
  }
  try {
    const data = await listModule('/users', { per_page: 200 })
    const users = Array.isArray(data?.users) ? data.users : []
    const active = users.filter((u) => {
      if (!u || u.user_id == null) return false
      const st = String(u.status || '').toLowerCase()
      return st !== 'deleted' && st !== 'inactive'
    })
    const salesUser = active.find((u) => userLooksLikeSalesperson(u))
    if (salesUser?.user_id != null) {
      const id = String(salesUser.user_id).trim()
      if (!id) return null
      const name = String(salesUser.name || salesUser.email || '').trim()
      return name ? { salesperson_id: id, salesperson_name: name } : { salesperson_id: id }
    }
  } catch {
    /* non-fatal */
  }
  return null
}
