/** Recognize share links customers paste from Google Maps. */
export function isGoogleMapsUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return false
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'maps.google.com') return true
    if (host.endsWith('google.com') && (url.pathname.includes('/maps') || url.searchParams.has('q'))) return true
    return false
  } catch {
    return false
  }
}

/** Normalize to https URL or empty when invalid. */
export function normalizeMapsLink(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withScheme = raw.startsWith('http') ? raw : `https://${raw}`
  return isGoogleMapsUrl(withScheme) ? withScheme : ''
}

export function pickMapsLinkFromZohoAddressBlock(addr) {
  if (!addr || typeof addr !== 'object') return ''
  return normalizeMapsLink(addr.street2)
}

export function resolveMapsQuery({ mapsLink, addressText }) {
  const link = normalizeMapsLink(mapsLink)
  if (link) return link
  return String(addressText || '').trim()
}

/** Zoho billing/shipping block copied onto invoices at checkout (includes maps link in street2). */
export function buildZohoDeliveryAddressBlock(contact) {
  if (!contact || typeof contact !== 'object') return null
  const bill = contact.billing_address && typeof contact.billing_address === 'object' ? contact.billing_address : {}
  const ship = contact.shipping_address && typeof contact.shipping_address === 'object' ? contact.shipping_address : {}
  const source = String(bill.address || '').trim() ? bill : ship
  const address = String(source.address || bill.address || ship.address || '').trim()
  const mapsLink = pickMapsLinkFromZohoAddressBlock(bill) || pickMapsLinkFromZohoAddressBlock(ship)
  const phone =
    String(contact.mobile || contact.phone || bill.phone || ship.phone || '').trim() ||
    String(
      (Array.isArray(contact.contact_persons) &&
        (contact.contact_persons.find((p) => p?.is_primary_contact)?.phone ||
          contact.contact_persons[0]?.phone ||
          contact.contact_persons.find((p) => p?.is_primary_contact)?.mobile ||
          contact.contact_persons[0]?.mobile)) ||
        ''
    ).trim()
  const block = {}
  if (address) block.address = address
  if (mapsLink) block.street2 = mapsLink
  if (phone) block.phone = phone
  for (const key of ['city', 'state', 'zip', 'country']) {
    const val = String(source[key] || bill[key] || ship[key] || '').trim()
    if (val) block[key] = val
  }
  if (!block.address && !block.street2 && !block.phone) return null
  return block
}

const INVOICE_MAPS_NOTE_PREFIX = '__abh_maps:'

/** Embed customer maps link in Zoho invoice notes (billing_address has tight length limits). */
export function formatInvoiceMapsNote(mapsLink) {
  const link = normalizeMapsLink(mapsLink)
  return link ? `${INVOICE_MAPS_NOTE_PREFIX}${link}` : ''
}

export function pickMapsLinkFromInvoiceNotes(invoice) {
  const text = [invoice?.notes, invoice?.terms].map((v) => String(v || '').trim()).filter(Boolean).join('\n')
  if (!text) return ''
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(INVOICE_MAPS_NOTE_PREFIX))
  if (!line) return ''
  return normalizeMapsLink(line.slice(INVOICE_MAPS_NOTE_PREFIX.length))
}

/**
 * Zoho invoice billing_address.address is limited (~100 chars). Maps link goes in invoice notes.
 * @returns {{ billing_address: object|null, mapsLink: string, mapsNote: string }}
 */
export function buildZohoInvoiceCheckoutAddress(deliveryAddressBlock) {
  if (!deliveryAddressBlock || typeof deliveryAddressBlock !== 'object') {
    return { billing_address: null, mapsLink: '', mapsNote: '' }
  }
  const mapsLink = normalizeMapsLink(deliveryAddressBlock.street2)
  const address = String(deliveryAddressBlock.address || '').trim().slice(0, 100)
  const phone = String(deliveryAddressBlock.phone || '').trim().slice(0, 50)
  if (!address && !phone) {
    return { billing_address: null, mapsLink, mapsNote: formatInvoiceMapsNote(mapsLink) }
  }
  const billing_address = {}
  if (address) billing_address.address = address
  if (phone) billing_address.phone = phone
  for (const key of ['city', 'state', 'zip', 'country']) {
    const val = String(deliveryAddressBlock[key] || '').trim()
    if (val) billing_address[key] = val.slice(0, 50)
  }
  return { billing_address, mapsLink, mapsNote: formatInvoiceMapsNote(mapsLink) }
}

export function pickMapsLinkFromInvoice(invoice) {
  return (
    pickMapsLinkFromZohoAddressBlock(invoice?.shipping_address) ||
    pickMapsLinkFromZohoAddressBlock(invoice?.billing_address) ||
    pickMapsLinkFromInvoiceNotes(invoice)
  )
}
