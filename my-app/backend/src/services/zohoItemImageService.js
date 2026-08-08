import { Readable } from 'node:stream'
import { env } from '../config/env.js'
import { getOrganizationId } from './zohoBooksService.js'
import { resolveZohoAccessToken } from './zohoTokenProvider.js'
import { zohoAxios } from './zohoRateLimit.js'

/** In-memory image cache so product grids don't re-hit Zoho for every thumbnail. */
const imageCache = new Map()
const IMAGE_TTL_MS = Math.max(60_000, Number(process.env.ITEM_IMAGE_CACHE_TTL_MS) || 30 * 60_000)
const IMAGE_NEG_TTL_MS = Math.max(15_000, Number(process.env.ITEM_IMAGE_NEG_CACHE_TTL_MS) || 5 * 60_000)
const IMAGE_MAX_ENTRIES = Math.max(50, Number(process.env.ITEM_IMAGE_CACHE_MAX) || 400)

function cacheGet(itemId) {
  const row = imageCache.get(String(itemId))
  if (!row) return null
  const ttl = row.ok ? IMAGE_TTL_MS : IMAGE_NEG_TTL_MS
  if (Date.now() - row.at > ttl) {
    imageCache.delete(String(itemId))
    return null
  }
  return row
}

function cacheSet(itemId, entry) {
  if (imageCache.size >= IMAGE_MAX_ENTRIES) {
    const first = imageCache.keys().next().value
    if (first != null) imageCache.delete(first)
  }
  imageCache.set(String(itemId), { ...entry, at: Date.now() })
}

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
    return zohoAxios({
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

  imageCache.delete(String(itemId))
  return { ok: true, data }
}

async function fetchItemImageBuffer(itemId) {
  const organizationId = await getOrganizationId()
  const accessToken = await resolveZohoAccessToken()
  const url = `${env.ZOHO_BOOKS_BASE_URL}/items/${encodeURIComponent(itemId)}/image`

  const zohoResponse = await zohoAxios({
    method: 'GET',
    url,
    params: { organization_id: organizationId },
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    responseType: 'arraybuffer',
    validateStatus: () => true,
    timeout: 60_000
  })

  const status = zohoResponse.status
  const contentType = zohoResponse.headers['content-type'] || 'application/octet-stream'

  if (status === 404) {
    return { ok: false, status: 404, message: 'Image not found' }
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status: 500,
      message: `Zoho image request failed with status ${status}`
    }
  }

  return {
    ok: true,
    buffer: Buffer.from(zohoResponse.data),
    contentType,
    contentLength: zohoResponse.headers['content-length']
  }
}

/**
 * Streams item image bytes (cached in memory after first successful Zoho fetch).
 */
export async function streamItemImageFromZoho(itemId) {
  const id = String(itemId || '').trim()
  if (!id) return { ok: false, status: 400, message: 'Missing item id' }

  const cached = cacheGet(id)
  if (cached) {
    if (!cached.ok) {
      return { ok: false, status: cached.status || 404, message: cached.message || 'Image not found' }
    }
    return {
      ok: true,
      stream: Readable.from(cached.buffer),
      contentType: cached.contentType,
      contentLength: String(cached.buffer.length)
    }
  }

  const fetched = await fetchItemImageBuffer(id)
  if (!fetched.ok) {
    cacheSet(id, { ok: false, status: fetched.status, message: fetched.message })
    return fetched
  }

  cacheSet(id, {
    ok: true,
    buffer: fetched.buffer,
    contentType: fetched.contentType
  })

  return {
    ok: true,
    stream: Readable.from(fetched.buffer),
    contentType: fetched.contentType,
    contentLength: String(fetched.buffer.length)
  }
}

/**
 * True if Zoho returns a successful image stream for this item (same URL as storefront/admin proxy).
 * Used to reconcile list metadata with grey placeholder thumbnails.
 */
export async function probeZohoItemImageExists(itemId) {
  if (!itemId || !String(itemId).trim()) return false
  const cached = cacheGet(String(itemId).trim())
  if (cached) return Boolean(cached.ok)

  const organizationId = await getOrganizationId()
  const accessToken = await resolveZohoAccessToken()
  const url = `${env.ZOHO_BOOKS_BASE_URL}/items/${encodeURIComponent(String(itemId).trim())}/image`

  try {
    const headRes = await zohoAxios({
      method: 'HEAD',
      url,
      params: { organization_id: organizationId },
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      validateStatus: () => true,
      timeout: 20_000
    })
    if (headRes.status >= 200 && headRes.status < 300) return true
    if (headRes.status === 404) {
      cacheSet(String(itemId).trim(), { ok: false, status: 404, message: 'Image not found' })
      return false
    }
  } catch {
    // continue to GET
  }

  const fetched = await fetchItemImageBuffer(String(itemId).trim())
  if (!fetched.ok) {
    cacheSet(String(itemId).trim(), { ok: false, status: fetched.status, message: fetched.message })
    return false
  }
  cacheSet(String(itemId).trim(), {
    ok: true,
    buffer: fetched.buffer,
    contentType: fetched.contentType
  })
  return true
}
