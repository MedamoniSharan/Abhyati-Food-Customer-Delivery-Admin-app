import { listModule } from './zohoBooksService.js'
import {
  getItemCatalogCategoryForCustomerFilter,
  hydrateItemsListRowsForProductCategoryField,
  isProductCategoryConfigured
} from './productCategoryZohoService.js'
import { createLogger } from '../util/logger.js'

const log = createLogger('item-category-index')

const TTL_MS = Math.max(60_000, Number(process.env.ITEM_CATEGORY_INDEX_TTL_MS) || 5 * 60_000)
const MAX_PAGES = Math.max(1, Number(process.env.ITEM_CATEGORY_INDEX_MAX_PAGES) || 40)
const PER_PAGE = 200
const LIST_CONCURRENCY = 3
const HYDRATE_CONCURRENCY = 6

/**
 * @typedef {{
 *   builtAt: number
 *   itemsById: Map<string, object>
 *   idsByCategory: Map<string, string[]>
 *   orderedIds: string[]
 * }} CategoryIndex
 */

/** @type {CategoryIndex|null} */
let cache = null
/** @type {Promise<CategoryIndex>|null} */
let building = null

export function invalidateItemCategoryIndex() {
  cache = null
}

function rowItemId(item) {
  const raw = item?.item_id
  if (raw == null) return ''
  return String(raw).trim()
}

/**
 * @returns {Promise<CategoryIndex>}
 */
async function buildItemCategoryIndex() {
  const itemsById = new Map()
  /** @type {Map<string, string[]>} */
  const idsByCategory = new Map()
  const orderedIds = []

  let page = 1
  let hasMore = true

  while (hasMore && page <= MAX_PAGES) {
    const pageNums = []
    for (let p = page; p < page + LIST_CONCURRENCY && p <= MAX_PAGES; p += 1) {
      pageNums.push(p)
    }
    const results = await Promise.all(
      pageNums.map((p) => listModule('/items', { page: p, per_page: PER_PAGE }))
    )

    let pagesConsumed = 0
    let sawMore = false
    for (const data of results) {
      pagesConsumed += 1
      const batch = Array.isArray(data?.items) ? data.items : []
      const { items: hydrated } = await hydrateItemsListRowsForProductCategoryField(batch, {
        concurrency: HYDRATE_CONCURRENCY,
        hydrateCategory: true,
        hydrateCustomerName: true
      })
      for (const row of hydrated) {
        const id = rowItemId(row)
        if (!id || itemsById.has(id)) continue
        itemsById.set(id, row)
        orderedIds.push(id)
        const cat = getItemCatalogCategoryForCustomerFilter(row).trim().toLowerCase()
        const key = cat || 'catalog'
        const list = idsByCategory.get(key)
        if (list) list.push(id)
        else idsByCategory.set(key, [id])
      }
      sawMore = Boolean(data?.page_context?.has_more_page)
      if (!sawMore || batch.length === 0) {
        hasMore = false
        break
      }
    }
    page += pagesConsumed
    if (!hasMore) break
  }

  const index = {
    builtAt: Date.now(),
    itemsById,
    idsByCategory,
    orderedIds
  }
  log.info('Built item category index', {
    items: orderedIds.length,
    categories: idsByCategory.size,
    ttlMs: TTL_MS
  })
  return index
}

/**
 * Return a warm index (rebuilds when missing/expired). Concurrent callers share one build.
 * @returns {Promise<CategoryIndex>}
 */
export async function getItemCategoryIndex() {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache
  if (building) return building
  building = buildItemCategoryIndex()
    .then((idx) => {
      cache = idx
      return idx
    })
    .finally(() => {
      building = null
    })
  return building
}

/**
 * Fire-and-forget warm so the first category tap is often already cached.
 */
export function warmItemCategoryIndex() {
  if (!isProductCategoryConfigured()) return
  if (cache && Date.now() - cache.builtAt < TTL_MS) return
  if (building) return
  void getItemCategoryIndex().catch((err) => {
    log.warn('Background category index warm failed', {
      errMessage: err instanceof Error ? err.message : String(err)
    })
  })
}

/**
 * Paginate items for a display category (case-insensitive). Empty category returns all ordered items.
 * @param {string} categoryName
 * @param {{ page: number, perPage: number }} opts
 */
export async function listIndexedItemsByCategory(categoryName, { page, perPage }) {
  const index = await getItemCategoryIndex()
  const want = String(categoryName || '').trim().toLowerCase()
  const ids = want ? index.idsByCategory.get(want) || [] : index.orderedIds
  const start = (page - 1) * perPage
  const sliceIds = ids.slice(start, start + perPage)
  const items = sliceIds.map((id) => index.itemsById.get(id)).filter(Boolean)
  const hasMore = start + perPage < ids.length
  return {
    items,
    page_context: {
      page,
      per_page: perPage,
      has_more_page: hasMore
    },
    total_matched: ids.length
  }
}
