import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import type { DeliveryStop } from '../../services/deliveryBackendApi'

type Props = {
  detail: DeliveryStop
  onBack: () => void
  onConfirm: (recipient: string, photo: File, signature: Blob) => void | Promise<void>
  onNotify: (message: string) => void
  /** True while proof upload / Zoho sync is in progress. */
  submitting?: boolean
}

export function ProofOfDeliveryScreen({ detail, onBack, onConfirm, onNotify, submitting = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasSignature = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [recipient, setRecipient] = useState('')
  const [invoicePhoto, setInvoicePhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const isNative = Capacitor.isNativePlatform()

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = parent.clientWidth
    const h = parent.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }
  }, [])

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [resizeCanvas])

  useEffect(() => {
    if (!invoicePhoto) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(invoicePhoto)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [invoicePhoto])

  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify

  const stopLiveCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraReady(false)
  }, [])

  const startLiveCamera = useCallback(
    async (facing: 'environment' | 'user' = 'environment') => {
      if (isNative) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is not supported in this browser')
        return
      }
      setCameraError(null)
      stopLiveCamera()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        })
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.muted = true
          video.setAttribute('playsinline', 'true')
          await video.play()
        }
        setCameraReady(true)
      } catch {
        setCameraReady(false)
        setCameraError('Allow camera access to capture the invoice photo')
        onNotifyRef.current('Camera permission is required for invoice capture')
      }
    },
    [isNative, stopLiveCamera]
  )

  // Live camera while waiting for a photo (web / PWA).
  useEffect(() => {
    if (invoicePhoto || isNative) {
      stopLiveCamera()
      return
    }
    void startLiveCamera(facingMode)
    return () => stopLiveCamera()
  }, [invoicePhoto, isNative, facingMode, startLiveCamera, stopLiveCamera])

  async function uriToFile(uri: string, fileName: string): Promise<File> {
    const response = await fetch(uri)
    const blob = await response.blob()
    return new File([blob], fileName, { type: blob.type || 'image/jpeg' })
  }

  async function captureFromNativeCamera() {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        quality: 85,
        allowEditing: false,
        saveToGallery: false,
      })
      const webPath = photo.webPath || photo.path
      if (!webPath) {
        onNotify('Could not read camera photo')
        return
      }
      const file = await uriToFile(webPath, `invoice-${Date.now()}.jpg`)
      setInvoicePhoto(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Camera capture failed'
      if (!/cancel/i.test(message)) onNotify(message)
    }
  }

  async function pickFromNativeGallery() {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        resultType: CameraResultType.Uri,
        quality: 85,
      })
      const webPath = photo.webPath || photo.path
      if (!webPath) {
        onNotify('Could not read selected photo')
        return
      }
      const file = await uriToFile(webPath, `invoice-${Date.now()}.jpg`)
      setInvoicePhoto(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open gallery'
      if (!/cancel/i.test(message)) onNotify(message)
    }
  }

  async function captureFromLiveVideo() {
    const video = videoRef.current
    if (!video || !cameraReady || video.videoWidth < 2) {
      onNotify('Camera is not ready yet')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      onNotify('Could not capture photo')
      return
    }
    ctx.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) {
      onNotify('Could not capture photo')
      return
    }
    stopLiveCamera()
    setInvoicePhoto(new File([blob], `invoice-${Date.now()}.jpg`, { type: 'image/jpeg' }))
  }

  function openShutter() {
    if (isNative) {
      void captureFromNativeCamera()
      return
    }
    if (cameraReady) {
      void captureFromLiveVideo()
      return
    }
    // Fallback: system camera / file picker
    photoInputRef.current?.click()
  }

  function openGallery() {
    if (isNative) {
      void pickFromNativeGallery()
      return
    }
    galleryInputRef.current?.click()
  }

  function switchCamera() {
    if (isNative) {
      void captureFromNativeCamera()
      return
    }
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  function handlePhotoChange(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onNotify('Please choose an image file')
      return
    }
    setInvoicePhoto(file)
  }

  function retakePhoto() {
    setInvoicePhoto(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    hasSignature.current = true
    last.current = getPoint(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !last.current) return
    const p = getPoint(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    hasSignature.current = true
    last.current = p
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false
    last.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasSignature.current = false
  }

  function exportSignatureBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current
    if (!canvas) return Promise.resolve(null)
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }

  function scrollInputIntoView(e: React.FocusEvent<HTMLInputElement>) {
    window.setTimeout(() => {
      e.target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 300)
  }

  return (
    <div className="dd-pod-screen">
      <header className="dd-header">
        <div className="dd-header-row">
          <button type="button" className="dd-icon-btn" aria-label="Back" onClick={onBack} disabled={submitting}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>Proof of Delivery</h1>
          <button type="button" className="dd-text-btn" onClick={() => onNotify('Help')} disabled={submitting}>
            Help
          </button>
        </div>
      </header>

      <main className="dd-main dd-main--pod-scroll">
        <div className="dd-card" style={{ padding: 14, display: 'flex', gap: 14, marginBottom: 8 }}>
          <div style={{ background: '#000', color: '#fff', padding: 10, borderRadius: 10 }}>
            <span className="material-symbols-outlined">inventory_2</span>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{detail.podOrderLabel}</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--dd-muted)' }}>{detail.podSubtitle}</p>
          </div>
        </div>

        <section style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              <span className="dd-step-num">1</span>
              Capture Invoice
            </h2>
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '4px 8px',
                borderRadius: 8,
                background: '#f1f5f9',
              }}
            >
              REQUIRED
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--dd-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            Take a clear photo of the signed paper invoice for our records.
          </p>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="dd-pod-file-input"
            onChange={(e) => handlePhotoChange(e.target.files?.[0])}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="dd-pod-file-input"
            onChange={(e) => handlePhotoChange(e.target.files?.[0])}
          />
          {previewUrl ? (
            <div className="dd-pod-camera dd-pod-camera--preview">
              <img key={previewUrl} src={previewUrl} alt="Signed invoice preview" className="dd-pod-preview-img" />
              <div className="dd-pod-preview-bar">
                <p className="dd-pod-preview-label">Invoice photo captured</p>
                <button type="button" className="dd-pod-retake-btn" onClick={retakePhoto}>
                  <span className="material-symbols-outlined">replay</span>
                  Retake
                </button>
              </div>
            </div>
          ) : (
            <div className="dd-pod-camera">
              {!isNative ? (
                <video ref={videoRef} className="dd-pod-live-video" playsInline muted autoPlay />
              ) : (
                <div className="dd-pod-camera-idle">
                  <span className="material-symbols-outlined">photo_camera</span>
                  <p>Tap the shutter to open the camera</p>
                </div>
              )}
              {!isNative && !cameraReady ? (
                <div className="dd-pod-camera-idle">
                  <span className="material-symbols-outlined">photo_camera</span>
                  <p>{cameraError || 'Starting camera…'}</p>
                  {cameraError ? (
                    <button type="button" className="dd-pod-retake-btn" onClick={() => void startLiveCamera(facingMode)}>
                      Try again
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="dd-pod-frame" />
              <div className="dd-pod-capture-ui">
                <div className="dd-pod-capture-top">
                  <span className="dd-pod-live-badge">{cameraReady || isNative ? 'CAMERA' : '…'}</span>
                </div>
                <div className="dd-pod-capture-controls">
                  <button type="button" className="dd-icon-btn dd-pod-overlay-btn" aria-label="Choose from gallery" onClick={openGallery}>
                    <span className="material-symbols-outlined">image</span>
                  </button>
                  <button type="button" className="dd-pod-shutter" aria-label="Take photo" onClick={openShutter}>
                    <span className="dd-pod-shutter-inner" />
                  </button>
                  <button type="button" className="dd-icon-btn dd-pod-overlay-btn" aria-label="Switch camera" onClick={switchCamera}>
                    <span className="material-symbols-outlined">cameraswitch</span>
                  </button>
                </div>
              </div>
              <p className="dd-pod-hint">
                {isNative ? 'Tap shutter to open camera' : cameraReady ? 'Tap shutter to capture' : 'Allow camera access to continue'}
              </p>
            </div>
          )}
        </section>

        <div style={{ height: 1, background: 'var(--dd-border)', margin: '20px 0' }} />

        <section style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              <span className="dd-step-num">2</span>
              Received By
            </h2>
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '4px 8px',
                borderRadius: 8,
                background: '#f1f5f9',
              }}
            >
              REQUIRED
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--dd-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            Enter the name of the person who received this delivery.
          </p>
          <label style={{ display: 'block' }}>
            <span className="sr-only">Recipient name</span>
            <input
              className="dd-input"
              placeholder="Enter recipient name"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onFocus={scrollInputIntoView}
              autoComplete="name"
              enterKeyHint="done"
            />
          </label>
        </section>

        <div style={{ height: 1, background: 'var(--dd-border)', margin: '20px 0' }} />

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              <span className="dd-step-num">3</span>
              Customer Signature
            </h2>
            <button type="button" className="dd-link" onClick={clearSignature}>
              CLEAR
            </button>
          </div>
          <div className="dd-signature-grid">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            <p
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: 0,
                color: '#d4d4d8',
                fontSize: '0.875rem',
                fontWeight: 500,
                pointerEvents: 'none',
              }}
            >
              Sign here
            </p>
            <div
              style={{
                position: 'absolute',
                bottom: 10,
                right: 10,
                background: '#000',
                color: '#fff',
                borderRadius: 999,
                padding: 8,
                pointerEvents: 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                edit
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="dd-footer-fixed">
        <button
          type="button"
          className={`dd-accent-btn${submitting ? ' dd-accent-btn--loading' : ''}`}
          disabled={submitting}
          onClick={() => {
            if (submitting) return
            void (async () => {
              if (!recipient.trim() || recipient.trim().length < 2) {
                onNotify('Please enter recipient name')
                return
              }
              if (!invoicePhoto) {
                onNotify('Please capture signed invoice photo')
                return
              }
              if (!hasSignature.current) {
                onNotify('Please add customer signature')
                return
              }
              const signature = await exportSignatureBlob()
              if (!signature) {
                onNotify('Could not export signature')
                return
              }
              await onConfirm(recipient.trim(), invoicePhoto, signature)
            })()
          }}
        >
          {submitting ? (
            <>
              <span className="dd-btn-spin" aria-hidden />
              Completing order…
            </>
          ) : (
            <>
              Confirm Delivery
              <span className="material-symbols-outlined">check_circle</span>
            </>
          )}
        </button>
      </footer>

      {submitting ? (
        <div className="dd-loader-overlay dd-loader-overlay--pod" role="status" aria-live="polite" aria-busy="true">
          <div className="dd-loader-card">
            <span className="dd-loader-spin" aria-hidden />
            <span>Uploading proof &amp; completing order…</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
