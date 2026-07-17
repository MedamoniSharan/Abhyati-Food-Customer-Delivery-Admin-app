import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isGoogleMapsUrl,
  normalizeMapsLink,
  pickMapsLinkFromZohoAddressBlock,
  resolveMapsQuery,
  buildZohoDeliveryAddressBlock,
  formatInvoiceMapsNote,
  pickMapsLinkFromInvoiceNotes,
  pickMapsLinkFromInvoice
} from '../src/util/customerMapsLink.js'

describe('customerMapsLink', () => {
  it('accepts common Google Maps share URLs', () => {
    assert.equal(isGoogleMapsUrl('https://maps.app.goo.gl/abc123'), true)
    assert.equal(isGoogleMapsUrl('https://www.google.com/maps/place/Hyderabad'), true)
    assert.equal(isGoogleMapsUrl('https://example.com/not-maps'), false)
  })

  it('normalizes maps links with https', () => {
    assert.equal(normalizeMapsLink('maps.app.goo.gl/xyz'), 'https://maps.app.goo.gl/xyz')
    assert.equal(normalizeMapsLink('https://not-maps.example/x'), '')
  })

  it('reads maps link from Zoho street2', () => {
    assert.equal(
      pickMapsLinkFromZohoAddressBlock({ address: 'Main road', street2: 'https://maps.app.goo.gl/test' }),
      'https://maps.app.goo.gl/test'
    )
  })

  it('prefers maps link over address text for navigation query', () => {
    assert.equal(
      resolveMapsQuery({
        mapsLink: 'https://maps.app.goo.gl/test',
        addressText: '123 Street, City'
      }),
      'https://maps.app.goo.gl/test'
    )
    assert.equal(resolveMapsQuery({ addressText: '123 Street' }), '123 Street')
  })

  it('builds Zoho address block with maps link in street2', () => {
    const block = buildZohoDeliveryAddressBlock({
      billing_address: {
        address: '123 Test Lane',
        street2: 'https://maps.app.goo.gl/customer-pin',
        city: 'Hyderabad'
      }
    })
    assert.equal(block.address, '123 Test Lane')
    assert.equal(block.street2, 'https://maps.app.goo.gl/customer-pin')
    assert.equal(block.city, 'Hyderabad')
  })

  it('stores maps link in invoice notes when billing address is length-limited', () => {
    const note = formatInvoiceMapsNote('https://maps.app.goo.gl/abc')
    assert.equal(note, '__abh_maps:https://maps.app.goo.gl/abc')
    assert.equal(
      pickMapsLinkFromInvoiceNotes({ notes: 'Thanks\n__abh_maps:https://maps.app.goo.gl/abc' }),
      'https://maps.app.goo.gl/abc'
    )
    assert.equal(
      pickMapsLinkFromInvoice({
        billing_address: { address: 'Short st' },
        notes: '__abh_maps:https://www.google.com/maps/place/Test'
      }),
      'https://www.google.com/maps/place/Test'
    )
  })
})
