/** Maps Embed API key from Vite env (optional). */
export function getGoogleMapsApiKey(): string | undefined {
  const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (typeof k !== 'string') return undefined
  const t = k.trim()
  return t.length > 0 ? t : undefined
}

export function buildPlaceEmbedSrc(destination: string, apiKey: string): string {
  const q = encodeURIComponent(destination.trim())
  return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${q}&zoom=15`
}

export function buildDirectionsEmbedSrc(originLatLng: string, destination: string, apiKey: string): string {
  const o = encodeURIComponent(originLatLng.trim())
  const d = encodeURIComponent(destination.trim())
  return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(apiKey)}&mode=driving&origin=${o}&destination=${d}`
}

/** Opens native Google Maps with optional user origin (lat,lng). No API key. */
export function buildGoogleMapsDirectionsUrl(destination: string, originLatLng?: string | null): string {
  const dest = encodeURIComponent(destination.trim())
  if (originLatLng?.trim()) {
    const o = encodeURIComponent(originLatLng.trim())
    return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${dest}`
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`
}
