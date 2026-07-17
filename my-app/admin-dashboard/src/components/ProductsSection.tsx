import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminFetch, adminUploadItemImage } from '../adminApi'
import { AdminBusyOverlay, AdminInlineSpinner } from './AdminDataLoader'
import { IconDeleteButton, IconEditButton } from './AdminIconButtons'
import { useToast } from './Toast'
import { itemImageUrl, type ZohoItemRow } from '../productImage'

type ProductCat = { id: string; name: string }

type PageCtx = {
  page?: number
  per_page?: number
  has_more_page?: boolean
}

type CategoryCoverageReport = {
  configured?: boolean
  scanned_count?: number
  detail_fetch_rows?: number
  by_display_category?: Record<string, number>
  unknown_cf_value_count?: number
  unknown_cf_items?: { item_id?: unknown; name?: unknown; product_category_name?: string }[]
}

const PER_PAGE_OPTIONS = [12, 24, 48, 96] as const

const STOCK_KEYS = ['stock_on_hand', 'available_stock', 'actual_available_stock', 'opening_stock'] as const

const PRODUCT_TYPE_OPTIONS = ['goods', 'service', 'digital_service'] as const
const PRODUCT_STATUS_OPTIONS = ['active', 'inactive'] as const

type BulkRowDraft = {
  name: string
  customer_product_name: string
  product_category_id: string
  sku: string
  product_type: string
  status: string
  rate: string
  stock: string
  min_purchase_count: string
  description: string
  unit: string
}

function resolveCategoryIdFromItem(it: ZohoItemRow): string {
  const raw = (it as Record<string, unknown>).product_category_id
  return typeof raw === 'string' ? raw.trim() : ''
}

function itemToBulkDraft(it: ZohoItemRow): BulkRowDraft {
  const stock = readItemStock(it)
  const mpc = it.min_purchase_count
  return {
    name: String(it.name ?? ''),
    customer_product_name: typeof it.customer_product_name === 'string' ? it.customer_product_name : '',
    product_category_id: resolveCategoryIdFromItem(it),
    sku: String(it.sku ?? ''),
    product_type: String(it.product_type ?? 'goods'),
    status: String(it.status ?? 'active'),
    rate: it.rate != null && it.rate !== '' ? String(it.rate) : '',
    stock: stock != null ? String(stock) : '',
    min_purchase_count: mpc != null && mpc !== '' ? String(mpc) : '',
    description: String(it.description ?? ''),
    unit: it.unit != null && String(it.unit).trim() ? String(it.unit).trim() : ''
  }
}

function bulkDraftsEqual(a: BulkRowDraft, b: BulkRowDraft): boolean {
  return (
    a.name === b.name &&
    a.customer_product_name === b.customer_product_name &&
    a.product_category_id === b.product_category_id &&
    a.sku === b.sku &&
    a.product_type === b.product_type &&
    a.status === b.status &&
    a.rate === b.rate &&
    a.stock === b.stock &&
    a.min_purchase_count === b.min_purchase_count &&
    a.description === b.description &&
    a.unit === b.unit
  )
}

function buildBulkSavePayload(
  original: BulkRowDraft,
  draft: BulkRowDraft,
  categoriesConfigured: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (draft.customer_product_name !== original.customer_product_name) {
    payload.customer_product_name = draft.customer_product_name.trim()
  }
  if (draft.name.trim() !== original.name.trim()) {
    payload.name = draft.name.trim()
  }
  if (categoriesConfigured && draft.product_category_id !== original.product_category_id) {
    payload.product_category_id = draft.product_category_id.trim()
  }
  if (draft.sku !== original.sku) {
    payload.sku = draft.sku || undefined
  }
  if (draft.product_type !== original.product_type) {
    payload.product_type = draft.product_type
  }
  if (draft.status !== original.status) {
    payload.status = draft.status
  }
  if (draft.rate !== original.rate) {
    const rateNum = Number(draft.rate.trim())
    if (!Number.isFinite(rateNum)) {
      throw new Error('Enter a valid price (rate)')
    }
    payload.rate = rateNum
  }
  if (draft.stock !== original.stock) {
    if (draft.stock.trim() !== '') {
      const sq = Number(draft.stock.trim())
      if (!Number.isFinite(sq) || sq < 0) {
        throw new Error('Enter a valid stock quantity (0 or greater)')
      }
      payload.stock_on_hand = sq
    }
  }
  if (draft.min_purchase_count !== original.min_purchase_count) {
    if (draft.min_purchase_count.trim() === '') {
      payload.min_purchase_count = ''
    } else {
      const mq = Number(draft.min_purchase_count.trim())
      if (!Number.isFinite(mq) || mq < 1 || !Number.isInteger(mq)) {
        throw new Error('Min purchase count must be a whole number of 1 or greater')
      }
      payload.min_purchase_count = mq
    }
  }
  if (draft.description !== original.description) {
    payload.description = draft.description || undefined
  }
  if (draft.unit !== original.unit && draft.unit.trim()) {
    payload.unit = draft.unit.trim()
  }
  return payload
}

/** Zoho list/detail rows should include `item_id`; if not, save must not silently no-op. */
function resolveItemId(item: ZohoItemRow | null | undefined): string {
  if (!item) return ''
  const raw = item.item_id
  if (raw == null) return ''
  const id = String(raw).trim()
  return id
}

/** Zoho item GET/PUT responses are usually `{ item: {...} }`; accept a bare item object too. */
function extractZohoItemFromItemResponse(data: unknown): ZohoItemRow | undefined {
  if (!data || typeof data !== 'object') return undefined
  const o = data as Record<string, unknown>
  const nested = o.item
  if (nested && typeof nested === 'object') return nested as ZohoItemRow
  if (o.item_id != null || typeof o.name === 'string' || 'rate' in o) return o as ZohoItemRow
  return undefined
}

function readItemStock(item: ZohoItemRow | null | undefined): number | null {
  if (!item) return null
  for (const key of STOCK_KEYS) {
    const raw = item[key]
    // Zoho list/detail often uses "" or null for unused top-level qty fields; Number('')/Number(null) === 0 would fake "out of stock".
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  const locs = item.locations
  if (Array.isArray(locs)) {
    let fallback: number | null = null
    for (const loc of locs) {
      if (!loc || typeof loc !== 'object') continue
      const rec = loc as Record<string, unknown>
      for (const field of ['location_actual_available_stock', 'location_available_stock', 'location_stock_on_hand'] as const) {
        const raw = rec[field]
        if (raw === '' || raw == null) continue
        const n = Number(raw)
        if (!Number.isFinite(n)) continue
        if (rec.is_primary === true || rec.is_primary === 'true') return n
        if (fallback === null) fallback = n
      }
    }
    if (fallback !== null) return fallback
  }
  return null
}

function ItemThumb({ itemId, label, cacheBust }: { itemId: string; label: string; cacheBust?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [itemId, cacheBust])
  if (!itemId || failed) {
    return (
      <div className="admin-item-thumb admin-item-thumb--placeholder" aria-hidden>
        <span>{(label || '?').slice(0, 1).toUpperCase()}</span>
      </div>
    )
  }
  return (
    <img
      className="admin-item-thumb"
      src={itemImageUrl(itemId, cacheBust)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function UploadIcon() {
  return (
    <svg className="admin-dropzone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 16V8" />
      <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
      <rect x="3" y="4" width="18" height="16" rx="3" />
    </svg>
  )
}

export function ProductsSection() {
  const { toast } = useToast()
  const [itemCustomerNameFieldConfigured, setItemCustomerNameFieldConfigured] = useState<boolean | null>(null)
  const [itemMinPurchaseFieldConfigured, setItemMinPurchaseFieldConfigured] = useState<boolean | null>(null)
  const [productCategories, setProductCategories] = useState<ProductCat[]>([])
  const [productCategoriesConfigured, setProductCategoriesConfigured] = useState(false)
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(12)
  const [searchInput, setSearchInput] = useState('')
  /** Query sent to Zoho; only updated when the user clicks Search (or presses Enter). */
  const [appliedSearch, setAppliedSearch] = useState('')
  /** Full-catalog scan for rows with no usable image (separate from paginated Zoho list). */
  const [missingPhotosMode, setMissingPhotosMode] = useState(false)
  const [items, setItems] = useState<ZohoItemRow[]>([])
  const [pageCtx, setPageCtx] = useState<PageCtx | null>(null)
  const [missingScanMeta, setMissingScanMeta] = useState<{ scanned: number; missing: number } | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [newProduct, setNewProduct] = useState({
    name: '',
    rate: '',
    sku: '',
    unit: 'unit',
    description: '',
    product_type: 'goods' as 'goods' | 'service' | 'digital_service',
    product_category_id: '',
    min_purchase_count: ''
  })
  const [newProductImage, setNewProductImage] = useState<File | null>(null)
  const [isDraggingNewImage, setIsDraggingNewImage] = useState(false)
  const newProductImageInputRef = useRef<HTMLInputElement>(null)
  const [editingItem, setEditingItem] = useState<ZohoItemRow | null>(null)
  const [editingRate, setEditingRate] = useState('')
  const [editingStock, setEditingStock] = useState('')
  const [editingCustomerProductName, setEditingCustomerProductName] = useState('')
  const [editingMinPurchaseCount, setEditingMinPurchaseCount] = useState('')
  const [editProductImage, setEditProductImage] = useState<File | null>(null)
  const [editImageObjectUrl, setEditImageObjectUrl] = useState<string | null>(null)
  const [isDraggingEditImage, setIsDraggingEditImage] = useState(false)
  const editImageInputRef = useRef<HTMLInputElement>(null)
  const [imageRevByItem, setImageRevByItem] = useState<Record<string, string>>({})
  const [productsSortAsc, setProductsSortAsc] = useState(true)
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, boolean>>({})
  const [bulkEditMode, setBulkEditMode] = useState(false)
  const [bulkEditDraft, setBulkEditDraft] = useState<Record<string, BulkRowDraft>>({})
  const [bulkEditOriginal, setBulkEditOriginal] = useState<Record<string, BulkRowDraft>>({})
  const [bulkEditSaving, setBulkEditSaving] = useState(false)
  const [showAddProductModal, setShowAddProductModal] = useState(false)
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [savingProduct, setSavingProduct] = useState(false)
  /** When true, backend probes Zoho GET …/image so the list matches grey placeholder tiles (slower). */
  const [missingImageVerify, setMissingImageVerify] = useState(false)
  const [categoryScanLoading, setCategoryScanLoading] = useState(false)
  const [categoryScanReport, setCategoryScanReport] = useState<CategoryCoverageReport | null>(null)

  useEffect(() => {
    let cancelled = false
    adminFetch<{ configured?: boolean }>('/api/admin/item-customer-name-field')
      .then((r) => {
        if (!cancelled) setItemCustomerNameFieldConfigured(!!r.configured)
      })
      .catch(() => {
        if (!cancelled) setItemCustomerNameFieldConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    adminFetch<{ configured?: boolean }>('/api/admin/item-min-purchase-field')
      .then((r) => {
        if (!cancelled) setItemMinPurchaseFieldConfigured(!!r.configured)
      })
      .catch(() => {
        if (!cancelled) setItemMinPurchaseFieldConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    adminFetch<{ configured?: boolean; categories?: ProductCat[] }>('/api/admin/product-categories')
      .then((r) => {
        if (cancelled) return
        setProductCategoriesConfigured(!!r.configured)
        setProductCategories(Array.isArray(r.categories) ? r.categories : [])
      })
      .catch(() => {
        if (!cancelled) {
          setProductCategoriesConfigured(false)
          setProductCategories([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setEditProductImage(null)
    setIsDraggingEditImage(false)
    setEditingStock(editingItem ? String(readItemStock(editingItem) ?? '') : '')
    if (!editingItem) {
      setEditingRate('')
      return
    }
    const r = editingItem.rate
    setEditingRate(r != null && r !== '' ? String(r) : '')
  }, [editingItem?.item_id])

  useEffect(() => {
    if (!editingItem) {
      setEditingCustomerProductName('')
      return
    }
    const cpn = editingItem.customer_product_name
    setEditingCustomerProductName(typeof cpn === 'string' ? cpn : '')
  }, [editingItem])

  useEffect(() => {
    if (!editingItem) {
      setEditingMinPurchaseCount('')
      return
    }
    const mpc = editingItem.min_purchase_count
    setEditingMinPurchaseCount(mpc != null && mpc !== '' ? String(mpc) : '')
  }, [editingItem])

  useEffect(() => {
    if (!editingItem) {
      setEditingCategoryId('')
      return
    }
    const raw = (editingItem as Record<string, unknown>).product_category_id
    setEditingCategoryId(typeof raw === 'string' ? raw.trim() : '')
  }, [editingItem])

  useEffect(() => {
    if (!editProductImage) {
      setEditImageObjectUrl(null)
      return
    }
    const url = URL.createObjectURL(editProductImage)
    setEditImageObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [editProductImage])

  const runProductSearch = useCallback(() => {
    setAppliedSearch(searchInput.trim())
    setPage(1)
  }, [searchInput])

  /** List `/items` rows may omit `custom_fields`; load detail so category / customer name save correctly. */
  const openProductEditor = useCallback(async (it: ZohoItemRow) => {
    const id = resolveItemId(it)
    if (!id) {
      setEditingItem(it)
      return
    }
    try {
      const r = await adminFetch<{ item?: ZohoItemRow }>(`/api/admin/items/${encodeURIComponent(id)}`)
      const row = r?.item
      if (row && typeof row === 'object') {
        setEditingItem(row)
        return
      }
    } catch {
      /* use list row if detail fails */
    }
    setEditingItem(it)
  }, [])

  const loadMissingImageReport = useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      const signal = opts?.signal
      setLoadingCatalog(true)
      setCatalogError('')
      setMissingScanMeta(null)
      try {
        const qs = new URLSearchParams()
        if (appliedSearch) qs.set('search_text', appliedSearch)
        qs.set('max_pages', '50')
        if (missingImageVerify) qs.set('verify_image', '1')
        const r = await adminFetch<{
          items?: ZohoItemRow[]
          scanned_count?: number
          missing_count?: number
          verify_image?: boolean
        }>(`/api/admin/items/catalog-missing-images?${qs.toString()}`, signal ? { signal } : {})
        if (signal?.aborted) return
        const list = Array.isArray(r.items) ? r.items : []
        setItems(list)
        setPageCtx(null)
        setMissingScanMeta({
          scanned: typeof r.scanned_count === 'number' ? r.scanned_count : list.length,
          missing: typeof r.missing_count === 'number' ? r.missing_count : list.length
        })
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setCatalogError(e instanceof Error ? e.message : 'Failed to scan catalog')
        setItems([])
        setPageCtx(null)
        setMissingScanMeta(null)
      } finally {
        if (!signal?.aborted) setLoadingCatalog(false)
      }
    },
    [appliedSearch, missingImageVerify]
  )

  const runCategoryCoverageScan = useCallback(async () => {
    if (!productCategoriesConfigured) return
    setCategoryScanLoading(true)
    setCategoryScanReport(null)
    try {
      const qs = new URLSearchParams()
      if (appliedSearch) qs.set('search_text', appliedSearch)
      qs.set('max_pages', '50')
      const r = await adminFetch<CategoryCoverageReport>(
        `/api/admin/items/catalog-product-categories?${qs.toString()}`
      )
      setCategoryScanReport(r && typeof r === 'object' ? r : null)
      if (r?.configured === false) {
        toast('Product categories are not configured on the server', 'info')
      } else {
        toast(`Scanned ${typeof r?.scanned_count === 'number' ? r.scanned_count : 0} catalog rows`, 'info')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Category scan failed', 'error')
      setCategoryScanReport(null)
    } finally {
      setCategoryScanLoading(false)
    }
  }, [productCategoriesConfigured, appliedSearch, toast])

  const loadCatalog = useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      if (missingPhotosMode) return
      const signal = opts?.signal
      setLoadingCatalog(true)
      setCatalogError('')
      setMissingScanMeta(null)
      try {
        const qs = new URLSearchParams()
        qs.set('page', String(page))
        qs.set('per_page', String(perPage))
        if (appliedSearch) qs.set('search_text', appliedSearch)
        const r = await adminFetch<{ items?: ZohoItemRow[]; page_context?: PageCtx }>(
          `/api/admin/items?${qs.toString()}`,
          signal ? { signal } : {}
        )
        if (signal?.aborted) return
        setItems(Array.isArray(r.items) ? r.items : [])
        setPageCtx(r.page_context ?? null)
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setCatalogError(e instanceof Error ? e.message : 'Failed to load items')
        setItems([])
        setPageCtx(null)
      } finally {
        if (!signal?.aborted) setLoadingCatalog(false)
      }
    },
    [page, perPage, appliedSearch, missingPhotosMode]
  )

  useEffect(() => {
    if (missingPhotosMode) return
    const ac = new AbortController()
    void loadCatalog({ signal: ac.signal })
    return () => ac.abort()
  }, [missingPhotosMode, page, perPage, appliedSearch, loadCatalog])

  useEffect(() => {
    if (!missingPhotosMode) return
    const ac = new AbortController()
    void loadMissingImageReport({ signal: ac.signal })
    return () => ac.abort()
  }, [missingPhotosMode, appliedSearch, missingImageVerify, loadMissingImageReport])

  const isMissingImageFilter = missingPhotosMode
  const hasNext = !isMissingImageFilter && pageCtx?.has_more_page === true
  const hasPrev = !isMissingImageFilter && page > 1

  const rangeLabel = useMemo(() => {
    if (isMissingImageFilter) {
      if (loadingCatalog && items.length === 0) return 'Scanning Zoho catalog…'
      const m = missingScanMeta
      if (m) {
        const mode = missingImageVerify ? 'HTTP-checked' : 'metadata'
        return `${m.missing} item(s) without a photo (${mode}) · scanned ${m.scanned} catalog rows`
      }
      return items.length === 0 ? 'No matches' : `${items.length} item(s) without a usable photo`
    }
    const p = pageCtx?.page ?? page
    const pp = pageCtx?.per_page ?? perPage
    if (items.length === 0) return loadingCatalog ? 'Loading…' : 'No items on this page'
    const start = (p - 1) * pp + 1
    const end = (p - 1) * pp + items.length
    return `Showing ${start}–${end}${hasNext ? ' (more on next page)' : ''} · page ${p}`
  }, [isMissingImageFilter, page, pageCtx, perPage, items.length, hasNext, loadingCatalog, missingScanMeta, missingImageVerify])
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) =>
        productsSortAsc
          ? String(a.name ?? '').localeCompare(String(b.name ?? ''))
          : String(b.name ?? '').localeCompare(String(a.name ?? ''))
      ),
    [items, productsSortAsc]
  )
  const showCatalogSkeleton = loadingCatalog && items.length === 0
  const showCatalogBodyOverlay = loadingCatalog && items.length > 0
  const skeletonCardCount = Math.max(6, Math.min(perPage, 12))
  const selectedProducts = useMemo(
    () => sortedItems.filter((it) => selectedProductIds[resolveItemId(it)]),
    [sortedItems, selectedProductIds]
  )
  const selectedProductsCount = selectedProducts.length

  const hasBulkEditChanges = useMemo(() => {
    for (const id of Object.keys(bulkEditDraft)) {
      const orig = bulkEditOriginal[id]
      const draft = bulkEditDraft[id]
      if (!orig || !draft) continue
      if (!bulkDraftsEqual(orig, draft)) return true
    }
    return false
  }, [bulkEditDraft, bulkEditOriginal])

  const confirmDiscardBulkEdit = useCallback(() => {
    if (!bulkEditMode || !hasBulkEditChanges) return true
    return confirm('You have unsaved bulk edits. Discard them?')
  }, [bulkEditMode, hasBulkEditChanges])

  const enterBulkEditMode = useCallback(() => {
    const draft: Record<string, BulkRowDraft> = {}
    const original: Record<string, BulkRowDraft> = {}
    for (const it of sortedItems) {
      const id = resolveItemId(it)
      if (!id) continue
      const row = itemToBulkDraft(it)
      draft[id] = { ...row }
      original[id] = { ...row }
    }
    setBulkEditDraft(draft)
    setBulkEditOriginal(original)
    setBulkEditMode(true)
  }, [sortedItems])

  const exitBulkEditMode = useCallback(() => {
    setBulkEditMode(false)
    setBulkEditDraft({})
    setBulkEditOriginal({})
  }, [])

  const cancelBulkEditMode = useCallback(() => {
    if (!confirmDiscardBulkEdit()) return
    exitBulkEditMode()
  }, [confirmDiscardBulkEdit, exitBulkEditMode])

  const guardBulkEditNavigation = useCallback(() => {
    if (!confirmDiscardBulkEdit()) return false
    if (bulkEditMode) exitBulkEditMode()
    return true
  }, [confirmDiscardBulkEdit, bulkEditMode, exitBulkEditMode])

  const updateBulkDraftField = useCallback((id: string, field: keyof BulkRowDraft, value: string) => {
    setBulkEditDraft((prev) => {
      const row = prev[id]
      if (!row) return prev
      return { ...prev, [id]: { ...row, [field]: value } }
    })
  }, [])

  const isBulkRowChanged = useCallback(
    (id: string) => {
      const orig = bulkEditOriginal[id]
      const draft = bulkEditDraft[id]
      if (!orig || !draft) return false
      return !bulkDraftsEqual(orig, draft)
    },
    [bulkEditDraft, bulkEditOriginal]
  )

  const saveBulkEdits = useCallback(async () => {
    const changedIds = Object.keys(bulkEditDraft).filter((id) => isBulkRowChanged(id))
    if (changedIds.length === 0) {
      toast('No changes to save', 'info')
      exitBulkEditMode()
      return
    }
    setBulkEditSaving(true)
    let ok = 0
    const failures: string[] = []
    for (const id of changedIds) {
      const original = bulkEditOriginal[id]
      const draft = bulkEditDraft[id]
      if (!original || !draft) continue
      const nameTrim = draft.name.trim()
      if (!nameTrim) {
        failures.push(`${id}: Product name is required`)
        continue
      }
      let payload: Record<string, unknown>
      try {
        payload = buildBulkSavePayload(original, draft, productCategoriesConfigured)
      } catch (e) {
        failures.push(`${id}: ${e instanceof Error ? e.message : 'Invalid values'}`)
        continue
      }
      if (Object.keys(payload).length === 0) continue
      try {
        await adminFetch(`/api/admin/items/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
        ok += 1
      } catch (e) {
        failures.push(`${id}: ${e instanceof Error ? e.message : 'Failed'}`)
      }
    }
    setBulkEditSaving(false)
    exitBulkEditMode()
    if (missingPhotosMode) {
      await loadMissingImageReport()
    } else {
      await loadCatalog()
    }
    if (failures.length > 0) {
      toast(`Saved ${ok}; ${failures.length} failed. ${failures.slice(0, 2).join('; ')}`, 'error')
    } else {
      toast(`Saved ${ok} product(s)`)
    }
  }, [
    bulkEditDraft,
    bulkEditOriginal,
    exitBulkEditMode,
    isBulkRowChanged,
    loadCatalog,
    loadMissingImageReport,
    missingPhotosMode,
    productCategoriesConfigured,
    toast
  ])

  async function refreshAfterMutation(delayMs = 0) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    if (missingPhotosMode) {
      await loadMissingImageReport()
    } else {
      await loadCatalog()
    }
  }

  async function createProduct() {
    const rate = Number(newProduct.rate)
    if (!newProduct.name.trim() || !Number.isFinite(rate)) {
      toast('Name and rate are required', 'info')
      return
    }
    let minPurchase: number | undefined
    if (newProduct.min_purchase_count.trim()) {
      const mq = Number(newProduct.min_purchase_count.trim())
      if (!Number.isFinite(mq) || mq < 1 || !Number.isInteger(mq)) {
        toast('Min purchase count must be a whole number of 1 or greater', 'info')
        return
      }
      minPurchase = mq
    }
    setCreatingProduct(true)
    try {
      const created = await adminFetch<{ item?: { item_id?: string } }>('/api/admin/items', {
        method: 'POST',
        body: JSON.stringify({
          name: newProduct.name.trim(),
          rate,
          product_type: newProduct.product_type,
          unit: newProduct.unit.trim() || 'unit',
          ...(newProduct.sku.trim() ? { sku: newProduct.sku.trim() } : {}),
          ...(newProduct.description.trim() ? { description: newProduct.description.trim() } : {}),
          ...(productCategoriesConfigured && newProduct.product_category_id.trim()
            ? { product_category_id: newProduct.product_category_id.trim() }
            : {}),
          ...(minPurchase != null ? { min_purchase_count: minPurchase } : {})
        })
      })
      const itemId = created.item?.item_id != null ? String(created.item.item_id) : ''
      let imageErr = ''
      if (newProductImage && itemId) {
        try {
          await adminUploadItemImage(itemId, newProductImage)
          setImageRevByItem((m) => ({ ...m, [itemId]: String(Date.now()) }))
        } catch (imgE) {
          imageErr = '\n\nImage was not uploaded: ' + (imgE instanceof Error ? imgE.message : 'Unknown error')
        }
      } else if (newProductImage && !itemId) {
        imageErr = '\n\nCould not upload image (no item id in Zoho response).'
      }
      setNewProduct({
        name: '',
        rate: '',
        sku: '',
        unit: 'unit',
        description: '',
        product_type: 'goods',
        product_category_id: '',
        min_purchase_count: ''
      })
      setNewProductImage(null)
      setIsDraggingNewImage(false)
      if (newProductImageInputRef.current) newProductImageInputRef.current.value = ''
      setShowAddProductModal(false)
      await refreshAfterMutation()
      toast(imageErr ? `Product created.${imageErr}` : 'Product created in Zoho Books')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error')
    } finally {
      setCreatingProduct(false)
    }
  }

  return (
    <>
      <div className="admin-products-header" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="admin-btn admin-btn-inline admin-btn-add-product" onClick={() => setShowAddProductModal(true)}>
          Add Product
        </button>
      </div>

      <section className="admin-card">
        <div className="admin-toolbar">
          <div className="admin-toolbar__search" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
              <span className="admin-toolbar__search-icon" aria-hidden>
                ⌕
              </span>
              <input
                type="search"
                className="admin-toolbar__search-input"
                placeholder="Search name, SKU…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (!guardBulkEditNavigation()) return
                    runProductSearch()
                  }
                }}
                aria-label="Search products"
              />
            </div>
            <button
              type="button"
              className="admin-btn admin-btn-inline"
              style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => {
                if (!guardBulkEditNavigation()) return
                runProductSearch()
              }}
            >
              Search
            </button>
          </div>
          {isMissingImageFilter ? (
            <button
              type="button"
              className="admin-btn admin-btn-inline"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                if (!guardBulkEditNavigation()) return
                setMissingPhotosMode(false)
                setPage(1)
              }}
            >
              Back to catalog
            </button>
          ) : (
            <button
              type="button"
              className="admin-btn admin-btn-inline"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                if (!guardBulkEditNavigation()) return
                setMissingPhotosMode(true)
                setPage(1)
              }}
            >
              Show missing photos
            </button>
          )}
          <select
            className="admin-select"
            value={perPage}
            disabled={isMissingImageFilter}
            onChange={(e) => {
              if (!guardBulkEditNavigation()) {
                e.target.value = String(perPage)
                return
              }
              setPerPage(Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number])
              setPage(1)
            }}
            aria-label="Items per page"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <div className="admin-segmented" role="group" aria-label="View mode">
            <button
              type="button"
              className={view === 'grid' ? 'is-active' : ''}
              onClick={() => {
                if (view === 'grid') return
                if (!guardBulkEditNavigation()) return
                setView('grid')
              }}
            >
              Grid
            </button>
            <button
              type="button"
              className={view === 'table' ? 'is-active' : ''}
              onClick={() => setView('table')}
            >
              Table
            </button>
          </div>
        </div>

        {productCategoriesConfigured && !isMissingImageFilter ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button
              type="button"
              className="admin-btn admin-btn-inline"
              disabled={categoryScanLoading}
              onClick={() => void runCategoryCoverageScan()}
            >
              {categoryScanLoading ? 'Scanning all items…' : 'Scan all product categories'}
            </button>
          </div>
        ) : null}
        {categoryScanReport && !categoryScanLoading && categoryScanReport.configured !== false ? (
          <div className="admin-muted" style={{ margin: '0 0 12px', fontSize: '0.85rem', maxWidth: 900 }}>
            <p style={{ margin: '0 0 6px' }}>
              Scanned <strong>{categoryScanReport.scanned_count ?? 0}</strong> rows · detail fetches{' '}
              <strong>{categoryScanReport.detail_fetch_rows ?? 0}</strong>
              {(categoryScanReport.unknown_cf_value_count ?? 0) > 0 ? (
                <>
                  {' '}
                  ·{' '}
                  <span className="admin-error-inline">
                    {categoryScanReport.unknown_cf_value_count} unknown custom-field values
                  </span>
                </>
              ) : null}
            </p>
            <details>
              <summary style={{ cursor: 'pointer' }}>Counts by display category</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', marginTop: 8 }}>
                {JSON.stringify(categoryScanReport.by_display_category ?? {}, null, 2)}
              </pre>
            </details>
            {(categoryScanReport.unknown_cf_items?.length ?? 0) > 0 ? (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer' }}>Unknown custom-field values (sample)</summary>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {categoryScanReport.unknown_cf_items!.map((x) => (
                    <li key={String(x.item_id ?? '')}>
                      {String(x.name ?? '')} — {String(x.product_category_name ?? '')}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="admin-toolbar-meta">
          {loadingCatalog ? (
            <AdminInlineSpinner label={showCatalogSkeleton ? 'Loading catalog…' : 'Refreshing catalog…'} />
          ) : (
            <span>{rangeLabel}</span>
          )}
          {catalogError ? <span className="admin-error-inline">{catalogError}</span> : null}
        </div>
        {isMissingImageFilter ? (
          <div className="admin-muted" style={{ margin: '0 0 12px', fontSize: '0.85rem', maxWidth: 860 }}>
            <p style={{ margin: '0 0 8px' }}>
              Grey tiles with a letter mean Zoho has no usable image for that row (same check as the product grid). Turn
              on <strong>Verify with Zoho</strong> to also catch items that list image metadata but still 404—slower on
              large catalogs.
            </p>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={missingImageVerify}
                onChange={(e) => {
                  setMissingImageVerify(e.target.checked)
                  setPage(1)
                }}
              />
              Verify with Zoho (HTTP, slower)
            </label>
          </div>
        ) : null}
        {view === 'table' ? (
          <div className="admin-toolbar-meta" style={{ justifyContent: 'space-between' }}>
            <span className="admin-muted">
              {bulkEditMode
                ? hasBulkEditChanges
                  ? 'Bulk edit mode — unsaved changes on this page'
                  : 'Bulk edit mode — edit cells inline, then save'
                : selectedProductsCount > 0
                  ? `${selectedProductsCount} selected`
                  : null}
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {bulkEditMode ? (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    disabled={bulkEditSaving}
                    onClick={() => void saveBulkEdits()}
                  >
                    {bulkEditSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    disabled={bulkEditSaving}
                    onClick={cancelBulkEditMode}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    disabled={sortedItems.length === 0 || loadingCatalog}
                    onClick={enterBulkEditMode}
                  >
                    Bulk edit
                  </button>
                  <IconEditButton
                    label={selectedProductsCount !== 1 ? 'Select exactly one product to edit' : 'Edit selected product'}
                    disabled={selectedProductsCount !== 1}
                    onClick={() => {
                      if (selectedProductsCount !== 1) return
                      setEditingItem(null)
                      void openProductEditor(selectedProducts[0])
                    }}
                  />
                  <IconDeleteButton
                    label={selectedProductsCount === 0 ? 'Select products to delete' : 'Delete selected products'}
                    disabled={selectedProductsCount === 0}
                    onClick={async () => {
                      if (selectedProductsCount === 0) return
                      const ids = selectedProducts.map((it) => resolveItemId(it)).filter(Boolean)
                      if (ids.length === 0) {
                        toast('Cannot delete: selected rows have no Zoho item id.', 'error')
                        return
                      }
                      if (!confirm(`Delete ${ids.length} selected product(s) from Zoho?`)) return
                      const failures: string[] = []
                      let deactivated = 0
                      for (const id of ids) {
                        try {
                          const r = await adminFetch<Record<string, unknown>>(`/api/admin/items/${encodeURIComponent(id)}`, {
                            method: 'DELETE'
                          })
                          if (r?.deactivated_instead_of_delete) deactivated += 1
                        } catch (e) {
                          failures.push(`${id}: ${e instanceof Error ? e.message : 'Failed'}`)
                        }
                      }
                      setSelectedProductIds({})
                      await refreshAfterMutation()
                      if (failures.length > 0) {
                        toast(`Some deletes failed (${failures.length}). ${failures.slice(0, 3).join('; ')}`, 'error')
                      } else if (deactivated > 0) {
                        toast(
                          deactivated === ids.length
                            ? `${deactivated} item(s) could not be deleted (in use). Marked inactive in Zoho instead.`
                            : `${deactivated} marked inactive (in use); ${ids.length - deactivated} deleted.`
                        )
                      } else {
                        toast(`${ids.length} product(s) deleted from Zoho`)
                      }
                    }}
                  />
                  {productCategoriesConfigured && selectedProductsCount > 0 ? (
                    <>
                      <select
                        className="admin-select"
                        style={{ minWidth: 160 }}
                        value={bulkCategoryId}
                        onChange={(e) => setBulkCategoryId(e.target.value)}
                        aria-label="Bulk category"
                      >
                        <option value="">Set category…</option>
                        <option value="__clear__">Uncategorized</option>
                        {productCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost"
                        disabled={!bulkCategoryId}
                        onClick={async () => {
                          if (!bulkCategoryId) return
                          const ids = selectedProducts.map((it) => resolveItemId(it)).filter(Boolean)
                          const payloadId = bulkCategoryId === '__clear__' ? '' : bulkCategoryId
                          let ok = 0
                          const failures: string[] = []
                          for (const id of ids) {
                            try {
                              await adminFetch(`/api/admin/items/${encodeURIComponent(id)}`, {
                                method: 'PUT',
                                body: JSON.stringify({ product_category_id: payloadId })
                              })
                              ok += 1
                            } catch (e) {
                              failures.push(`${id}: ${e instanceof Error ? e.message : 'Failed'}`)
                            }
                          }
                          setBulkCategoryId('')
                          setSelectedProductIds({})
                          await refreshAfterMutation()
                          if (failures.length > 0) {
                            toast(`Updated ${ok}; ${failures.length} failed. ${failures.slice(0, 2).join('; ')}`, 'error')
                          } else {
                            toast(`Category updated for ${ok} product(s)`)
                          }
                        }}
                      >
                        Apply to selected
                      </button>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}

        {view === 'grid' ? (
          <div className="admin-busy-host">
            {showCatalogBodyOverlay ? <AdminBusyOverlay label="Updating catalog…" /> : null}
            <div className="admin-product-grid">
            {showCatalogSkeleton
              ? Array.from({ length: skeletonCardCount }).map((_, i) => (
                  <article key={`skeleton-grid-${i}`} className="admin-product-card admin-product-card--skeleton" aria-hidden>
                    <div className="admin-product-card__media admin-skeleton admin-skeleton--media" />
                    <div className="admin-product-card__body">
                      <div className="admin-skeleton admin-skeleton--line admin-skeleton--title" />
                      <div className="admin-skeleton admin-skeleton--line admin-skeleton--meta" />
                      <div className="admin-skeleton admin-skeleton--line admin-skeleton--price" />
                    </div>
                  </article>
                ))
              : sortedItems.map((it) => {
                  const id = resolveItemId(it)
                  const name = String(it.name ?? 'Item')
                  return (
                    <article
                      key={id || name}
                      className="admin-product-card admin-product-card--clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => void openProductEditor(it)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void openProductEditor(it)
                        }
                      }}
                    >
                      <div className="admin-product-card__media">
                        {id ? <ItemThumb itemId={id} label={name} cacheBust={imageRevByItem[id]} /> : <ItemThumb itemId="" label={name} />}
                      </div>
                      <div className="admin-product-card__body">
                        <p className="admin-product-card__meta">
                          {String(it.sku || '—')} · {String(it.product_type || '—')}
                          {String((it as Record<string, unknown>).product_category_name || '').trim()
                            ? ` · ${String((it as Record<string, unknown>).product_category_name)}`
                            : ''}
                        </p>
                        <h4 className="admin-product-card__title">{name}</h4>
                        <p className="admin-product-card__price">₹ {String(it.rate ?? '—')}</p>
                        <p className="admin-product-card__stock">
                          {(() => {
                            const stock = readItemStock(it)
                            if (stock === null || stock === undefined) return <span className="admin-stock-badge admin-stock-badge--none">No stock info</span>
                            if (stock <= 0) return <span className="admin-stock-badge admin-stock-badge--out">Out of stock</span>
                            if (stock < 10) return <span className="admin-stock-badge admin-stock-badge--low">Low · {stock}</span>
                            return <span className="admin-stock-badge admin-stock-badge--ok">In stock · {stock}</span>
                          })()}
                        </p>
                        <div className="admin-product-card__actions" onClick={(e) => e.stopPropagation()}>
                          <IconEditButton label={`Edit ${name}`} onClick={() => void openProductEditor(it)} />
                          <IconDeleteButton
                            label={`Delete ${name}`}
                            onClick={async () => {
                              if (!id) {
                                toast('Cannot delete: this row has no Zoho item id.', 'error')
                                return
                              }
                              if (!confirm(`Delete “${name}” from Zoho?`)) return
                              try {
                                const r = await adminFetch<Record<string, unknown>>(
                                  `/api/admin/items/${encodeURIComponent(id)}`,
                                  { method: 'DELETE' }
                                )
                                if (r?.deactivated_instead_of_delete) {
                                  setItems((prev) =>
                                    prev.map((row) =>
                                      resolveItemId(row) === id ? { ...row, status: 'inactive' } : row
                                    )
                                  )
                                } else {
                                  setItems((prev) => prev.filter((row) => resolveItemId(row) !== id))
                                }
                                await refreshAfterMutation()
                                toast(
                                  r?.deactivated_instead_of_delete && typeof r.message === 'string'
                                    ? String(r.message)
                                    : 'Product deleted from Zoho'
                                )
                              } catch (e) {
                                toast(e instanceof Error ? e.message : 'Failed', 'error')
                              }
                            }}
                          />
                        </div>
                      </div>
                    </article>
                  )
                })}
            </div>
          </div>
        ) : (
          <div className="admin-busy-host">
            {showCatalogBodyOverlay ? <AdminBusyOverlay label="Updating catalog…" /> : null}
            {bulkEditSaving ? <AdminBusyOverlay label="Saving changes…" /> : null}
            <div className="admin-table-wrap admin-table-wrap--tight">
            <table className={`admin-table admin-table--products${bulkEditMode ? ' admin-table--bulk-edit' : ''}`}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={sortedItems.length > 0 && sortedItems.every((it) => !resolveItemId(it) || selectedProductIds[resolveItemId(it)])}
                      onChange={(e) =>
                        setSelectedProductIds(() => {
                          const next: Record<string, boolean> = {}
                          for (const it of sortedItems) {
                            const rid = resolveItemId(it)
                            if (rid) next[rid] = e.target.checked
                          }
                          return next
                        })
                      }
                    />
                  </th>
                  <th className="admin-th-thumb" scope="col">
                    Image
                  </th>
                  <th className="admin-th-sortable" onClick={() => setProductsSortAsc((v) => !v)} title="Sort by name">
                    Name {productsSortAsc ? '▲' : '▼'}
                  </th>
                  <th>Customer product name</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Rate</th>
                  <th>Stock</th>
                  <th>Min purchase</th>
                  <th>Item ID</th>
                  <th scope="col" className="admin-th-actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {showCatalogSkeleton
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`skeleton-table-${i}`} aria-hidden>
                        <td><div className="admin-skeleton admin-skeleton--cell" /></td>
                        <td><div className="admin-skeleton admin-skeleton--thumb-cell" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--pill" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--line" /></td>
                        <td><div className="admin-skeleton admin-skeleton--cell" /></td>
                      </tr>
                    ))
                  : sortedItems.map((it) => {
                      const id = resolveItemId(it)
                      const name = String(it.name ?? 'Item')
                      const draft = id ? bulkEditDraft[id] : undefined
                      const rowChanged = id ? isBulkRowChanged(id) : false
                      return (
                        <tr
                          key={id || name}
                          className={`${bulkEditMode ? '' : 'admin-table-row-clickable'}${rowChanged ? ' admin-table-row--changed' : ''}`}
                          onClick={bulkEditMode ? undefined : () => void openProductEditor(it)}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={!!selectedProductIds[id]}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setSelectedProductIds((prev) => {
                                  const rid = resolveItemId(it)
                                  if (!rid) return prev
                                  return { ...prev, [rid]: e.target.checked }
                                })
                              }
                            />
                          </td>
                          <td>
                            <div className="admin-table-thumb-wrap">
                              {id ? <ItemThumb itemId={id} label={name} cacheBust={imageRevByItem[id]} /> : null}
                            </div>
                          </td>
                          <td className="admin-td-strong">
                            {bulkEditMode && draft && id ? (
                              <input
                                className="admin-table-input"
                                value={draft.name}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'name', e.target.value)}
                                aria-label={`Name for ${name}`}
                              />
                            ) : (
                              name
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <input
                                className="admin-table-input"
                                value={draft.customer_product_name}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'customer_product_name', e.target.value)}
                                aria-label={`Customer product name for ${name}`}
                                placeholder="Customer product name"
                              />
                            ) : (
                              String(it.customer_product_name || '—').trim() || '—'
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id && productCategoriesConfigured ? (
                              <select
                                className="admin-table-select"
                                value={draft.product_category_id}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'product_category_id', e.target.value)}
                                aria-label={`Category for ${name}`}
                              >
                                <option value="">Uncategorized</option>
                                {productCategories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            ) : bulkEditMode && draft && id ? (
                              String((it as Record<string, unknown>).product_category_name || '—')
                            ) : (
                              String((it as Record<string, unknown>).product_category_name || '—')
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <input
                                className="admin-table-input"
                                value={draft.sku}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'sku', e.target.value)}
                                aria-label={`SKU for ${name}`}
                              />
                            ) : (
                              String(it.sku ?? '—')
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <select
                                className="admin-table-select"
                                value={draft.product_type}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'product_type', e.target.value)}
                                aria-label={`Type for ${name}`}
                              >
                                {PRODUCT_TYPE_OPTIONS.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              String(it.product_type ?? '—')
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <select
                                className="admin-table-select"
                                value={draft.status}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'status', e.target.value)}
                                aria-label={`Status for ${name}`}
                              >
                                {PRODUCT_STATUS_OPTIONS.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span
                                className={
                                  String(it.status).toLowerCase() === 'active'
                                    ? 'admin-pill'
                                    : 'admin-pill admin-pill--muted'
                                }
                              >
                                {String(it.status ?? '—')}
                              </span>
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <input
                                className="admin-table-input admin-table-input--narrow"
                                value={draft.rate}
                                inputMode="decimal"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'rate', e.target.value)}
                                aria-label={`Rate for ${name}`}
                              />
                            ) : (
                              String(it.rate ?? '—')
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <input
                                className="admin-table-input admin-table-input--narrow"
                                value={draft.stock}
                                inputMode="numeric"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'stock', e.target.value)}
                                aria-label={`Stock for ${name}`}
                              />
                            ) : (
                              readItemStock(it) ?? '—'
                            )}
                          </td>
                          <td>
                            {bulkEditMode && draft && id ? (
                              <input
                                className="admin-table-input admin-table-input--narrow"
                                value={draft.min_purchase_count}
                                inputMode="numeric"
                                min={1}
                                step={1}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateBulkDraftField(id, 'min_purchase_count', e.target.value)}
                                aria-label={`Min purchase count for ${name}`}
                                placeholder="e.g. 10"
                              />
                            ) : (
                              it.min_purchase_count != null && it.min_purchase_count !== ''
                                ? String(it.min_purchase_count)
                                : '—'
                            )}
                          </td>
                          <td className="admin-td-mono">{id}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <IconEditButton
                                label={`Edit ${name}`}
                                disabled={bulkEditMode}
                                onClick={() => void openProductEditor(it)}
                              />
                              <IconDeleteButton
                                label={`Delete ${name}`}
                                disabled={bulkEditMode}
                                onClick={async () => {
                                  if (!id) {
                                    toast('Cannot delete: this row has no Zoho item id.', 'error')
                                    return
                                  }
                                  if (!confirm(`Delete “${name}” from Zoho?`)) return
                                  try {
                                    const r = await adminFetch<Record<string, unknown>>(
                                      `/api/admin/items/${encodeURIComponent(id)}`,
                                      { method: 'DELETE' }
                                    )
                                    if (r?.deactivated_instead_of_delete) {
                                      setItems((prev) =>
                                        prev.map((row) =>
                                          resolveItemId(row) === id ? { ...row, status: 'inactive' } : row
                                        )
                                      )
                                    } else {
                                      setItems((prev) => prev.filter((row) => resolveItemId(row) !== id))
                                    }
                                    await refreshAfterMutation()
                                    toast(
                                      r?.deactivated_instead_of_delete && typeof r.message === 'string'
                                        ? String(r.message)
                                        : 'Product deleted from Zoho'
                                    )
                                  } catch (e) {
                                    toast(e instanceof Error ? e.message : 'Failed', 'error')
                                  }
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        <nav className="admin-pagination" aria-label="Catalog pages">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={!hasPrev || loadingCatalog || isMissingImageFilter}
            onClick={() => {
              if (!guardBulkEditNavigation()) return
              setPage((p) => Math.max(1, p - 1))
            }}
          >
            Previous
          </button>
          <span className="admin-pagination__info">
            {isMissingImageFilter ? (
              <span className="admin-muted">Full catalog scan (pagination off)</span>
            ) : (
              <>
                Page <strong>{pageCtx?.page ?? page}</strong>
                {hasNext ? <span className="admin-muted"> · more available</span> : null}
              </>
            )}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={!hasNext || loadingCatalog || isMissingImageFilter}
            onClick={() => {
              if (!guardBulkEditNavigation()) return
              setPage((p) => p + 1)
            }}
          >
            Next
          </button>
        </nav>
      </section>

      {editingItem ? (
        <div
          className="admin-modal-backdrop admin-modal-backdrop--fullscreen"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingItem(null)
          }}
        >
          <div
            className="admin-modal admin-modal--fullscreen"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <h3 className="admin-modal__title">Edit item</h3>
            {resolveItemId(editingItem) ? (
              <div className="admin-modal__thumb-row">
                <div className="admin-modal__thumb-preview">
                  {editImageObjectUrl ? (
                    <img className="admin-item-thumb" src={editImageObjectUrl} alt="" />
                  ) : (
                    <ItemThumb
                      itemId={resolveItemId(editingItem)}
                      label={String(editingItem.name ?? '')}
                      cacheBust={imageRevByItem[resolveItemId(editingItem)]}
                    />
                  )}
                </div>
                <div
                  className={`admin-dropzone${isDraggingEditImage ? ' is-dragging' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDraggingEditImage(true)
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    setIsDraggingEditImage(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    if (e.currentTarget === e.target) setIsDraggingEditImage(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDraggingEditImage(false)
                    const file = e.dataTransfer.files?.[0]
                    if (!file) return
                    if (!file.type.startsWith('image/')) {
                      toast('Please drop an image file', 'info')
                      return
                    }
                    setEditProductImage(file)
                  }}
                >
                  <div className="admin-dropzone__inner">
                    <UploadIcon />
                    <p className="admin-dropzone__title">Drag and drop product image</p>
                    <p className="admin-dropzone__meta">JPEG, PNG, GIF, WebP. This image is private until you save.</p>
                    <label className="admin-file-label admin-file-label--block admin-file-label--cta">
                      <span className="admin-file-label__button">Select files</span>
                      <span className="admin-file-label__text">{editProductImage ? editProductImage.name : 'Replace image (optional)'}</span>
                      <input
                        ref={editImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="admin-file-input"
                        onChange={(e) => setEditProductImage(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            ) : null}
            <label className="admin-field-label">
              <span>Product name (Zoho catalog)</span>
              <input
                className="admin-input"
                placeholder="Product name"
                readOnly
                aria-readonly="true"
                title="Rename items in Zoho Books if needed. Customers see the field below when configured."
                value={String(editingItem.name ?? '')}
              />
            </label>
            <label className="admin-field-label">
              <span>Customer product name</span>
              <input
                className="admin-input"
                placeholder="Shown in the customer app instead of the catalog name"
                value={editingCustomerProductName}
                onChange={(e) => setEditingCustomerProductName(e.target.value)}
                aria-label="Customer product name"
              />
            </label>
            {itemCustomerNameFieldConfigured === false ? (
              <p className="admin-muted" style={{ fontSize: '0.8rem', marginTop: -8, marginBottom: 12 }}>
                Set <code>ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID</code> in the backend <code>.env</code> to a Zoho Books{' '}
                <strong>item</strong> custom field id. Until then, saves keep the internal name only; customers still see the Zoho product name.
              </p>
            ) : null}
            {productCategoriesConfigured ? (
              <label className="admin-field-label">
                <span>Product category</span>
                <select
                  className="admin-input"
                  value={editingCategoryId}
                  onChange={(e) => setEditingCategoryId(e.target.value)}
                  aria-label="Product category"
                >
                  <option value="">Uncategorized</option>
                  {productCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="admin-field-label">
              <span>Price (rate)</span>
              <input
                className="admin-input"
                type="text"
                inputMode="decimal"
                placeholder="Price (e.g. 99)"
                value={editingRate}
                onChange={(e) => setEditingRate(e.target.value)}
              />
            </label>
            <label className="admin-field-label">
              <span>Stock on hand</span>
              <input
                className="admin-input"
                type="number"
                min={0}
                step="1"
                placeholder="Stock quantity (e.g. 120)"
                value={editingStock}
                onChange={(e) => setEditingStock(e.target.value)}
              />
            </label>
            <label className="admin-field-label">
              <span>Min purchase count</span>
              <input
                className="admin-input"
                type="number"
                min={1}
                step="1"
                placeholder="Minimum quantity customers must order (e.g. 10)"
                value={editingMinPurchaseCount}
                onChange={(e) => setEditingMinPurchaseCount(e.target.value)}
                aria-label="Min purchase count"
              />
            </label>
            {itemMinPurchaseFieldConfigured === false ? (
              <p className="admin-muted" style={{ fontSize: '0.8rem', marginTop: -8, marginBottom: 12 }}>
                Set <code>ZOHO_CUSTOM_FIELD_ITEM_MIN_PURCHASE_ID</code> in the backend <code>.env</code> (or run{' '}
                <code>npm run zoho:setup-item-min-purchase-field</code>) so this value saves to Zoho. Until then, the
                customer app keeps its default minimum.
              </p>
            ) : null}
            <label className="admin-field-label">
              <span>SKU</span>
              <input
                className="admin-input"
                placeholder="SKU"
                value={String(editingItem.sku ?? '')}
                onChange={(e) => setEditingItem({ ...editingItem, sku: e.target.value })}
              />
            </label>
            <label className="admin-field-label">
              <span>Description</span>
              <input
                className="admin-input"
                placeholder="Description"
                value={String(editingItem.description ?? '')}
                onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
              />
            </label>
            <div className="admin-modal__footer">
              <button type="button" className="admin-btn admin-btn--ghost" disabled={savingProduct} onClick={() => setEditingItem(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-inline"
                disabled={savingProduct || !resolveItemId(editingItem)}
                onClick={async () => {
                  const id = resolveItemId(editingItem)
                  if (!id) {
                    toast('Cannot save: this row has no Zoho item id. Refresh the list or re-open the item.', 'error')
                    return
                  }
                  const nameTrim = String(editingItem.name ?? '').trim()
                  if (!nameTrim) {
                    toast('Product name is required', 'info')
                    return
                  }
                  const rateNum = Number(String(editingRate).trim())
                  if (!Number.isFinite(rateNum)) {
                    toast('Enter a valid price (rate)', 'info')
                    return
                  }
                  let stockPayload: { stock_on_hand: number } | Record<string, never> = {}
                  if (editingStock.trim()) {
                    const sq = Number(editingStock.trim())
                    if (!Number.isFinite(sq) || sq < 0) {
                      toast('Enter a valid stock quantity (0 or greater)', 'info')
                      return
                    }
                    stockPayload = { stock_on_hand: sq }
                  }
                  let minPurchasePayload: { min_purchase_count: number | string } | Record<string, never> = {}
                  if (editingMinPurchaseCount.trim() === '') {
                    minPurchasePayload = { min_purchase_count: '' }
                  } else {
                    const mq = Number(editingMinPurchaseCount.trim())
                    if (!Number.isFinite(mq) || mq < 1 || !Number.isInteger(mq)) {
                      toast('Min purchase count must be a whole number of 1 or greater', 'info')
                      return
                    }
                    minPurchasePayload = { min_purchase_count: mq }
                  }
                  const unitRaw = editingItem.unit
                  const unitStr = unitRaw != null && String(unitRaw).trim() ? String(unitRaw).trim() : ''
                  const ptype = editingItem.product_type
                  const ptypeStr = typeof ptype === 'string' && ptype.trim() ? ptype.trim() : ''
                  setSavingProduct(true)
                  try {
                    const resData = await adminFetch<unknown>(`/api/admin/items/${encodeURIComponent(id)}`, {
                      method: 'PUT',
                      body: JSON.stringify({
                        customer_product_name: editingCustomerProductName.trim(),
                        rate: rateNum,
                        ...(unitStr ? { unit: unitStr } : {}),
                        ...(ptypeStr ? { product_type: ptypeStr } : {}),
                        ...stockPayload,
                        ...minPurchasePayload,
                        sku: editingItem.sku || undefined,
                        description: editingItem.description || undefined,
                        ...(productCategoriesConfigured ? { product_category_id: editingCategoryId.trim() } : {})
                      })
                    })
                    if (editProductImage) {
                      try {
                        await adminUploadItemImage(id, editProductImage)
                        setImageRevByItem((m) => ({ ...m, [id]: String(Date.now()) }))
                        setEditProductImage(null)
                      } catch (imgE) {
                        toast(
                          `Saved item, but image upload failed: ${imgE instanceof Error ? imgE.message : 'Unknown'}`, 'error'
                        )
                        await refreshAfterMutation()
                        return
                      }
                    }
                    toast('Product saved successfully')
                    const merged = extractZohoItemFromItemResponse(resData)
                    if (merged) {
                      setItems((prev) =>
                        prev.map((it) => (resolveItemId(it) === id ? { ...it, ...merged } : it))
                      )
                    }
                    setEditingItem(null)
                    void refreshAfterMutation()
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Failed', 'error')
                  } finally {
                    setSavingProduct(false)
                  }
                }}
              >
                {savingProduct ? 'Saving…' : 'Save to Zoho'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAddProductModal ? (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creatingProduct) setShowAddProductModal(false)
          }}
        >
          <div className="admin-modal admin-modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
            <h3 className="admin-modal__title">Add Product</h3>
            <div className="admin-form-row admin-form-row--wrap">
              <input
                className="admin-input admin-input--grow"
                placeholder="Name *"
                value={newProduct.name}
                onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
              />
              <input
                className="admin-input"
                style={{ width: 120 }}
                placeholder="Rate *"
                type="number"
                min={0}
                step="0.01"
                value={newProduct.rate}
                onChange={(e) => setNewProduct((p) => ({ ...p, rate: e.target.value }))}
              />
              <input
                className="admin-input"
                style={{ width: 120 }}
                placeholder="SKU"
                value={newProduct.sku}
                onChange={(e) => setNewProduct((p) => ({ ...p, sku: e.target.value }))}
              />
              <input
                className="admin-input"
                style={{ width: 100 }}
                placeholder="Unit"
                value={newProduct.unit}
                onChange={(e) => setNewProduct((p) => ({ ...p, unit: e.target.value }))}
              />
              <select
                className="admin-input"
                style={{ width: 140 }}
                value={newProduct.product_type}
                onChange={(e) =>
                  setNewProduct((p) => ({
                    ...p,
                    product_type: e.target.value as typeof p.product_type
                  }))
                }
              >
                <option value="goods">goods</option>
                <option value="service">service</option>
                <option value="digital_service">digital_service</option>
              </select>
              {productCategoriesConfigured ? (
                <select
                  className="admin-input"
                  style={{ minWidth: 160 }}
                  value={newProduct.product_category_id}
                  onChange={(e) => setNewProduct((p) => ({ ...p, product_category_id: e.target.value }))}
                  aria-label="Product category"
                >
                  <option value="">Category (optional)</option>
                  {productCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                className="admin-input"
                style={{ width: 140 }}
                type="number"
                min={1}
                step={1}
                placeholder="Min purchase"
                value={newProduct.min_purchase_count}
                onChange={(e) => setNewProduct((p) => ({ ...p, min_purchase_count: e.target.value }))}
                aria-label="Min purchase count"
              />
              <input
                className="admin-input admin-input--grow"
                placeholder="Description"
                value={newProduct.description}
                onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div
              className={`admin-dropzone admin-dropzone--add${isDraggingNewImage ? ' is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDraggingNewImage(true)
              }}
              onDragEnter={(e) => {
                e.preventDefault()
                setIsDraggingNewImage(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                if (e.currentTarget === e.target) setIsDraggingNewImage(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDraggingNewImage(false)
                const file = e.dataTransfer.files?.[0]
                if (!file) return
                if (!file.type.startsWith('image/')) {
                  toast('Please drop an image file', 'info')
                  return
                }
                setNewProductImage(file)
              }}
            >
              <div className="admin-dropzone__inner">
                <UploadIcon />
                <p className="admin-dropzone__title">Drag and drop product image</p>
                <p className="admin-dropzone__meta">Supported: JPEG, PNG, GIF, WebP.</p>
                <label className="admin-file-label admin-file-label--block admin-file-label--cta">
                  <span className="admin-file-label__button">Select files</span>
                  <span className="admin-file-label__text">{newProductImage ? newProductImage.name : 'No file selected'}</span>
                  <input
                    ref={newProductImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="admin-file-input"
                    onChange={(e) => setNewProductImage(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
            <div className="admin-modal__footer">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                disabled={creatingProduct}
                onClick={() => setShowAddProductModal(false)}
              >
                Cancel
              </button>
              <button type="button" className="admin-btn admin-btn-inline" disabled={creatingProduct} onClick={() => void createProduct()}>
                {creatingProduct ? 'Creating…' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}