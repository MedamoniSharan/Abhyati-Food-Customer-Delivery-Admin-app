import { useCallback, useEffect, useState } from 'react'
import {
  buildDirectionsEmbedSrc,
  buildGoogleMapsDirectionsUrl,
  buildPlaceEmbedSrc,
  getGoogleMapsApiKey,
} from '../utils/googleMapsEmbed'
import { isGoogleMapsUrl, normalizeMapsLink } from '../utils/mapsLink'

type Props = {
  /** Full address, place query, or Google Maps share URL. */
  destination: string
  /** Preferred: customer profile Maps share URL. */
  mapsLink?: string
  /** Shown when no API key or before iframe loads. */
  fallbackImageUrl?: string
  className?: string
}

export function DeliveryGoogleMap({ destination, mapsLink, fallbackImageUrl, className }: Props) {
  const apiKey = getGoogleMapsApiKey()
  const [userOrigin, setUserOrigin] = useState<string | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'loading' | 'ok' | 'denied' | 'unsupported'>('idle')

  const shareLink =
    normalizeMapsLink(mapsLink || '') ||
    (isGoogleMapsUrl(destination) ? normalizeMapsLink(destination) || destination.trim() : '')
  const placeQuery = shareLink ? '' : String(destination || '').trim()

  const refreshLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocStatus('unsupported')
      return
    }
    setLocStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserOrigin(`${pos.coords.latitude},${pos.coords.longitude}`)
        setLocStatus('ok')
      },
      () => {
        setLocStatus('denied')
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    )
  }, [])

  useEffect(() => {
    refreshLocation()
  }, [refreshLocation])

  // Short share links (maps.app.goo.gl) cannot be embedded reliably — open externally instead.
  const publicEmbedSrc =
    !shareLink && placeQuery
      ? `https://maps.google.com/maps?q=${encodeURIComponent(placeQuery)}&output=embed`
      : null
  const embedSrc =
    !shareLink && apiKey && placeQuery
      ? userOrigin
        ? buildDirectionsEmbedSrc(userOrigin, placeQuery, apiKey)
        : buildPlaceEmbedSrc(placeQuery, apiKey)
      : publicEmbedSrc

  const externalUrl = buildGoogleMapsDirectionsUrl(shareLink || placeQuery || destination, userOrigin)

  return (
    <div className={`dd-gmap-wrap ${className ?? ''}`}>
      {embedSrc ? (
        <iframe
          title="Google Map"
          className="dd-gmap-iframe"
          src={embedSrc}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <>
          {fallbackImageUrl ? <div className="dd-map-bg" style={{ backgroundImage: `url(${fallbackImageUrl})` }} /> : null}
          <div className="dd-gmap-fallback-panel">
            <p className="dd-gmap-fallback-title">Google Maps</p>
            <p className="dd-gmap-fallback-text">
              {shareLink
                ? 'Customer shared a Google Maps pin. Open it for turn-by-turn navigation.'
                : 'Open in Google Maps for turn-by-turn navigation.'}
            </p>
            {locStatus === 'denied' ? (
              <p className="dd-gmap-fallback-hint">Location denied — map shows destination only in Google Maps.</p>
            ) : null}
            <a className="dd-gmap-fallback-link" href={externalUrl} target="_blank" rel="noreferrer">
              Open in Google Maps
            </a>
          </div>
        </>
      )}
      <div className="dd-gmap-toolbar">
        <button type="button" className="dd-icon-btn dd-gmap-tool-btn" aria-label="Use my location" onClick={refreshLocation}>
          <span className="material-symbols-outlined">my_location</span>
        </button>
        {externalUrl ? (
          <a className="dd-icon-btn dd-gmap-tool-btn" href={externalUrl} target="_blank" rel="noreferrer" aria-label="Open Google Maps">
            <span className="material-symbols-outlined">open_in_new</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}
