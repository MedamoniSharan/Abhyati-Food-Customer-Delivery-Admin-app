type Props = {
  mapsLink?: string
  onOpen?: () => void
  compact?: boolean
}

export function DeliveryMapsLink({ mapsLink, onOpen, compact = false }: Props) {
  const link = String(mapsLink || '').trim()
  if (!link) return null

  function openLink() {
    if (onOpen) {
      onOpen()
      return
    }
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  if (compact) {
    return (
      <button type="button" className="dd-maps-link dd-maps-link--compact" onClick={openLink}>
        <span className="material-symbols-outlined" aria-hidden>
          map
        </span>
        Google Maps
      </button>
    )
  }

  return (
    <button type="button" className="dd-maps-link" onClick={openLink}>
      <span className="material-symbols-outlined" aria-hidden>
        map
      </span>
      <span className="dd-maps-link__text">
        <span className="dd-maps-link__label">Customer Google Maps link</span>
        <span className="dd-maps-link__url">{link}</span>
      </span>
      <span className="material-symbols-outlined dd-maps-link__chev" aria-hidden>
        open_in_new
      </span>
    </button>
  )
}
