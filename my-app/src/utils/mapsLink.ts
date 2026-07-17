export function isGoogleMapsUrl(value: string): boolean {
  const raw = String(value || '').trim()
  if (!raw) return false
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'maps.app.goo.gl' || host === 'goo.gl') return true
    if (host.endsWith('google.com') && url.pathname.includes('/maps')) return true
    return false
  } catch {
    return false
  }
}

export function normalizeMapsLink(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withScheme = raw.startsWith('http') ? raw : `https://${raw}`
  return isGoogleMapsUrl(withScheme) ? withScheme : ''
}
