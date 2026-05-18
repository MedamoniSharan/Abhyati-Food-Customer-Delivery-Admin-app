import { useCallback, useEffect, useState } from 'react'
import {
  buildDirectionsEmbedSrc,
  buildGoogleMapsDirectionsUrl,
  buildPlaceEmbedSrc,
  getGoogleMapsApiKey,
} from '../utils/googleMapsEmbed'

type Props = {
  /** Full address or place query for the stop / destination. */
  destination: string
  /** Shown when no API key or before iframe loads. */
  fallbackImageUrl?: string
  className?: string
}

export function DeliveryGoogleMap({ destination, fallbackImageUrl, className }: Props) {
  const apiKey = getGoogleMapsApiKey()
  const [userOrigin, setUserOrigin] = useState<string | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'loading' | 'ok' | 'denied' | 'unsupported'>('idle')

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

  const publicEmbedSrc = destination.trim()
    ? `https://maps.google.com/maps?q=${encodeURIComponent(destination)}&output=embed`
    : null
  const embedSrc = apiKey
    ? userOrigin
      ? buildDirectionsEmbedSrc(userOrigin, destination, apiKey)
      : buildPlaceEmbedSrc(destination, apiKey)
    : publicEmbedSrc

  const externalUrl = buildGoogleMapsDirectionsUrl(destination, userOrigin)

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
            <p className="dd-gmap-fallback-title">Maps</p>
            <p className="dd-gmap-fallback-text">Using public Google Maps embed. Open in Google Maps for turn-by-turn navigation.</p>
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
      </div>
    </div>
  )
}
