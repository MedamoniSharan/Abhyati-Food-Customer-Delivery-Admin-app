import axios from 'axios'
import { env } from '../config/env.js'
import { getOrganizationId } from './zohoBooksService.js'
import { resolveZohoAccessToken } from './zohoTokenProvider.js'

/**
 * POST multipart image to Zoho Books for an item (same catalog as GET …/image).
 * Tries /image then /images because Zoho orgs/docs vary slightly on the path.
 */
export async function uploadItemImageToZoho(itemId, { buffer, mimetype, originalname }) {
  const organizationId = await getOrganizationId()
  const accessToken = await resolveZohoAccessToken()
  const base = `${env.ZOHO_BOOKS_BASE_URL}/items/${encodeURIComponent(itemId)}`

  const buildForm = () => {
    const form = new FormData()
    const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' })
    form.append('image', blob, originalname || 'product.jpg')
    return form
  }

  const post = async (pathSuffix) => {
    const url = `${base}${pathSuffix}`
    return axios({
      method: 'POST',
      url,
      params: { organization_id: organizationId },
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      data: buildForm(),
      maxBodyLength: 12 * 1024 * 1024,
      maxContentLength: 12 * 1024 * 1024,
      validateStatus: () => true,
      timeout: 120_000
    })
  }

  let zohoResponse = await post('/image')
  if (zohoResponse.status === 404 || zohoResponse.status === 405) {
    zohoResponse = await post('/images')
  }

  const status = zohoResponse.status
  const data = zohoResponse.data

  if (status < 200 || status >= 300) {
    const msg =
      typeof data === 'object' && data && typeof data.message === 'string'
        ? data.message
        : `Zoho image upload failed (${status})`
    const err = new Error(msg)
    err.statusCode = status >= 400 && status < 600 ? status : 502
    err.zohoBody = data
    throw err
  }

  if (data && typeof data === 'object' && 'code' in data && Number(data.code) !== 0) {
    const err = new Error(typeof data.message === 'string' ? data.message : 'Zoho rejected image upload')
    err.statusCode = 400
    err.zohoBody = data
    throw err
  }

  return { ok: true, data }
}

/**
 * Streams item image bytes from Zoho Books (no local persistence).
 * GET {ZOHO_BOOKS_BASE_URL}/items/{item_id}/image?organization_id=...
 */
export async function streamItemImageFromZoho(itemId) {
  const organizationId = await getOrganizationId()
  const accessToken = await resolveZohoAccessToken()

  const url = `${env.ZOHO_BOOKS_BASE_URL}/items/${encodeURIComponent(itemId)}/image`

  const zohoResponse = await axios({
    method: 'GET',
    url,
    params: { organization_id: organizationId },
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    responseType: 'stream',
    validateStatus: () => true,
    timeout: 60_000
  })

  const status = zohoResponse.status
  const contentType = zohoResponse.headers['content-type'] || 'application/octet-stream'

  if (status === 404) {
    return { ok: false, status: 404, message: 'Image not found' }
  }

  if (status < 200 || status >= 300) {
    if (zohoResponse.data && typeof zohoResponse.data.destroy === 'function') {
      zohoResponse.data.destroy()
    }
    return {
      ok: false,
      status: 500,
      message: `Zoho image request failed with status ${status}`
    }
  }

  return {
    ok: true,
    stream: zohoResponse.data,
    contentType,
    contentLength: zohoResponse.headers['content-length']
  }
}

/**
 * True if Zoho returns a successful image stream for this item (same URL as storefront/admin proxy).
 * Used to reconcile list metadata with grey placeholder thumbnails.
 */
export async function probeZohoItemImageExists(itemId) {
  if (!itemId || !String(itemId).trim()) return false
  const organizationId = await getOrganizationId()
  const accessToken = await resolveZohoAccessToken()
  const url = `${env.ZOHO_BOOKS_BASE_URL}/items/${encodeURIComponent(String(itemId).trim())}/image`

  try {
    const headRes = await axios({
      method: 'HEAD',
      url,
      params: { organization_id: organizationId },
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      validateStatus: () => true,
      timeout: 20_000
    })
    if (headRes.status >= 200 && headRes.status < 300) return true
    if (headRes.status === 404) return false
  } catch {
    // continue to GET
  }

  const zohoResponse = await axios({
    method: 'GET',
    url,
    params: { organization_id: organizationId },
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    responseType: 'stream',
    validateStatus: () => true,
    timeout: 45_000
  })

  const status = zohoResponse.status
  if (zohoResponse.data && typeof zohoResponse.data.destroy === 'function') {
    zohoResponse.data.destroy()
  }

  if (status === 404) return false
  return status >= 200 && status < 300
}
