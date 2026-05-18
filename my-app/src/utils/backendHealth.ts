import { getApiBaseCandidates } from '../config/apiBase'

/** True if any configured base responds to GET /health with a 2xx status. */
export async function checkBackendReachable(): Promise<boolean> {
  const bases = getApiBaseCandidates()
  for (const base of bases) {
    const origin = base.replace(/\/$/, '')
    try {
      const response = await fetch(`${origin}/health`, { method: 'GET' })
      if (response.ok) return true
    } catch {
      /* try next base */
    }
  }
  return false
}
