import { z } from 'zod'

const tierSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(200),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmountInr: z.number().min(0).optional()
  })
  .refine(
    (t) =>
      (Number(t.discountPercent) > 0 && Number.isFinite(Number(t.discountPercent))) ||
      (Number(t.discountAmountInr) > 0 && Number.isFinite(Number(t.discountAmountInr))),
    { message: 'Each tier must have at least one of: discountPercent > 0 or discountAmountInr > 0' }
  )

export const pricingTiersArraySchema = z.array(tierSchema)

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Percent first, then subtract flat.
 * @param {number|string} base
 * @param {{ discountPercent?: number, discountAmountInr?: number } | null} tier
 */
export function applyCustomerPrice(base, tier) {
  const b = typeof base === 'number' ? base : Number(base)
  if (!Number.isFinite(b) || b < 0) return typeof base === 'number' ? base : Number(base) || 0
  if (!tier || typeof tier !== 'object') return round2(b)
  const pct = Number(tier.discountPercent)
  const flat = Number(tier.discountAmountInr)
  const p = Number.isFinite(pct) && pct > 0 ? pct : 0
  const f = Number.isFinite(flat) && flat > 0 ? flat : 0
  if (p === 0 && f === 0) return round2(b)
  const afterPct = b * (1 - p / 100)
  const out = afterPct - f
  return Math.max(0, round2(out))
}

export function parseTiersJson(raw) {
  if (raw == null || raw === '') return []
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw new Error('Invalid tiers JSON in Zoho custom field')
  }
  if (!Array.isArray(parsed)) throw new Error('Tiers JSON must be an array')
  return pricingTiersArraySchema.parse(parsed)
}

export function serializeTiersForZoho(tiers) {
  const list = pricingTiersArraySchema.parse(tiers)
  return JSON.stringify(list)
}

export function validateSingleTier(tier) {
  return tierSchema.parse(tier)
}
