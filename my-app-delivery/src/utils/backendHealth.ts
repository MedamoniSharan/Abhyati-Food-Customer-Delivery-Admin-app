import { getApiBaseCandidates } from '../config/apiBase'

const HEALTH_TIMEOUT_MS = 10_000
const RETRY_DELAYS_MS = [0, 2000, 4000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function fetchHealthOnce(origin: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch(`${origin}/health`, { method: 'GET', signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

export async function checkBackendReachable(): Promise<boolean> {
  const bases = getApiBaseCandidates()
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay)
    for (const base of bases) {
      const origin = base.replace(/\/$/, '')
      if (await fetchHealthOnce(origin)) return true
    }
  }
  return false
}
