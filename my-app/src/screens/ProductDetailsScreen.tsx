import { useEffect, useMemo, useState } from 'react'
import { CatalogLoader } from '../components/CatalogLoader'
import { ProductImage } from '../components/ProductImage'
import { useToast } from '../contexts/ToastContext'
import type { Product } from '../types/app'
import { fetchZohoItemDetail } from '../services/backendApi'
import { formatInr } from '../utils/currency'
import {
  zohoAvailableStockQuantity,
  zohoItemToSpecRows,
  zohoMinOrderQuantity,
  zohoRateInr,
  zohoStockLine,
  zohoUnitLabel,
  type ZohoSpecRow,
} from '../utils/productDetailFromZoho'

type Props = {
  product: Product
  onBack: () => void
  onOpenCart: () => void
  onAddToCart: (product: Product, quantity: number) => void
  onBuyNow: (product: Product, quantity: number) => void
}

function fallbackSpecRows(product: Product): ZohoSpecRow[] {
  const rows: ZohoSpecRow[] = [{ label: 'Category', value: product.category }]
  if (product.subtitle.trim()) {
    rows.unshift({ label: 'Description', value: product.subtitle.trim() })
  }
  return rows
}

function singularUnit(unit: string): string {
  const u = unit.trim().toLowerCase()
  if (u === 'pcs' || u === 'pc' || u === 'pieces' || u === 'piece') return 'piece'
  if (u.endsWith('s') && u.length > 3) return u.slice(0, -1)
  return u || 'piece'
}

/** Preset quantity chips like 50 / 100 / 250 / 500, scaled from MOQ. */
function buildQuantityPresets(minOrder: number, stockCap: number | null): number[] {
  let presets: number[]
  if (minOrder <= 1) {
    presets = [1, 10, 25, 50]
  } else if (minOrder <= 10) {
    presets = [minOrder, minOrder * 5, minOrder * 10, minOrder * 25]
  } else {
    presets = [minOrder, minOrder * 2, Math.round(minOrder * 5), minOrder * 10]
  }
  presets = [...new Set(presets.filter((n) => Number.isFinite(n) && n >= minOrder))].sort((a, b) => a - b)
  if (stockCap != null) {
    presets = presets.filter((n) => n <= stockCap)
    if (presets.length === 0 && stockCap >= minOrder) presets = [minOrder]
  }
  return presets.slice(0, 4)
}

function ProductDetailPageSkeleton() {
  return (
    <div className="pd-v2-skeleton" aria-hidden>
      <div className="product-skeleton-shimmer pd-v2-skel-hero" />
      <div className="pd-v2-skel-body">
        <div className="product-skeleton-shimmer product-detail-skel-line short" />
        <div className="product-skeleton-shimmer product-detail-skel-line title" />
        <div className="product-skeleton-shimmer product-detail-skel-line short" />
        <div className="product-skeleton-shimmer product-detail-skel-card" />
      </div>
    </div>
  )
}

export function ProductDetailsScreen({ product, onBack, onAddToCart, onBuyNow }: Props) {
  const { showToast } = useToast()
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [detailLoading, setDetailLoading] = useState(Boolean(product.zohoItemId))
  const [detailError, setDetailError] = useState<string | null>(null)

  const [quantity, setQuantity] = useState(() => product.minPurchaseCount ?? 1)

  useEffect(() => {
    if (!product.zohoItemId) {
      setDetail(null)
      setDetailLoading(false)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void fetchZohoItemDetail(product.zohoItemId).then((item) => {
      if (cancelled) return
      setDetail(item)
      if (!item) setDetailError('Could not load product details from the server.')
      setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [product.zohoItemId])

  const minOrder = useMemo(
    () => (detail ? zohoMinOrderQuantity(detail, product.minPurchaseCount ?? 1) : product.minPurchaseCount ?? 1),
    [detail, product.minPurchaseCount],
  )

  const stockCap = useMemo(() => {
    if (detail) return zohoAvailableStockQuantity(detail)
    if (product.availableStock != null) return product.availableStock
    return null
  }, [detail, product.availableStock])

  const stockInsufficientForMin = stockCap != null && stockCap < minOrder

  const presets = useMemo(() => buildQuantityPresets(minOrder, stockCap), [minOrder, stockCap])

  useEffect(() => {
    setQuantity((q) => {
      let n = Math.max(minOrder, q)
      if (stockCap != null) n = Math.min(n, stockCap)
      if (presets.length > 0 && !presets.includes(n)) {
        n = presets[0]
      }
      return n
    })
  }, [minOrder, stockCap, presets])

  const displayName =
    detail && detail.name != null && String(detail.name).trim()
      ? String(detail.name).trim()
      : product.name

  const displayRate = detail ? (zohoRateInr(detail) ?? product.priceInr) : product.priceInr
  const unitLabel = detail ? zohoUnitLabel(detail) : product.unit || 'piece'
  const unitSingular = singularUnit(unitLabel)
  const stockLine = detail ? zohoStockLine(detail) : 'In stock, ready to ship'

  const aboutText = useMemo(() => {
    if (detail && typeof detail.description === 'string' && detail.description.trim()) {
      return detail.description.trim()
    }
    if (product.subtitle.trim()) return product.subtitle.trim()
    return null
  }, [detail, product.subtitle])

  const specRows: ZohoSpecRow[] = useMemo(() => {
    if (detail) return zohoItemToSpecRows(detail)
    return fallbackSpecRows(product)
  }, [detail, product])

  const total = useMemo(() => displayRate * quantity, [displayRate, quantity])

  const productForCart = useMemo((): Product => {
    const desc =
      detail && typeof detail.description === 'string' && detail.description.trim()
        ? detail.description.trim()
        : product.subtitle
    return {
      ...product,
      name: displayName,
      priceInr: displayRate,
      subtitle: desc,
      minPurchaseCount: minOrder,
      ...(unitLabel ? { unit: unitLabel } : {}),
      ...(stockCap != null ? { availableStock: stockCap } : {}),
    }
  }, [product, displayName, displayRate, detail, stockCap, minOrder, unitLabel])

  function selectPreset(next: number) {
    if (stockInsufficientForMin) return
    if (stockCap != null && next > stockCap) {
      showToast(
        `Available stock is ${stockCap} ${unitLabel}. You can only order up to that amount.`,
        { variant: 'warning' },
      )
      return
    }
    setQuantity(Math.max(minOrder, next))
  }

  const showBootstrapLoader = detailLoading && Boolean(product.zohoItemId)
  const badgeLabel = product.badge?.label || 'Eco-friendly'
  const categoryLabel = (product.category || 'Product').trim().toUpperCase()

  return (
    <div className="pd-v2">
      {showBootstrapLoader ? (
        <main className="pd-v2-main pd-v2-loading">
          <button type="button" className="pd-v2-back" onClick={onBack} aria-label="Back">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <CatalogLoader label="Loading product details…" />
          <ProductDetailPageSkeleton />
        </main>
      ) : (
        <>
          <main className="pd-v2-main">
            <section className="pd-v2-hero">
              <ProductImage product={product} className="pd-v2-hero-img" />
              <button type="button" className="pd-v2-back" onClick={onBack} aria-label="Back">
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <span className="pd-v2-eco-badge">
                <span className="material-symbols-outlined">eco</span>
                {badgeLabel}
              </span>
            </section>

            <section className="pd-v2-body">
              <p className="pd-v2-category">{categoryLabel}</p>
              <h1 className="pd-v2-title">{displayName}</h1>

              <div className="pd-v2-price-row">
                <p className="pd-v2-price">
                  <strong>{formatInr(displayRate)}</strong>
                  <span> / {unitSingular}</span>
                </p>
                <span className="pd-v2-moq">MOQ {minOrder}</span>
              </div>

              {detailError ? (
                <p className="pd-v2-stock warn">{detailError}</p>
              ) : (
                <p className="pd-v2-stock">{stockLine}</p>
              )}

              {aboutText ? (
                <section className="pd-v2-section">
                  <h2 className="pd-v2-section-label">About this product</h2>
                  <p className="pd-v2-about">{aboutText}</p>
                </section>
              ) : null}

              <section className="pd-v2-section">
                <h2 className="pd-v2-section-label">Choose quantity</h2>
                <div className="pd-v2-qty-grid" role="group" aria-label="Quantity">
                  {presets.map((n) => {
                    const active = quantity === n
                    return (
                      <button
                        key={n}
                        type="button"
                        className={active ? 'pd-v2-qty-chip active' : 'pd-v2-qty-chip'}
                        disabled={stockInsufficientForMin}
                        onClick={() => selectPreset(n)}
                        aria-pressed={active}
                      >
                        <span className="pd-v2-qty-num">{n}</span>
                        <span className="pd-v2-qty-unit">{unitSingular}</span>
                      </button>
                    )
                  })}
                </div>
                {stockInsufficientForMin ? (
                  <p className="stock-cap-warning" role="alert">
                    Available stock ({stockCap} {unitLabel}) is below the minimum order. This item cannot be ordered
                    right now.
                  </p>
                ) : stockCap != null ? (
                  <p className="pd-v2-stock-hint">You can order up to {stockCap} {unitLabel}.</p>
                ) : null}
              </section>

              {specRows.length > 0 ? (
                <section className="pd-v2-section">
                  <h2 className="pd-v2-section-label">Specifications</h2>
                  <div className="pd-v2-specs">
                    {specRows.map((row, index) => (
                      <div key={`${index}-${row.label}`} className="pd-v2-spec-row">
                        <small>{row.label}</small>
                        <p className={row.label === 'Description' ? 'spec-value-multiline' : undefined}>{row.value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <button
                type="button"
                className="pd-v2-buy-now"
                disabled={stockInsufficientForMin}
                onClick={() => onBuyNow(productForCart, quantity)}
              >
                Buy now
              </button>
            </section>
          </main>

          <footer className="pd-v2-footer">
            <div className="pd-v2-line-total">
              <div>
                <span className="pd-v2-line-label">Line total</span>
                <small>
                  {quantity} × {formatInr(displayRate)}
                </small>
              </div>
              <strong>{formatInr(total)}</strong>
            </div>
            <button
              type="button"
              className="pd-v2-add-btn"
              disabled={stockInsufficientForMin}
              onClick={() => onAddToCart(productForCart, quantity)}
            >
              <span className="material-symbols-outlined">shopping_bag</span>
              Add {quantity} to cart • {formatInr(total)}
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
