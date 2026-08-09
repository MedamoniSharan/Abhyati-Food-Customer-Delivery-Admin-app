import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthUser } from '../../services/authApi'
import { PullToRefresh } from '../../components/PullToRefresh'
import { DeliveryGoogleMap } from '../../components/DeliveryGoogleMap'
import {
  acceptDeliveryStop,
  confirmDeliveryStop,
  getDeliveryStopDetail,
  getDeliveryStops,
  updateDeliveryStopStatus,
  type DeliveryStop,
} from '../../services/deliveryBackendApi'
import { buildGoogleMapsDirectionsUrl } from '../../utils/googleMapsEmbed'
import { isGoogleMapsUrl, normalizeMapsLink } from '../../utils/mapsLink'
import { formatIndiaMobileTel, isValidIndiaMobile } from '../../utils/indiaMobile'
import { AssignedDeliveriesScreen, type DeliveriesStatusFilter } from './AssignedDeliveriesScreen'
import { DeliveryBottomNav, type DriverTab } from './DeliveryBottomNav'
import { DeliveryDashboardScreen } from './DeliveryDashboardScreen'
import { DeliveryDetailScreen } from './DeliveryDetailScreen'
import { ProofOfDeliveryScreen } from './ProofOfDeliveryScreen'
import { DeliverySideMenu } from './DeliverySideMenu'
import { DriverProfileSettings } from './DriverProfileSettings'

type Props = {
  user: AuthUser
  onLogout: () => void
  onNotify: (message: string) => void
  onSessionUpdate: (user: AuthUser, token: string) => void
}

export function DeliveryDriverApp({ user, onLogout, onNotify, onSessionUpdate }: Props) {
  const [tab, setTab] = useState<DriverTab>('dashboard')
  const [deliveriesFilter, setDeliveriesFilter] = useState<DeliveriesStatusFilter>('all')
  const [detailStopId, setDetailStopId] = useState<string | null>(null)
  const [podStopId, setPodStopId] = useState<string | null>(null)
  const [routeMapQuery, setRouteMapQuery] = useState<string | null>(null)
  const [stops, setStops] = useState<DeliveryStop[]>([])
  const [loadingStops, setLoadingStops] = useState(true)
  const [detailFromApi, setDetailFromApi] = useState<DeliveryStop | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const scannerVideoRef = useRef<HTMLVideoElement>(null)
  const scannerStreamRef = useRef<MediaStream | null>(null)
  const prevTabRef = useRef<DriverTab>(tab)

  const activeStops = useMemo(() => stops.filter((s) => s.statusTag !== 'Delivered'), [stops])
  const completedCount = useMemo(() => stops.filter((s) => s.statusTag === 'Delivered').length, [stops])
  const deliveredStops = useMemo(
    () =>
      [...stops]
        .filter((s) => s.statusTag === 'Delivered')
        .sort((a, b) => String(b.orderId || '').localeCompare(String(a.orderId || ''))),
    [stops]
  )
  const recentStop = useMemo(() => {
    if (deliveredStops.length > 0) return deliveredStops[0]
    return activeStops[0] ?? null
  }, [deliveredStops, activeStops])

  async function refreshStops(quiet?: boolean): Promise<DeliveryStop[]> {
    if (!quiet) setLoadingStops(true)
    try {
      const data = await getDeliveryStops()
      setStops(data)
      return data
    } catch {
      onNotify('Could not load deliveries')
      return stops
    } finally {
      if (!quiet) setLoadingStops(false)
    }
  }

  const handlePullRefresh = useCallback(async () => {
    try {
      const data = await getDeliveryStops()
      setStops(data)
      onNotify('Refreshed')
    } catch {
      onNotify('Could not load deliveries')
    }
  }, [onNotify])

  function openProofForStop(stopId: string) {
    const stop = stops.find((s) => s.id === stopId)
    if (!stop) {
      onNotify('Delivery not found')
      return
    }
    if (stop.statusTag === 'Assigned') {
      onNotify('Accept this delivery first')
      return
    }
    if (stop.statusTag === 'Delivered' && stop.proofUploaded) {
      onNotify('This delivery is already completed')
      return
    }
    setDetailStopId(stopId)
    setPodStopId(stopId)
  }

  function openRouteMap(mapsQuery?: string, mapsLink?: string) {
    const link =
      normalizeMapsLink(mapsLink || '') ||
      (isGoogleMapsUrl(mapsQuery || '') ? normalizeMapsLink(mapsQuery || '') || String(mapsQuery || '').trim() : '')
    const query = String(mapsQuery || '').trim() || nextStopMapsQuery()
    if (!link && !query) {
      onNotify('No route available')
      return
    }
    // Customer Maps share links open in Google Maps (short links do not embed well).
    if (link) {
      openUrl(link)
    }
    setRouteMapQuery(link || query)
  }

  async function acceptStopAndOpenMap(stopId: string) {
    const fallback = stops.find((s) => s.id === stopId)
    setAcceptingId(stopId)
    try {
      await acceptDeliveryStop(stopId)
      try {
        await updateDeliveryStopStatus(stopId, 'in_transit')
      } catch {
        /* map still opens if status update fails */
      }
      const refreshed = await refreshStops(true)
      onNotify('Delivery accepted — opening map')
      const target = refreshed.find((s) => s.id === stopId) || fallback
      openRouteMap(target?.mapsQuery || fallback?.mapsQuery, target?.mapsLink || fallback?.mapsLink)
    } catch {
      onNotify('Could not accept delivery')
    } finally {
      setAcceptingId(null)
    }
  }

  function nextStopMapsQuery() {
    const stop = activeStops.find((s) => s.isNext) ?? activeStops[0]
    return stop?.mapsQuery || ''
  }

  function openUrl(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function openNavigation(destination: string, mapsLink?: string) {
    const dest = String(destination || '').trim()
    const link = normalizeMapsLink(mapsLink || '') || (isGoogleMapsUrl(dest) ? normalizeMapsLink(dest) || dest : '')
    if (!link && !dest) {
      onNotify('No destination available')
      return
    }
    openUrl(buildGoogleMapsDirectionsUrl(link || dest))
  }

  function callCustomer(phone: string) {
    if (!isValidIndiaMobile(phone) && !String(phone || '').replace(/\D/g, '').length) {
      onNotify('Customer phone number not available')
      return
    }
    const normalized = formatIndiaMobileTel(phone)
    if (!normalized) {
      onNotify('Phone number not available')
      return
    }
    openUrl(`tel:${normalized}`)
  }

  function messageCustomer(phone: string) {
    if (!isValidIndiaMobile(phone) && !String(phone || '').replace(/\D/g, '').length) {
      onNotify('Customer phone number not available')
      return
    }
    const normalized = formatIndiaMobileTel(phone)
    if (!normalized) {
      onNotify('Phone number not available')
      return
    }
    openUrl(`sms:${normalized}`)
  }

  async function openScanner() {
    setScannerError(null)
    setScannerOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      scannerStreamRef.current = stream
      if (scannerVideoRef.current) {
        scannerVideoRef.current.srcObject = stream
        await scannerVideoRef.current.play()
      }
    } catch {
      setScannerError('Camera permission denied or unavailable')
      onNotify('Camera permission is required to scan')
    }
  }

  function closeScanner() {
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
    scannerStreamRef.current = null
    setScannerOpen(false)
  }

  useEffect(() => {
    let mounted = true
    setLoadingStops(true)
    getDeliveryStops()
      .then((data) => {
        if (!mounted) return
        setStops(data)
      })
      .catch(() => {
        if (!mounted) return
        onNotify('Could not load assignments')
      })
      .finally(() => {
        if (!mounted) return
        setLoadingStops(false)
      })
    return () => {
      mounted = false
    }
  }, [onNotify])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void getDeliveryStops()
        .then((data) => setStops(data))
        .catch(() => {
          /* keep current list on background refresh failure */
        })
    }, 20000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (prevTabRef.current === tab) return
    prevTabRef.current = tab
    if (tab !== 'dashboard' && tab !== 'deliveries') return
    void getDeliveryStops()
      .then((data) => setStops(data))
      .catch(() => {
        /* keep current list on tab refresh failure */
      })
  }, [tab])

  useEffect(() => {
    if (!detailStopId) {
      setDetailFromApi(null)
      setLoadingDetail(false)
      return
    }
    setLoadingDetail(true)
    const direct = stops.find((stop) => stop.id === detailStopId)
    if (direct) {
      setDetailFromApi(direct)
      setLoadingDetail(false)
      return
    }
    let mounted = true
    getDeliveryStopDetail(detailStopId)
      .then((stop) => {
        if (!mounted) return
        if (!stop) {
          setDetailFromApi(null)
          setDetailStopId(null)
          onNotify('Delivery not found')
          return
        }
        setDetailFromApi(stop)
      })
      .catch(() => {
        if (!mounted) return
        setDetailFromApi(null)
        setDetailStopId(null)
        onNotify('Could not load delivery')
      })
      .finally(() => {
        if (!mounted) return
        setLoadingDetail(false)
      })
    return () => {
      mounted = false
    }
  }, [detailStopId, stops, onNotify])

  useEffect(() => () => closeScanner(), [])

  const detail = useMemo(() => detailFromApi, [detailFromApi])

  const podDetail = useMemo(() => {
    if (!podStopId) return null
    if (detail && detail.id === podStopId) return detail
    const stop = stops.find((s) => s.id === podStopId)
    if (stop) return stop
    return null
  }, [detail, podStopId, stops])

  function closeOverlays() {
    setDetailStopId(null)
    setPodStopId(null)
  }

  function handleTabChange(next: DriverTab) {
    setTab(next)
    if (next !== 'deliveries') setDeliveriesFilter('all')
  }

  if (detailStopId && !detail && loadingDetail) {
    return (
      <div className="driver-app">
        <div className="driver-phone-frame dd-detail-loading-frame">
          <div className="dd-loader-card" role="status" aria-live="polite">
            <span className="dd-loader-spin" aria-hidden />
            <span>Loading delivery…</span>
          </div>
        </div>
        <DeliveryBottomNav active={tab} onChange={handleTabChange} onScan={openScanner} />
      </div>
    )
  }

  if (podDetail) {
    return (
      <div className="driver-app">
        <div className="driver-phone-frame">
          <ProofOfDeliveryScreen
            detail={podDetail}
            onBack={() => {
              if (confirming) return
              setPodStopId(null)
            }}
            submitting={confirming}
            onConfirm={async (recipient, photo, signature) => {
              if (!podDetail.id || confirming) return
              setConfirming(true)
              try {
                await confirmDeliveryStop(podDetail.id, recipient, photo, signature)
                onNotify('Signed invoice uploaded to Zoho Books')
                await refreshStops(true)
                closeOverlays()
                setTab('deliveries')
              } catch {
                onNotify('Could not upload proof to Zoho Books')
              } finally {
                setConfirming(false)
              }
            }}
            onNotify={onNotify}
          />
        </div>
      </div>
    )
  }

  if (detail) {
    return (
      <div className="driver-app">
        <div className="driver-phone-frame">
          <DeliveryDetailScreen
            detail={detail}
            onBack={() => setDetailStopId(null)}
            onAccept={() => acceptStopAndOpenMap(detail.id)}
            accepting={acceptingId === detail.id}
            onViewMap={() => openRouteMap(detail.mapsQuery, detail.mapsLink)}
            onOpenProof={() => {
              if (detail.statusTag === 'Delivered' && detail.proofUploaded) {
                onNotify('Receipt is already saved in Zoho Books')
                return
              }
              if (detail.statusTag === 'Assigned') {
                onNotify('Accept this delivery first')
                return
              }
              setPodStopId(detail.id)
            }}
            onOpenAddress={() => openNavigation(detail.mapsQuery, detail.mapsLink)}
            onMessage={() => messageCustomer(detail.phone)}
            onCall={() => callCustomer(detail.phone)}
            onNotify={onNotify}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="driver-app">
      <div className="driver-phone-frame">
        <PullToRefresh onRefresh={handlePullRefresh} disabled={scannerOpen || Boolean(routeMapQuery)}>
        {tab === 'dashboard' ? (
          <DeliveryDashboardScreen
            loading={loadingStops}
            currentStop={activeStops.find((s) => s.isNext) ?? activeStops[0] ?? null}
            recentStop={recentStop}
            totalStops={stops.length}
            completedStops={completedCount}
            onStartNavigation={() => {
              const stop = activeStops.find((s) => s.isNext) ?? activeStops[0]
              if (!stop) {
                onNotify('No active delivery')
                return
              }
              if (stop.statusTag === 'Assigned') {
                onNotify('Accept a delivery from the list first')
                return
              }
              openRouteMap(stop.mapsQuery, stop.mapsLink)
            }}
            onCallCurrent={() => {
              const stop = activeStops.find((s) => s.isNext) ?? activeStops[0]
              if (!stop) {
                onNotify('No active delivery')
                return
              }
              callCustomer(stop.phone)
            }}
            onViewAllDeliveries={() => {
              setDeliveriesFilter('all')
              setTab('deliveries')
            }}
            onViewPendingDeliveries={() => {
              setDeliveriesFilter('pending')
              setTab('deliveries')
            }}
            onViewCompletedDeliveries={() => {
              setDeliveriesFilter('completed')
              setTab('deliveries')
            }}
            onOpenMenu={() => setMenuOpen(true)}
          />
        ) : null}
        {tab === 'deliveries' ? (
          <AssignedDeliveriesScreen
            stops={stops}
            loading={loadingStops}
            statusFilter={deliveriesFilter}
            onOpenStop={(id) => setDetailStopId(id)}
            onCompleteStop={openProofForStop}
            onAcceptStop={(id) => acceptStopAndOpenMap(id)}
            acceptingId={acceptingId}
            onBackToDashboard={() => {
              setDeliveriesFilter('all')
              setTab('dashboard')
            }}
            onViewMap={(hint, mapsLink) => openRouteMap(hint, mapsLink)}
            onRefresh={() => void refreshStops()}
          />
        ) : null}
        {tab === 'history' ? (
          <>
            <header className="dd-header">
              <div className="dd-header-row">
                <h1>History</h1>
              </div>
            </header>
            <main className="dd-main">
              {deliveredStops.length === 0 ? (
                <p style={{ margin: 16, color: 'var(--dd-muted)' }}>No completed deliveries yet.</p>
              ) : (
                deliveredStops.map((s) => (
                  <div key={s.id} className="dd-card" style={{ padding: 16, marginBottom: 12 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{s.businessName}</p>
                    <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--dd-muted)' }}>{s.orderId}</p>
                    <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--dd-muted)' }}>
                      {s.proofUploaded ? 'Receipt uploaded to Zoho Books' : 'Delivered'}
                      {s.proofFileName ? ` · ${s.proofFileName}` : ''}
                    </p>
                  </div>
                ))
              )}
            </main>
          </>
        ) : null}
        {tab === 'profile' ? (
          <>
            <header className="dd-header">
              <div className="dd-header-row">
                <h1>Profile and settings</h1>
              </div>
            </header>
            <main className="dd-main">
              <div className="dd-card" style={{ padding: 20, marginBottom: 12 }}>
                <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dd-muted)' }}>SIGNED IN AS</p>
                <p style={{ margin: '8px 0 0', fontSize: '1.2rem', fontWeight: 700 }}>{user.fullName}</p>
                <p style={{ margin: '6px 0 0', fontSize: '0.875rem', color: 'var(--dd-muted)' }}>{user.email}</p>
                <p style={{ margin: '14px 0 0', fontSize: '0.8rem', color: 'var(--dd-muted)' }}>Delivery driver · Zoho Books contact</p>
              </div>
              <DriverProfileSettings
                user={user}
                onSaved={(nextUser, token) => onSessionUpdate(nextUser, token)}
                onNotify={onNotify}
              />
              <button type="button" className="dd-accent-btn" style={{ marginTop: 20, background: '#0f172a', boxShadow: 'none' }} onClick={onLogout}>
                Log out
              </button>
            </main>
          </>
        ) : null}
        </PullToRefresh>
      </div>
      <DeliverySideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(nextTab) => {
          setDetailStopId(null)
          setPodStopId(null)
          setRouteMapQuery(null)
          setTab(nextTab)
        }}
        onLogout={onLogout}
      />
      <DeliveryBottomNav active={tab} onChange={handleTabChange} onScan={openScanner} />

      {scannerOpen ? (
        <div className="dd-scanner-overlay" role="dialog" aria-modal="true" aria-label="Scanner">
          <header className="dd-header">
            <div className="dd-header-row">
              <button type="button" className="dd-icon-btn" aria-label="Close scanner" onClick={closeScanner}>
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <h1>Scan QR</h1>
              <span style={{ width: 40 }} aria-hidden />
            </div>
          </header>
          <div className="dd-scanner-video-wrap">
            <video ref={scannerVideoRef} className="dd-scanner-video" playsInline muted autoPlay />
            <div className="dd-scanner-frame" aria-hidden />
          </div>
          <footer className="dd-footer-fixed">
            <button type="button" className="dd-accent-btn" onClick={closeScanner}>
              Done
            </button>
            {scannerError ? <p style={{ margin: '10px 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>{scannerError}</p> : null}
          </footer>
        </div>
      ) : null}

      {routeMapQuery ? (
        <div className="dd-map-overlay" role="dialog" aria-modal="true" aria-label="Route map">
          <header className="dd-header">
            <div className="dd-header-row">
              <button type="button" className="dd-icon-btn" aria-label="Close map" onClick={() => setRouteMapQuery(null)}>
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <h1>Today&apos;s route</h1>
              <span style={{ width: 40 }} aria-hidden />
            </div>
          </header>
          <div className="dd-map-overlay-body">
            <DeliveryGoogleMap
              destination={routeMapQuery}
              mapsLink={
                activeStops.find((s) => s.mapsQuery?.trim() === routeMapQuery.trim() || s.mapsLink?.trim() === routeMapQuery.trim())
                  ?.mapsLink
              }
            />
          </div>
          {(() => {
            const mapStop = activeStops.find((s) => s.mapsQuery?.trim() === routeMapQuery.trim())
            if (!mapStop || mapStop.statusTag === 'Delivered') return null
            return (
              <footer className="dd-footer-fixed">
                <button type="button" className="dd-accent-btn" onClick={() => openProofForStop(mapStop.id)}>
                  <span className="material-symbols-outlined">check_circle</span>
                  Complete delivery
                </button>
              </footer>
            )
          })()}
        </div>
      ) : null}

      {loadingDetail || confirming ? (
        <div className="dd-loader-overlay" aria-live="polite">
          <div className="dd-loader-card">
            <span className="dd-loader-spin" aria-hidden />
            {confirming ? 'Syncing delivery…' : 'Loading delivery…'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
