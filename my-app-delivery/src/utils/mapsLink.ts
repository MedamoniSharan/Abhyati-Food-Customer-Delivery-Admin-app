/** Recognize share links customers paste from Google Maps. */
export function isGoogleMapsUrl(value: string): boolean {
  const raw = String(value || '').trim()
  if (!raw) return false
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'maps.google.com') return true
    if (host.endsWith('google.com') && (url.pathname.includes('/maps') || url.searchParams.has('q'))) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/** Normalize to https URL or empty when invalid. */
export function normalizeMapsLink(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withScheme = raw.startsWith('http') ? raw : `https://${raw}`
  return isGoogleMapsUrl(withScheme) ? withScheme : ''
}
