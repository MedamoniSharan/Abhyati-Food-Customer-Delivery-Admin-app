import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeliveryStop } from '../../services/deliveryBackendApi'

const INVOICE_PREVIEW =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuADpsWe2NwiVMZ6KQnnuJWJyuiLobbzq5rZE2q8PaJW3ma0QUcVSCp7bBSgB4lTZuBdqcOteTtfn7yS5qNU-Ji-NytoSiEcQJQ_BFPzLlru269Old1Yl1GyTcBZD7Q_5Im0If84rjpvqaEX_uZuFMaU7MSghRtKcKGowa7o5T7B3-SAaZsuqd2aKRh24o76KOM1zVPKa0wAsFugUS0_qSBEsQA7sZdk6CldX7v9dJsWy4iOal0jNLo5UCMIr1Ls0weBvc_5CKEEq794'

type Props = {
  detail: DeliveryStop
  onBack: () => void
  onConfirm: (recipient: string, photo: File) => void
  onNotify: (message: string) => void
}

export function ProofOfDeliveryScreen({ detail, onBack, onConfirm, onNotify }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [recipient, setRecipient] = useState('')
  const [invoicePhoto, setInvoicePhoto] = useState<File | null>(null)

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
    async function requestCameraPermission() {
      if (!navigator.mediaDevices?.getUserMedia) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        stream.getTracks().forEach((track) => track.stop())
      } catch {
        onNotify('Camera permission is required for invoice capture')
      }
    }
    requestCameraPermission()
  }, [onNotify])

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
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
  }

  return (
    <>
      <header className="dd-header">
        <div className="dd-header-row">
          <button type="button" className="dd-icon-btn" aria-label="Back" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>Proof of Delivery</h1>
          <button type="button" className="dd-text-btn" onClick={() => onNotify('Help')}>
            Help
          </button>
        </div>
      </header>

      <main className="dd-main" style={{ paddingBottom: 100 }}>
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
          <div className="dd-pod-camera">
            <img src={INVOICE_PREVIEW} alt="" />
            <div className="dd-pod-frame" />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: 16,
                pointerEvents: 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', pointerEvents: 'auto' }}>
                <button type="button" className="dd-icon-btn" style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }} onClick={() => onNotify('Flash')}>
                  <span className="material-symbols-outlined">flash_on</span>
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 36,
                  marginBottom: 8,
                  pointerEvents: 'auto',
                }}
              >
                <button
                  type="button"
                  className="dd-icon-btn"
                  style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                  onClick={() => {
                    const el = document.getElementById('pod-photo-input') as HTMLInputElement | null
                    el?.click()
                  }}
                >
                  <span className="material-symbols-outlined">image</span>
                </button>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  id="pod-photo-input"
                  onChange={(e) => setInvoicePhoto(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="dd-icon-btn"
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 999,
                    border: '4px solid #fff',
                    background: 'rgba(255,255,255,0.2)',
                    color: '#fff',
                  }}
                  aria-label="Shutter"
                  onClick={() => {
                    const el = document.getElementById('pod-photo-input') as HTMLInputElement | null
                    el?.click()
                  }}
                >
                  <span style={{ width: 52, height: 52, borderRadius: 999, background: '#fff', display: 'block' }} />
                </button>
                <button type="button" className="dd-icon-btn" style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }} onClick={() => onNotify('Switch camera')}>
                  <span className="material-symbols-outlined">cameraswitch</span>
                </button>
              </div>
            </div>
            <p style={{ margin: '10px 0 0', color: '#fff', fontSize: '0.78rem' }}>
              {invoicePhoto ? `Selected: ${invoicePhoto.name}` : 'Capture or select signed invoice photo'}
            </p>
          </div>
        </section>

        <div style={{ height: 1, background: 'var(--dd-border)', margin: '20px 0' }} />

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              <span className="dd-step-num">2</span>
              Customer Signature
            </h2>
            <button type="button" className="dd-link" onClick={clearSignature}>
              CLEAR
            </button>
          </div>
          <div className="dd-signature-grid">
            <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} />
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
            <div style={{ position: 'absolute', bottom: 10, right: 10, background: '#000', color: '#fff', borderRadius: 999, padding: 8, pointerEvents: 'none' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                edit
              </span>
            </div>
          </div>
          <label style={{ display: 'block', marginTop: 18 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dd-muted)' }}>RECEIVED BY</span>
            <input
              className="dd-input"
              placeholder="Enter recipient name"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="name"
            />
          </label>
        </section>
      </main>

      <footer className="dd-footer-fixed">
        <button
          type="button"
          className="dd-accent-btn"
          onClick={() => {
            if (!recipient.trim()) {
              onNotify('Please enter recipient name')
              return
            }
            if (!invoicePhoto) {
              onNotify('Please capture signed invoice photo')
              return
            }
            onConfirm(recipient.trim(), invoicePhoto)
          }}
        >
          Confirm Delivery
          <span className="material-symbols-outlined">check_circle</span>
        </button>
      </footer>
    </>
  )
}
