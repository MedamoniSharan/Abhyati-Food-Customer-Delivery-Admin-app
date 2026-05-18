/** Rows for the specifications grid from a Zoho Books `item` object. */
export type ZohoSpecRow = { label: string; value: string }

function addRow(rows: ZohoSpecRow[], label: string, value: unknown) {
  if (value == null) return
  const s = String(value).trim()
  if (!s) return
  rows.push({ label, value: s })
}

/**
 * Maps a Zoho item payload (GET /items/:id) into label/value rows for the UI.
 */
export function zohoItemToSpecRows(item: Record<string, unknown>): ZohoSpecRow[] {
  const rows: ZohoSpecRow[] = []
  addRow(rows, 'SKU', item.sku)
  addRow(rows, 'Unit', item.unit)
  addRow(rows, 'Status', item.status)
  addRow(rows, 'Product type', item.product_type)
  addRow(rows, 'Item type', item.item_type)
  addRow(rows, 'HSN/SAC', item.hsn_or_sac)
  addRow(rows, 'Tax', item.tax_name)
  addRow(rows, 'Tax %', item.tax_percentage)

  const desc = item.description
  if (typeof desc === 'string' && desc.trim()) {
    rows.push({ label: 'Description', value: desc.trim() })
  }

  const locations = item.locations
  if (Array.isArray(locations)) {
    locations.forEach((loc, i) => {
      if (!loc || typeof loc !== 'object') return
      const o = loc as Record<string, unknown>
      const name = o.location_name != null ? String(o.location_name).trim() : ''
      const stock =
        o.location_stock_on_hand ?? o.location_available_stock ?? o.location_actual_available_stock
      const parts = [name, stock != null && String(stock).trim() ? `Stock: ${stock}` : ''].filter(Boolean)
      if (parts.length) addRow(rows, name ? `Location: ${name}` : `Location ${i + 1}`, parts.join(' · '))
    })
  }

  const customFields = item.custom_fields
  if (Array.isArray(customFields)) {
    for (const raw of customFields) {
      if (!raw || typeof raw !== 'object') continue
      const f = raw as Record<string, unknown>
      const label = String(
        f.label ?? f.field_name ?? f.customfield_name ?? `Custom (${f.customfield_id ?? 'field'})`,
      ).trim()
      const val = f.value
      if (val != null && String(val).trim()) {
        rows.push({ label, value: String(val).trim() })
      }
    }
  }

  return rows
}

/**
 * Total orderable quantity from Zoho (sum of location stock or stock_on_hand).
 * Returns null when stock is not reported (no cap applied in UI).
 */
export function zohoAvailableStockQuantity(item: Record<string, unknown> | null): number | null {
  if (!item) return null
  const locations = item.locations
  if (Array.isArray(locations) && locations.length > 0) {
    let sum = 0
    let counted = false
    for (const loc of locations) {
      if (!loc || typeof loc !== 'object') continue
      const o = loc as Record<string, unknown>
      const raw = o.location_stock_on_hand ?? o.location_available_stock ?? o.location_actual_available_stock
      if (raw === '' || raw == null) continue
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0) {
        sum += n
        counted = true
      }
    }
    if (counted) return Math.floor(sum)
  }
  const hand = item.stock_on_hand ?? item.available_stock
  if (hand != null && String(hand).trim() !== '') {
    const n = Number(hand)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return null
}

/** Human-readable stock line from Zoho item. */
export function zohoStockLine(item: Record<string, unknown>): string {
  const locations = item.locations
  if (Array.isArray(locations) && locations.length > 0) {
    let sum = 0
    for (const loc of locations) {
      if (!loc || typeof loc !== 'object') continue
      const n = Number((loc as { location_stock_on_hand?: unknown }).location_stock_on_hand)
      if (Number.isFinite(n) && n > 0) sum += n
    }
    if (sum > 0) {
      const u = item.unit != null ? String(item.unit).trim() : 'units'
      return `${sum} ${u} available (across locations)`
    }
  }
  const hand = item.stock_on_hand ?? item.available_stock
  if (hand != null && String(hand).trim()) {
    const u = item.unit != null ? String(item.unit).trim() : 'units'
    return `${String(hand).trim()} ${u} in stock`
  }
  const status = String(item.status || '').toLowerCase()
  if (status === 'active') return 'In stock, ready to ship'
  if (status === 'inactive') return 'Currently inactive in catalog'
  return 'See catalog for availability'
}

export function zohoRateInr(item: Record<string, unknown>): number | null {
  const r = item.rate ?? item.sales_rate
  const n = typeof r === 'number' ? r : Number(r)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function zohoUnitLabel(item: Record<string, unknown>): string {
  const u = item.unit
  if (u != null && String(u).trim()) return String(u).trim()
  return 'carton'
}

const DEFAULT_MIN_ORDER = 10

/** Min order quantity: custom field or description hint, else default. */
export function zohoMinOrderQuantity(item: Record<string, unknown> | null, fallback = DEFAULT_MIN_ORDER): number {
  if (!item) return fallback
  const cf = item.custom_fields
  if (Array.isArray(cf)) {
    for (const raw of cf) {
      if (!raw || typeof raw !== 'object') continue
      const f = raw as Record<string, unknown>
      const label = String(f.label ?? '').toLowerCase()
      if (
        (label.includes('min') && (label.includes('order') || label.includes('qty'))) ||
        label.includes('moq')
      ) {
        const v = Number(f.value)
        if (Number.isFinite(v) && v > 0) return Math.floor(v)
      }
    }
  }
  const desc = String(item.description ?? '')
  const m = desc.match(/min\.?\s*(?:order|qty|quantity|cartons?)[:\s]*(\d+)/i)
  if (m) {
    const v = Number(m[1])
    if (Number.isFinite(v) && v > 0) return v
  }
  return fallback
}
