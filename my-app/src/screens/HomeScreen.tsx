import { useEffect, useRef, useState } from 'react'
import { NotificationsBell } from '../contexts/NotificationsContext'
import type { Product } from '../types/app'
import { CatalogLoader } from '../components/CatalogLoader'
import { ProductCard } from '../components/ProductCard'
import { ProductGridSkeleton } from '../components/ProductGridSkeleton'

type Props = {
  customerName: string
  categories: string[]
  products: Product[]
  category: string
  query: string
  onCategoryChange: (category: string) => void
  onQueryChange: (value: string) => void
  onOpenProduct: (product: Product) => void
  onAddToCart: (product: Product) => void
  cartCount?: number
  onOpenCart?: () => void
  isMenuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  onNavigateMenu: (target: 'home' | 'orders' | 'cart' | 'account') => void
  hasMoreCatalog: boolean
  loadingMoreCatalog: boolean
  onLoadMoreCatalog: () => void
  catalogBootstrapping: boolean
  /** Soft refresh (e.g. category change) while previous products are still on screen. */
  catalogRefreshing?: boolean
}

export function HomeScreen({
  customerName,
  categories,
  products,
  category,
  query,
  onCategoryChange,
  onQueryChange,
  onOpenProduct,
  onAddToCart,
  cartCount = 0,
  onOpenCart,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onNavigateMenu,
  hasMoreCatalog,
  loadingMoreCatalog,
  onLoadMoreCatalog,
  catalogBootstrapping,
  catalogRefreshing = false,
}: Props) {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  useEffect(() => {
    if (!hasMoreCatalog || catalogBootstrapping) return
    const node = loadMoreSentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry?.isIntersecting && hasMoreCatalog && !loadingMoreCatalog) {
          onLoadMoreCatalog()
        }
      },
      { root: null, rootMargin: '120px', threshold: 0 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMoreCatalog, loadingMoreCatalog, onLoadMoreCatalog, catalogBootstrapping])

  return (
    <>
      <header className="top-header home-header">
        <div className="header-row hero-top-row">
          <button type="button" className="profile-btn" onClick={onToggleMenu} aria-label="Open profile menu">
            <img src="/app-logo.png" alt="Abhyati profile" className="hero-profile-avatar" />
          </button>
          <div className="hero-location">
            {customerName ? (
              <>
                <p>Signed in</p>
                <h1 title={customerName}>{customerName}</h1>
                <p className="hero-location-sub">Delivery set at checkout</p>
              </>
            ) : (
              <>
                <p>Delivery location</p>
                <h1>Set at checkout</h1>
              </>
            )}
          </div>
          <div className="header-actions">
            <NotificationsBell dark />
            {onOpenCart ? (
              <button
                type="button"
                className={`icon-btn icon-btn-dark${cartCount > 0 ? ' with-dot' : ''}`}
                aria-label={cartCount > 0 ? `Open cart, ${cartCount} items` : 'Open cart'}
                onClick={onOpenCart}
              >
                <span className="material-symbols-outlined">shopping_cart</span>
                {cartCount > 0 ? (
                  <span className="cart-icon-badge">{cartCount > 99 ? '99+' : cartCount}</span>
                ) : null}
              </button>
            ) : null}
          </div>
        </div>
        <div className="hero-copy">
          <h2>
            <span className="hero-title-line">Wholesale delivery</span>
            <span className="hero-title-line">for restaurants &amp; dealers</span>
          </h2>
        </div>
        <label className="search-bar">
          <span className="material-symbols-outlined">search</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search products, SKUs, or categories"
          />
          <button
            type="button"
            aria-label="Open filters"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(true)}
          >
            <span className="material-symbols-outlined">tune</span>
          </button>
        </label>
      </header>

      <div
        className={filterOpen ? 'home-filter-backdrop open' : 'home-filter-backdrop'}
        onClick={() => setFilterOpen(false)}
        role="presentation"
      />
      <aside className={filterOpen ? 'home-filter-sheet open' : 'home-filter-sheet'} aria-hidden={!filterOpen}>
        <div className="home-filter-sheet__head">
          <h3>Categories</h3>
          <button type="button" className="icon-btn" aria-label="Close filters" onClick={() => setFilterOpen(false)}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="home-filter-sheet__hint">Tap a category to filter the catalog.</p>
        <div className="home-filter-sheet__chips">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={item === category ? 'chip active' : 'chip'}
              onClick={() => {
                onCategoryChange(item)
                setFilterOpen(false)
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </aside>

      <div className={isMenuOpen ? 'menu-overlay open' : 'menu-overlay'} onClick={onCloseMenu} />
      <aside className={isMenuOpen ? 'side-menu open' : 'side-menu'}>
        <div className="side-menu-head">
          <img src="/app-logo.png" alt="Abhyati food logo" className="side-menu-logo" />
          <div>
            <h3>Abhyati food</h3>
            <p>Quick Navigation</p>
          </div>
          <button type="button" className="icon-btn" onClick={onCloseMenu}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <nav className="side-menu-links">
          <button type="button" onClick={() => onNavigateMenu('home')}>
            Home
          </button>
          <button type="button" onClick={() => onNavigateMenu('orders')}>
            Orders
          </button>
          <button type="button" onClick={() => onNavigateMenu('cart')}>
            Cart
          </button>
          <button type="button" onClick={() => onNavigateMenu('account')}>
            Account
          </button>
        </nav>
      </aside>

      <main className="content home-content">
        <div className="section-header section-header-single">
          <h2>Bulk Paper Products</h2>
        </div>

        <div className="category-row">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={item === category ? 'chip active' : 'chip'}
              onClick={() => onCategoryChange(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {catalogBootstrapping ? (
          <div className="catalog-bootstrap-wrap">
            <CatalogLoader label="Loading products from catalog…" />
            <ProductGridSkeleton variant="grid" count={8} />
          </div>
        ) : (
          <section className={`product-grid${catalogRefreshing ? ' product-grid--refreshing' : ''}`}>
            {catalogRefreshing ? (
              <div className="catalog-refresh-banner" role="status" aria-live="polite">
                <span className="catalog-loader-spinner catalog-loader-spinner-sm" aria-hidden />
                Updating products…
              </div>
            ) : null}
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onOpenProduct={onOpenProduct}
                onAddToCart={onAddToCart}
              />
            ))}
          </section>
        )}

        {hasMoreCatalog && !catalogBootstrapping ? (
          <div ref={loadMoreSentinelRef} className="infinite-scroll-sentinel" aria-hidden />
        ) : null}

        {loadingMoreCatalog ? (
          <div className="catalog-load-more">
            <div className="catalog-loader-inline" role="status" aria-live="polite" aria-busy="true">
              <span className="catalog-loader-spinner catalog-loader-spinner-sm" aria-hidden />
              <span className="catalog-loader-inline-text">Loading more products…</span>
            </div>
            <ProductGridSkeleton variant="inline" count={2} />
          </div>
        ) : null}

        {!catalogBootstrapping && !catalogRefreshing && products.length === 0 ? (
          <div className="empty-state">
            <h3>No products found</h3>
            <p>Try another keyword or category filter, or check back when new stock is listed.</p>
          </div>
        ) : null}
      </main>
    </>
  )
}
