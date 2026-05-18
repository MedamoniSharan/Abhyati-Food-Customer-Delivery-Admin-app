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

function ProductDetailPageSkeleton() {
  return (
    <div className="product-detail-skeleton-wrap" aria-hidden>
      <div className="product-skeleton-shimmer product-detail-skel-hero" />
      <div className="product-skeleton-shimmer product-detail-skel-line title" />
      <div className="product-skeleton-shimmer product-detail-skel-line short" />
      <div className="product-skeleton-shimmer product-detail-skel-card" />
      <div className="product-skeleton-shimmer product-detail-skel-card" />
    </div>
  )
}

export function ProductDetailsScreen({ product, onBack, onOpenCart, onAddToCart, onBuyNow }: Props) {
  const { showToast } = useToast()
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [detailLoading, setDetailLoading] = useState(Boolean(product.zohoItemId))
  const [detailError, setDetailError] = useState<string | null>(null)

  const [quantity, setQuantity] = useState(10)

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

  const minOrder = useMemo(() => zohoMinOrderQuantity(detail), [detail])

  const stockCap = useMemo(() => {
    if (detail) return zohoAvailableStockQuantity(detail)
    if (product.availableStock != null) return product.availableStock
    return null
  }, [detail, product.availableStock])

  const stockInsufficientForMin = stockCap != null && stockCap < minOrder

  useEffect(() => {
    setQuantity((q) => {
      let n = Math.max(minOrder, q)
      if (stockCap != null) n = Math.min(n, stockCap)
      return n
    })
  }, [minOrder, stockCap])

  const displayName =
    detail && detail.name != null && String(detail.name).trim()
      ? String(detail.name).trim()
      : product.name

  const displayRate = detail ? (zohoRateInr(detail) ?? product.priceInr) : product.priceInr
  const unitLabel = detail ? zohoUnitLabel(detail) : 'carton'
  const stockLine = detail ? zohoStockLine(detail) : 'In stock, ready to ship'

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
      ...(stockCap != null ? { availableStock: stockCap } : {}),
    }
  }, [product, displayName, displayRate, detail, stockCap])

  function bumpQuantity(delta: 1 | -1) {
    if (stockInsufficientForMin) return
    setQuantity((q) => {
      const next = q + delta
      if (delta > 0 && stockCap != null && next > stockCap) {
        showToast(
          `Available stock is ${stockCap} ${unitLabel}. You can only order up to that amount.`,
          { variant: 'warning' },
        )
        return q
      }
      if (delta < 0) return Math.max(minOrder, next)
      return next
    })
  }

  const showBootstrapLoader = detailLoading && Boolean(product.zohoItemId)

  return (
    <>
      <header className="top-header light-header">
        <div className="header-row centered-title">
          <button type="button" className="icon-btn" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>Product Details</h1>
          <button type="button" className="icon-btn with-dot" onClick={onOpenCart}>
            <span className="material-symbols-outlined">shopping_cart</span>
          </button>
        </div>
      </header>

      {showBootstrapLoader ? (
        <main className="content product-content product-detail-loading-main">
          <CatalogLoader label="Loading product details…" />
          <ProductDetailPageSkeleton />
        </main>
      ) : (
        <main className="content product-content">
          <section className="gallery">
            <div className="hero-image">
              <ProductImage product={product} />
              {product.badge ? (
                <span className={`hero-tag hero-tag-${product.badge.tone}`}>{product.badge.label}</span>
              ) : null}
            </div>
          </section>

          <section className="product-heading">
            <h2>{displayName}</h2>
            <div className="unit-price">
              <strong>{formatInr(displayRate)}</strong>
              <span> / {unitLabel}</span>
            </div>
            <p className="stock">
              {detailError ? detailError : stockLine}
            </p>
          </section>

          <section className="details-card">
            <p className="label">Bulk Quantity ({unitLabel})</p>
            <div className="quantity-row">
              <div className="quantity-box">
                <button
                  type="button"
                  className="counter-btn"
                  disabled={stockInsufficientForMin || quantity <= minOrder}
                  onClick={() => bumpQuantity(-1)}
                >
                  <span className="material-symbols-outlined">remove</span>
                </button>
                <span>{quantity}</span>
                <button
                  type="button"
                  className="counter-btn"
                  disabled={stockInsufficientForMin}
                  onClick={() => bumpQuantity(1)}
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
              <div className="total-wrap">
                <small>Total Price</small>
                <strong>{formatInr(total)}</strong>
              </div>
            </div>
            <p className="min-order">
              Min. order: {minOrder} {unitLabel}
            </p>
            {stockInsufficientForMin ? (
              <p className="stock-cap-warning" role="alert">
                Available stock ({stockCap} {unitLabel}) is below the minimum order. This item cannot be ordered
                right now.
              </p>
            ) : stockCap != null ? (
              <p className="stock-cap-hint">You can order up to {stockCap} {unitLabel} (available stock).</p>
            ) : null}
          </section>

          <section className="details-card">
            <h3>Specifications</h3>
            {specRows.length === 0 ? (
              <p className="product-detail-placeholder">No specifications listed for this item.</p>
            ) : (
              <div className="spec-grid">
                {specRows.map((row, index) => (
                  <div key={`${index}-${row.label}`}>
                    <small>{row.label}</small>
                    <p className={row.label === 'Description' ? 'spec-value-multiline' : undefined}>{row.value}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="product-actions" aria-label="Purchase">
            <button
              type="button"
              className="btn btn-outline"
              disabled={stockInsufficientForMin}
              onClick={() => onAddToCart(productForCart, quantity)}
            >
              <span className="material-symbols-outlined">add_shopping_cart</span>
              Add to Cart
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={stockInsufficientForMin}
              onClick={() => onBuyNow(productForCart, quantity)}
            >
              <span className="material-symbols-outlined">bolt</span>
              Buy Now
            </button>
          </section>
        </main>
      )}
    </>
  )
}
