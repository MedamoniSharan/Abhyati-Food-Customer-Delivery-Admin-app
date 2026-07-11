import axios from 'axios'

const MAX_CONCURRENT = Math.max(1, Number(process.env.ZOHO_MAX_CONCURRENT_REQUESTS) || 4)
const MAX_RETRIES = Math.max(0, Number(process.env.ZOHO_RATE_LIMIT_MAX_RETRIES) || 6)
const BASE_DELAY_MS = Math.max(200, Number(process.env.ZOHO_RATE_LIMIT_BASE_DELAY_MS) || 1000)

let active = 0
/** @type {Array<() => void>} */
const waitQueue = []

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireSlot() {
  if (active < MAX_CONCURRENT) {
    active += 1
    return
  }
  await new Promise((resolve) => {
    waitQueue.push(resolve)
  })
  active += 1
}

function releaseSlot() {
  active = Math.max(0, active - 1)
  const next = waitQueue.shift()
  if (next) next()
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isZohoRateLimitError(err) {
  if (!err) return false
  if (axios.isAxiosError(err) && err.response?.status === 429) return true

  const body = axios.isAxiosError(err) ? err.response?.data : null
  const parts = []
  if (typeof body === 'object' && body != null) {
    for (const key of ['message', 'error_description', 'error']) {
      const v = body[key]
      if (typeof v === 'string' && v.trim()) parts.push(v)
    }
  }
  if (err instanceof Error && err.message) parts.push(err.message)

  const text = parts.join(' ').toLowerCase()
  return (
    /too many requests/.test(text) ||
    /rate limit/.test(text) ||
    /throttl/.test(text) ||
    /requests continuously/.test(text)
  )
}

/**
 * Limit how many Zoho HTTP calls run at once (reduces 429 bursts).
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withZohoThrottle(fn) {
  await acquireSlot()
  try {
    return await fn()
  } finally {
    releaseSlot()
  }
}

/**
 * Retry Zoho calls when the upstream returns a rate-limit response.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxRetries?: number, baseDelayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withZohoRetry(fn, { maxRetries = MAX_RETRIES, baseDelayMs = BASE_DELAY_MS } = {}) {
  let attempt = 0
  while (true) {
    try {
      return await withZohoThrottle(fn)
    } catch (err) {
      if (!isZohoRateLimitError(err) || attempt >= maxRetries) throw err
      const delay = baseDelayMs * 2 ** attempt
      await sleep(delay)
      attempt += 1
    }
  }
}

/**
 * axios wrapper with Zoho throttle + rate-limit retry.
 * @param {import('axios').AxiosRequestConfig} config
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export function zohoAxios(config) {
  return withZohoRetry(async () => {
    const response = await axios(config)
    if (response.status === 429 || isZohoRateLimitResponse(response)) {
      const err = new axios.AxiosError(
        `Zoho rate limited (${response.status})`,
        axios.AxiosError.ERR_BAD_REQUEST,
        config,
        response.request,
        response
      )
      throw err
    }
    return response
  })
}

/**
 * @param {import('axios').AxiosResponse} response
 * @returns {boolean}
 */
function isZohoRateLimitResponse(response) {
  const body = response?.data
  const parts = []
  if (typeof body === 'object' && body != null) {
    for (const key of ['message', 'error_description', 'error']) {
      const v = body[key]
      if (typeof v === 'string' && v.trim()) parts.push(v)
    }
  }
  const text = parts.join(' ').toLowerCase()
  return (
    /too many requests/.test(text) ||
    /rate limit/.test(text) ||
    /throttl/.test(text) ||
    /requests continuously/.test(text)
  )
}
