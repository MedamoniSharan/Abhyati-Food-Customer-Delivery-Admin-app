import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyCustomerPrice, parseTiersJson } from '../src/services/customerPricingMath.js'

describe('customerPricingMath', () => {
  it('applyCustomerPrice leaves base when no tier', () => {
    assert.equal(applyCustomerPrice(100, null), 100)
  })

  it('applyCustomerPrice percent then flat', () => {
    assert.equal(applyCustomerPrice(100, { discountPercent: 10, discountAmountInr: 5 }), 85)
  })

  it('applyCustomerPrice percent only', () => {
    assert.equal(applyCustomerPrice(200, { discountPercent: 25 }), 150)
  })

  it('applyCustomerPrice flat only', () => {
    assert.equal(applyCustomerPrice(100, { discountAmountInr: 30 }), 70)
  })

  it('applyCustomerPrice floors at zero', () => {
    assert.equal(applyCustomerPrice(50, { discountPercent: 50, discountAmountInr: 100 }), 0)
  })

  it('parseTiersJson accepts valid array', () => {
    const raw = JSON.stringify([{ id: 'a', name: 'A', discountPercent: 5 }])
    const tiers = parseTiersJson(raw)
    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].id, 'a')
  })

  it('parseTiersJson rejects invalid json', () => {
    assert.throws(() => parseTiersJson('not-json'), /Invalid tiers JSON/)
  })

  it('parseTiersJson rejects tier without discount', () => {
    const raw = JSON.stringify([{ id: 'x', name: 'X' }])
    assert.throws(() => parseTiersJson(raw), /Each tier must have/)
  })
})
