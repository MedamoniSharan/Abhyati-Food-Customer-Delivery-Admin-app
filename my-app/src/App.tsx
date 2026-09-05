import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { BottomNav } from './components/BottomNav'
import { PullToRefresh } from './components/PullToRefresh'
import { useToast } from './contexts/ToastContext'
import { SettingsScreen } from './screens/SettingsScreen'
import { AuthScreen } from './screens/AuthScreen'
import { AccountScreen } from './screens/AccountScreen'
import { CartScreen, type CheckoutPaymentMode } from './screens/CartScreen'
import { HomeScreen } from './screens/HomeScreen'
import { OrderDetailsScreen } from './screens/OrderDetailsScreen'
import { OrdersScreen } from './screens/OrdersScreen'
import { ProductDetailsScreen } from './screens/ProductDetailsScreen'
import type { CartItem, Order, Product, Screen } from './types/app'
import { createCustomerOrder, downloadOrderProof, fetchCustomerProductCategories, fetchZohoItemsPage, getBackendOrders, mapBackendOrderResponse } from './services/backendApi'
import { createRazorpayOrder, verifyRazorpayPayment } from './services/paymentApi'
import { openRazorpayCheckout } from './utils/razorpayCheckout'
import { fetchAuthMe } from './services/authApi'
import type { AuthUser } from './services/authApi'
import { checkBackendReachable } from './utils/backendHealth'
import { getCheckoutProfileGaps } from './utils/checkoutProfile'
import { clearSignedIn, readAuthToken, readSessionUser, readSignedIn, writeSignedIn } from './utils/authSession'
import { matchOrderToProduct } from './utils/orders'

function App() {
  const { showToast } = useToast()
  const [screen, setScreen] = useState<Screen>('home')
  const screenHistoryRef = useRef<Screen[]>([])
  const [isAuthenticated, setIsAuthenticated] = useState(readSignedIn)
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(() => (readSignedIn() ? readSessionUser() : null))
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [serverCategoryNames, setServerCategoryNames] = useState<string[]>([])
  /** Keep last known product-derived categories so chips don't vanish while a page reloads. */
  const [cachedProductCategoryNames, setCachedProductCategoryNames] = useState<string[]>([])
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([])
  const [orderHistory, setOrderHistory] = useState<Order[]>([])
  const [ordersLoadError, setOrdersLoadError] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('All Items')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [nextItemsPage, setNextItemsPage] = useState(1)
  const [hasMoreCatalogItems, setHasMoreCatalogItems] = useState(true)
  /** True while restoring session so home can show bootstrap loader before first Zoho fetch. */
  const [loadingCatalog, setLoadingCatalog] = useState(readSignedIn)
  const [catalogHardReloading, setCatalogHardReloading] = useState(false)
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null)
  const [serverCategoriesConfigured, setServerCategoriesConfigured] = useState(false)
  const catalogFetchLock = useRef(false)
  const catalogFetchGeneration = useRef(0)
  const checkoutInFlightRef = useRef(false)
  const serverCategoriesConfiguredRef = useRef(false)

  useEffect(() => {
    document.body.dataset.toastLayout = isAuthenticated ? 'main' : 'auth'
  }, [isAuthenticated])

  useEffect(() => {
    let cancelled = false
    void checkBackendReachable().then((ok) => {
      if (!cancelled) setBackendReachable(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!readSignedIn()) return
    const token = readAuthToken()
    if (!token) {
      clearSignedIn()
      setSessionUser(null)
      setIsAuthenticated(false)
      return
    }
    let cancelled = false
    void fetchAuthMe(token).then((user) => {
      if (cancelled) return
      if (!user) {
        clearSignedIn()
        setSessionUser(null)
        setIsAuthenticated(false)
        showToast('Your session expired or the account was removed.', { variant: 'info' })
        return
      }
      writeSignedIn(user, token)
      setSessionUser(user)
      setIsAuthenticated(true)
    })
    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    if (!isAuthenticated) {
      setServerCategoryNames([])
      setCachedProductCategoryNames([])
      setServerCategoriesConfigured(false)
      return
    }
    let cancelled = false
    void fetchCustomerProductCategories().then(({ configured, categories }) => {
      if (cancelled) return
      setServerCategoriesConfigured(Boolean(configured))
      serverCategoriesConfiguredRef.current = Boolean(configured)
      if (configured && categories.length > 0) {
        setServerCategoryNames(
          categories.map((c) => String(c.name || '').trim()).filter((n) => n.length > 0)
        )
      } else {
        setServerCategoryNames([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setSessionUser(null)
      return
    }
    setSessionUser(readSessionUser())
  }, [isAuthenticated, screen])

  const refreshOrderHistory = useCallback(async () => {
    if (!readAuthToken()) return
    const { orders, error } = await getBackendOrders()
    setOrderHistory(orders)
    setOrdersLoadError(error)
  }, [])

  function prependPlacedOrder(order: Order | null) {
    if (!order?.id) return
    setOrderHistory((prev) => {
      const rest = prev.filter((o) => o.id !== order.id)
      return [order, ...rest]
    })
    setOrdersLoadError(null)
  }

  const handlePullRefresh = useCallback(async () => {
    const token = readAuthToken()
    if (!token) return
    try {
      const user = await fetchAuthMe(token)
      if (user) {
        writeSignedIn(user, token)
        setSessionUser(user)
      }
      const { configured, categories } = await fetchCustomerProductCategories()
      setServerCategoriesConfigured(Boolean(configured))
      serverCategoriesConfiguredRef.current = Boolean(configured)
      if (configured && categories.length > 0) {
        setServerCategoryNames(
          categories.map((c) => String(c.name || '').trim()).filter((n) => n.length > 0)
        )
      } else {
        setServerCategoryNames([])
      }
      catalogFetchLock.current = true
      setLoadingCatalog(true)
      setCatalogHardReloading(true)
      try {
        const useServerCategory =
          serverCategoriesConfiguredRef.current && selectedCategory !== 'All Items'
        const catOpt = useServerCategory ? selectedCategory : undefined
        const { products: firstPage, hasMore } = await fetchZohoItemsPage(1, 20, { categoryName: catOpt })
        setCatalogProducts(firstPage)
        setHasMoreCatalogItems(hasMore)
        setNextItemsPage(2)
        if (firstPage.length > 0) {
          setSelectedProduct((current) =>
            current && firstPage.some((p) => p.id === current.id) ? current : firstPage[0]
          )
        } else {
          setSelectedProduct(null)
        }
      } finally {
        catalogFetchLock.current = false
        setLoadingCatalog(false)
        setCatalogHardReloading(false)
      }
      await refreshOrderHistory()
      showToast('Refreshed', { variant: 'success' })
    } catch {
      showToast('Could not refresh. Try again.', { variant: 'error' })
    }
  }, [refreshOrderHistory, selectedCategory, showToast])

  const mergeDedupeProducts = useCallback((existing: Product[], incoming: Product[]) => {
    const seen = new Set(existing.map((p) => p.id))
    const out = [...existing]
    for (const p of incoming) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        out.push(p)
      }
    }
    return out
  }, [])

  const loadCatalogPage = useCallback(async () => {
    if (catalogFetchLock.current || !hasMoreCatalogItems) return
    const generation = catalogFetchGeneration.current
    catalogFetchLock.current = true
    setLoadingCatalog(true)
    try {
      const page = nextItemsPage
      const useServerCategory =
        serverCategoriesConfiguredRef.current && selectedCategory !== 'All Items'
      const catOpt = useServerCategory ? selectedCategory : undefined
      const { products, hasMore } = await fetchZohoItemsPage(page, 20, { categoryName: catOpt })
      if (generation !== catalogFetchGeneration.current) return
      setCatalogProducts((prev) => {
        const merged = mergeDedupeProducts(prev, products)
        if (merged.length > 0) {
          setSelectedProduct((current) =>
            current && merged.some((p) => p.id === current.id) ? current : merged[0],
          )
        } else {
          setSelectedProduct(null)
        }
        return merged
      })
      setHasMoreCatalogItems(hasMore)
      setNextItemsPage(page + 1)
    } catch {
      if (generation === catalogFetchGeneration.current) {
        showToast('Unable to load products. Try again.', { variant: 'error' })
      }
    } finally {
      if (generation === catalogFetchGeneration.current) {
        catalogFetchLock.current = false
        setLoadingCatalog(false)
      }
    }
  }, [hasMoreCatalogItems, mergeDedupeProducts, nextItemsPage, selectedCategory, showToast])

  /** Zoho Books items require a customer JWT. Reload when sign-in or category filter changes. */
  useEffect(() => {
    if (!isAuthenticated) return
    const generation = ++catalogFetchGeneration.current
    let cancelled = false
    catalogFetchLock.current = true
    setLoadingCatalog(true)
    setCatalogHardReloading(true)
    // Keep previous products visible while fetching to avoid empty flash / category chip collapse.
    setNextItemsPage(1)
    setHasMoreCatalogItems(true)
    const useServerCategory =
      serverCategoriesConfiguredRef.current && selectedCategory !== 'All Items'
    const catOpt = useServerCategory ? selectedCategory : undefined
    void (async () => {
      try {
        const { products: firstPage, hasMore } = await fetchZohoItemsPage(1, 20, { categoryName: catOpt })
        if (cancelled || generation !== catalogFetchGeneration.current) return
        setCatalogProducts(firstPage)
        setHasMoreCatalogItems(hasMore)
        setNextItemsPage(2)
        if (firstPage.length > 0) {
          setSelectedProduct((current) =>
            current && firstPage.some((p) => p.id === current.id) ? current : firstPage[0],
          )
        } else {
          setSelectedProduct(null)
        }
      } catch {
        if (!cancelled && generation === catalogFetchGeneration.current) {
          showToast('Unable to load products. Check your connection and try again.', { variant: 'error' })
          setCatalogProducts([])
          setSelectedProduct(null)
          setHasMoreCatalogItems(false)
        }
      } finally {
        if (!cancelled && generation === catalogFetchGeneration.current) {
          catalogFetchLock.current = false
          setLoadingCatalog(false)
          setCatalogHardReloading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      // Do not flip loadingCatalog off here — a newer generation owns the spinner.
    }
  }, [isAuthenticated, selectedCategory, showToast])

  useEffect(() => {
    if (!isAuthenticated) return
    void refreshOrderHistory()
  }, [isAuthenticated, refreshOrderHistory])

  useEffect(() => {
    if (!isAuthenticated || screen !== 'orders') return
    void refreshOrderHistory()
  }, [screen, isAuthenticated, refreshOrderHistory])

  useEffect(() => {
    if (screen !== 'orders') setSelectedOrder(null)
  }, [screen])

  const loadMoreCatalogIfNeeded = useCallback(() => {
    if (!hasMoreCatalogItems) return
    void loadCatalogPage()
  }, [hasMoreCatalogItems, loadCatalogPage])

  const cartCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems])

  const pullToRefreshEnabled =
    screen !== 'product' && !(screen === 'orders' && selectedOrder != null)

  const visibleProducts = useMemo(() => {
    const catalogHasZohoItems = catalogProducts.some((p) => p.zohoItemId)
    const serverFiltered = serverCategoriesConfigured && selectedCategory !== 'All Items'
    return catalogProducts.filter((product) => {
      if (catalogHasZohoItems && !product.zohoItemId) return false
      const matchCategory = serverFiltered
        ? true
        : selectedCategory === 'All Items' ||
          product.category.toLowerCase() === String(selectedCategory).toLowerCase()
      const term = searchQuery.trim().toLowerCase()
      const matchQuery =
        term.length === 0 ||
        product.name.toLowerCase().includes(term) ||
        product.subtitle.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term)
      return matchCategory && matchQuery
    })
  }, [catalogProducts, searchQuery, selectedCategory, serverCategoriesConfigured])

  const catalogCategories = useMemo(() => {
    if (serverCategoryNames.length > 0) {
      return ['All Items', ...serverCategoryNames.slice().sort((a, b) => a.localeCompare(b))]
    }
    const names = new Set<string>(cachedProductCategoryNames)
    for (const p of catalogProducts) {
      const c = p.category?.trim()
      if (c) names.add(c)
    }
    return ['All Items', ...Array.from(names).sort((a, b) => a.localeCompare(b))]
  }, [catalogProducts, serverCategoryNames, cachedProductCategoryNames])

  useEffect(() => {
    if (serverCategoryNames.length > 0) return
    const names = new Set<string>(cachedProductCategoryNames)
    let changed = false
    for (const p of catalogProducts) {
      const c = p.category?.trim()
      if (c && !names.has(c)) {
        names.add(c)
        changed = true
      }
    }
    if (changed) {
      setCachedProductCategoryNames(Array.from(names).sort((a, b) => a.localeCompare(b)))
    }
  }, [catalogProducts, serverCategoryNames, cachedProductCategoryNames])

  useEffect(() => {
    // Only reset when the selected category is truly gone from a stable list (not during empty bootstrap).
    if (loadingCatalog && catalogProducts.length === 0 && serverCategoryNames.length === 0) return
    if (!catalogCategories.includes(selectedCategory)) {
      setSelectedCategory('All Items')
    }
  }, [catalogCategories, selectedCategory, loadingCatalog, catalogProducts.length, serverCategoryNames.length])

  useEffect(() => {
    if (screen === 'product' && !selectedProduct) {
      setScreen('home')
    }
  }, [screen, selectedProduct])

  function defaultAddQuantity(product: Product): number {
    return product.minPurchaseCount ?? 1
  }

  function addToCart(product: Product, quantity = defaultAddQuantity(product)) {
    const cap = product.availableStock
    if (cap != null) {
      const existing = cartItems.find((item) => item.product.id === product.id)
      const nextTotal = (existing?.quantity ?? 0) + quantity
      if (nextTotal > cap) {
        showToast(
          `Available stock is ${cap}. You can only order up to that amount.`,
          { variant: 'warning' },
        )
        return
      }
    }
    setCartItems((current) => {
      const itemIndex = current.findIndex((item) => item.product.id === product.id)
      if (itemIndex === -1) return [...current, { product, quantity }]

      return current.map((item, index) =>
        index === itemIndex
          ? {
              ...item,
              product: { ...item.product, ...product },
              quantity: item.quantity + quantity,
            }
          : item,
      )
    })
    showToast(`${product.name} added to cart`, { variant: 'success' })
  }

  function updateCartQuantity(productId: string | number, type: 'increase' | 'decrease') {
    const line = cartItems.find((item) => item.product.id === productId)
    if (!line) return
    const cap = line.product.availableStock
    const minQty = line.product.minPurchaseCount ?? 1
    if (type === 'increase' && cap != null && line.quantity + 1 > cap) {
      showToast(`Available stock is ${cap}. You can only order up to that amount.`, { variant: 'warning' })
      return
    }
    // At (or below) MOQ, minus removes the line — same as Delete.
    if (type === 'decrease' && line.quantity <= minQty) {
      setCartItems((current) => current.filter((item) => item.product.id !== productId))
      showToast(`${line.product.name} removed from cart`, { variant: 'info' })
      return
    }
    setCartItems((current) =>
      current.map((item) => {
        if (item.product.id !== productId) return item
        const nextQty = type === 'increase' ? item.quantity + 1 : Math.max(minQty, item.quantity - 1)
        return { ...item, quantity: nextQty }
      }),
    )
  }

  function removeFromCart(productId: string | number) {
    const line = cartItems.find((item) => item.product.id === productId)
    setCartItems((current) => current.filter((item) => item.product.id !== productId))
    if (line) showToast(`${line.product.name} removed from cart`, { variant: 'info' })
  }

  function navigateTo(target: Screen, options?: { replace?: boolean }) {
    if (options?.replace) {
      setScreen(target)
      return
    }
    if (screen !== target) {
      screenHistoryRef.current = [...screenHistoryRef.current, screen]
    }
    setScreen(target)
  }

  function goBack(fallback: Screen = 'home') {
    const prev = screenHistoryRef.current
    if (prev.length === 0) {
      setScreen(fallback)
      return
    }
    const previous = prev[prev.length - 1] ?? fallback
    screenHistoryRef.current = prev.slice(0, -1)
    setScreen(previous)
  }

  function openProduct(product: Product) {
    setSelectedProduct(product)
    navigateTo('product')
  }

  function navigateFromMenu(target: 'home' | 'orders' | 'cart' | 'account') {
    screenHistoryRef.current = []
    setScreen(target)
    setIsMenuOpen(false)
  }

  function handleBuyNow(product: Product, quantity: number) {
    addToCart(product, quantity)
    navigateTo('cart')
    showToast('Proceeding to checkout', { variant: 'info' })
  }

  function handleQuickAddFromOrder(order: Order) {
    const match = matchOrderToProduct(order, catalogProducts)
    if (!match) return
    addToCart(match, defaultAddQuantity(match))
    navigateTo('cart')
  }

  async function handleCheckout(mode: CheckoutPaymentMode = 'pay_later') {
    if (checkoutInFlightRef.current || checkoutBusy) return
    if (cartItems.length === 0) {
      showToast('Your cart is empty. Add items before checkout.', { variant: 'warning' })
      return
    }
    const missingZoho = cartItems.filter((line) => !line.product.zohoItemId)
    if (missingZoho.length > 0) {
      showToast('Some cart items are missing catalog ids. Remove them and add again from Home.', {
        variant: 'error',
      })
      return
    }
    const token = readAuthToken()
    if (!token) {
      showToast('Please sign in again to place your order.', { variant: 'warning' })
      return
    }
    const freshUser = await fetchAuthMe(token)
    if (!freshUser) {
      clearSignedIn()
      setIsAuthenticated(false)
      showToast('Your session expired. Please sign in again.', { variant: 'info' })
      return
    }
    writeSignedIn(freshUser, token)
    setSessionUser(freshUser)
    const gaps = getCheckoutProfileGaps(freshUser)
    if (gaps.length > 0) {
      const list =
        gaps.length === 1 ? gaps[0] : `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1] ?? ''}`
      showToast(`Add ${list} in Account settings before checkout.`, { variant: 'warning' })
      screenHistoryRef.current = []
      setScreen('settings')
      return
    }

    const lineItems = cartItems.map((line) => ({
      item_id: line.product.zohoItemId,
      name: line.product.name,
      description: line.product.subtitle,
      quantity: line.quantity,
      rate: Number(line.product.priceInr) || 0
    }))
    const referenceNumber = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    checkoutInFlightRef.current = true
    setCheckoutBusy(true)
    try {
      if (mode === 'pay_later') {
        const placed = await createCustomerOrder(lineItems, { referenceNumber })
        setCartItems([])
        prependPlacedOrder(placed)
        await refreshOrderHistory()
        setScreen('orders')
        showToast('Order placed successfully and synced to admin.', { variant: 'success' })
        return
      }

      const rzpOrder = await createRazorpayOrder(lineItems)
      const paymentResult = await openRazorpayCheckout({
        keyId: rzpOrder.key_id,
        orderId: rzpOrder.order_id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        user: freshUser
      })
      try {
        const verifyResult = await verifyRazorpayPayment({
          razorpay_order_id: paymentResult.razorpay_order_id,
          razorpay_payment_id: paymentResult.razorpay_payment_id,
          razorpay_signature: paymentResult.razorpay_signature
        })
        setCartItems([])
        prependPlacedOrder(mapBackendOrderResponse(verifyResult.order))
        await refreshOrderHistory()
        setScreen('orders')
        showToast('Payment successful. Order placed and synced to admin.', { variant: 'success' })
      } catch (verifyError) {
        await refreshOrderHistory()
        const verifyMessage =
          verifyError instanceof Error ? verifyError.message : 'Payment verification failed'
        if (verifyMessage.toLowerCase().includes('already processed')) {
          setCartItems([])
          setScreen('orders')
          showToast('Payment successful. Order placed and synced to admin.', { variant: 'success' })
        } else {
          showToast(
            `${verifyMessage}. Your payment may have succeeded — check Orders or contact support.`,
            { variant: 'warning' },
          )
        }
      }
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Checkout failed. Please try again.'
      if (message !== 'Payment cancelled') {
        showToast(message, { variant: 'error' })
      }
    } finally {
      checkoutInFlightRef.current = false
      setCheckoutBusy(false)
    }
  }

  function renderScreen() {
    if (screen === 'home') {
      return (
        <HomeScreen
          customerName={sessionUser?.fullName?.trim() ?? ''}
          categories={catalogCategories}
          products={visibleProducts}
          category={selectedCategory}
          query={searchQuery}
          onCategoryChange={setSelectedCategory}
          onQueryChange={setSearchQuery}
          onOpenProduct={openProduct}
          onAddToCart={(product) => addToCart(product, defaultAddQuantity(product))}
          cartCount={cartCount}
          onOpenCart={() => navigateTo('cart')}
          isMenuOpen={isMenuOpen}
          onToggleMenu={() => setIsMenuOpen((prev) => !prev)}
          onCloseMenu={() => setIsMenuOpen(false)}
          onNavigateMenu={navigateFromMenu}
          hasMoreCatalog={hasMoreCatalogItems}
          loadingMoreCatalog={loadingCatalog && catalogProducts.length > 0 && !catalogHardReloading}
          onLoadMoreCatalog={loadMoreCatalogIfNeeded}
          catalogBootstrapping={loadingCatalog && catalogProducts.length === 0}
          catalogRefreshing={catalogHardReloading && catalogProducts.length > 0}
        />
      )
    }

    if (screen === 'product') {
      if (!selectedProduct) return null
      return (
        <ProductDetailsScreen
          product={selectedProduct}
          onBack={() => goBack('home')}
          onOpenCart={() => navigateTo('cart')}
          cartCount={cartCount}
          onAddToCart={addToCart}
          onBuyNow={handleBuyNow}
        />
      )
    }

    if (screen === 'orders' && selectedOrder) {
      return (
        <OrderDetailsScreen
          order={selectedOrder}
          onBack={() => {
            setSelectedOrder(null)
            void refreshOrderHistory()
          }}
        />
      )
    }

    if (screen === 'orders') {
      return (
        <OrdersScreen
          orders={orderHistory}
          loadError={ordersLoadError}
          onRetryLoad={() => void refreshOrderHistory()}
          onBackHome={() => {
            setSelectedOrder(null)
            goBack('home')
          }}
          onTrackOrder={(order) => setSelectedOrder(order)}
          onViewDetails={(order) => setSelectedOrder(order)}
          onInvoice={(order) =>
            void (async () => {
              const invoiceId = order.invoiceId || order.id
              const ok = await downloadOrderProof(invoiceId)
              if (ok) {
                showToast(`Invoice proof downloaded for Order #${order.id}`, { variant: 'success' })
              } else {
                showToast('Proof is not available yet for this order.', { variant: 'warning' })
              }
            })()
          }
          onReorder={(order) => handleQuickAddFromOrder(order)}
          onQuickAddFromOrder={handleQuickAddFromOrder}
        />
      )
    }

    if (screen === 'cart') {
      return (
        <CartScreen
          cartItems={cartItems}
          onBackHome={() => goBack('home')}
          onIncrease={(productId) => updateCartQuantity(productId, 'increase')}
          onDecrease={(productId) => updateCartQuantity(productId, 'decrease')}
          onRemove={removeFromCart}
          onCheckout={(mode) => void handleCheckout(mode)}
          checkoutBusy={checkoutBusy}
        />
      )
    }

    if (screen === 'settings') {
      return (
        <SettingsScreen
          user={readSessionUser()}
          onBack={() => goBack('account')}
          onSaved={(nextUser, token) => {
            writeSignedIn(nextUser, token)
            setSessionUser(nextUser)
          }}
          onNotify={(msg, variant) => showToast(msg, { variant: variant ?? 'info' })}
        />
      )
    }

    return (
      <AccountScreen
        user={readSessionUser()}
        onNavigateOrders={() => navigateTo('orders')}
        onOpenSettings={() => navigateTo('settings')}
        onOpenAddresses={() => []}
        onOpenPayments={() => []}
        onLogout={() => {
          clearSignedIn()
          setSessionUser(null)
          setIsAuthenticated(false)
          setCartItems([])
          setOrderHistory([])
          setCatalogProducts([])
          setCachedProductCategoryNames([])
          setServerCategoryNames([])
          setServerCategoriesConfigured(false)
          serverCategoriesConfiguredRef.current = false
          setNextItemsPage(1)
          setHasMoreCatalogItems(true)
          setSelectedProduct(null)
          setSearchQuery('')
          setSelectedCategory('All Items')
          setScreen('home')
          showToast('Logged out successfully', { variant: 'success' })
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      {backendReachable === false ? (
        <div className="api-offline-banner" role="status">
          Cannot reach the server. Check your connection or try again later.
        </div>
      ) : null}
      {!isAuthenticated ? (
        <AuthScreen
          onAuthenticated={({ message, user, token }) => {
            writeSignedIn(user, token)
            setSessionUser(user)
            setIsAuthenticated(true)
            showToast(message, { variant: 'success' })
          }}
        />
      ) : (
        <NotificationsProvider enabled={isAuthenticated}>
          <div className="phone-frame">
            <PullToRefresh onRefresh={handlePullRefresh} disabled={!pullToRefreshEnabled}>
              {renderScreen()}
            </PullToRefresh>
          </div>
          <BottomNav
            screen={screen}
            cartCount={cartCount}
            onChange={(target) => {
              screenHistoryRef.current = []
              setScreen(target)
            }}
          />
        </NotificationsProvider>
      )}
    </div>
  )
}

export default App
