import { listModule } from './zohoBooksService.js'
import {
  getItemCatalogCategoryForCustomerFilter,
  getItemProductCategoryName,
  hydrateItemsListRowsForProductCategoryField,
  isProductCategoryConfigured,
  listProductCategories,
  withItemProductCategoryVirtual
} from './productCategoryZohoService.js'

/**
 * Walk every Zoho item list page, hydrate list rows when `custom_fields` is missing,
 * then aggregate display category (same rules as customer catalog).
 * @param {{ maxPages?: number, perPage?: number, searchText?: string, hydrateConcurrency?: number }} opts
 */
export async function scanAllItemsProductCategoryCoverage({
  maxPages = 80,
  perPage = 200,
  searchText,
  hydrateConcurrency = 14
} = {}) {
  if (!isProductCategoryConfigured()) {
    return {
      configured: false,
      scanned_count: 0,
      detail_fetch_rows: 0,
      by_display_category: {},
      unknown_cf_value_count: 0,
      unknown_cf_items: []
    }
  }

  const cats = await listProductCategories()
  const catNameNorm = new Set(cats.map((c) => String(c.name || '').trim().toLowerCase()).filter(Boolean))

  /** @type {Record<string, number>} */
  const byDisplay = Object.create(null)
  let scanned = 0
  let detailFetchRows = 0
  let unknownCf = 0
  /** @type {object[]} */
  const unknownCfItems = []

  for (let page = 1; page <= maxPages; page += 1) {
    const params = { page, per_page: perPage }
    if (String(searchText || '').trim()) params.search_text = String(searchText).trim().slice(0, 100)
    const data = await listModule('/items', params)
    const rows = Array.isArray(data?.items) ? data.items : []
    scanned += rows.length

    const { items: hydrated, detail_fetches: df } = await hydrateItemsListRowsForProductCategoryField(rows, {
      concurrency: hydrateConcurrency
    })
    detailFetchRows += df

    for (const row of hydrated) {
      const virt = withItemProductCategoryVirtual(row, cats)
      const display = getItemCatalogCategoryForCustomerFilter(virt)
      const key = display || '(empty)'
      byDisplay[key] = (byDisplay[key] || 0) + 1

      const cfRaw = getItemProductCategoryName(virt)
      if (cfRaw && !catNameNorm.has(cfRaw.toLowerCase())) {
        unknownCf += 1
        if (unknownCfItems.length < 200) {
          unknownCfItems.push({
            item_id: virt.item_id,
            name: virt.name,
            product_category_name: cfRaw
          })
        }
      }
    }

    if (!data?.page_context?.has_more_page || rows.length === 0) break
  }

  return {
    configured: true,
    scanned_count: scanned,
    detail_fetch_rows: detailFetchRows,
    by_display_category: byDisplay,
    unknown_cf_value_count: unknownCf,
    unknown_cf_items: unknownCfItems
  }
}
