/**
 * Create the Zoho Books *contact* multiline custom field for product category JSON (if missing),
 * seed the catalog contact with [], and set ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID in .env.
 *
 * Requires OAuth scopes including ZohoBooks.settings.CREATE and ZohoBooks.contacts.UPDATE.
 *
 * From my-app/backend:
 *   npm run zoho:setup-product-categories-json-field
 *
 * Optional catalog contact id (defaults to ZOHO_PRODUCT_CATEGORIES_CONTACT_ID, then ZOHO_PRICING_TIERS_CONTACT_ID):
 *   npm run zoho:setup-product-categories-json-field -- 2179961000013482090
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
config({ path: envPath })

const JSON_FIELD_LABEL = 'Abhyati product categories JSON'
/** Used only to detect an existing field if Zoho assigned this api_name */
const JSON_FIELD_API = 'cf_abhyati_product_categories_json'

function pickContactId(argv) {
  const pos = argv.filter((a) => !a.startsWith('--'))
  return pos[2]?.trim() || ''
}

function mergeCf(contact, fieldId, value) {
  const id = String(fieldId)
  const cfs = Array.isArray(contact?.custom_fields) ? contact.custom_fields.map((x) => ({ ...x })) : []
  const idx = cfs.findIndex((x) => String(x?.customfield_id) === id)
  if (idx >= 0) cfs[idx] = { ...cfs[idx], customfield_id: id, value }
  else cfs.push({ customfield_id: id, value })
  return cfs
}

function upsertEnvLine(text, key, val) {
  let out = text.replace(/\r\n/g, '\n')
  const line = `${key}=${val}`
  const re = new RegExp(`^#?\\s*${key}=.*$`, 'm')
  if (re.test(out)) out = out.replace(re, line)
  else out = out.trimEnd() + '\n' + line + '\n'
  return out.endsWith('\n') ? out : `${out}\n`
}

function resolveFieldId(f) {
  if (!f || typeof f !== 'object') return ''
  if (f.data && typeof f.data === 'object') return resolveFieldId(f.data)
  return String(f.customfield_id || f.field_id || '').trim()
}

async function main() {
  const argv = process.argv
  const { env } = await import('../src/config/env.js')
  const { listModule, createModule, getModuleById, updateModule, getOrganizationId } = await import(
    '../src/services/zohoBooksService.js'
  )

  const orgId = await getOrganizationId()
  let catalogId =
    pickContactId(argv) ||
    String(env.ZOHO_PRODUCT_CATEGORIES_CONTACT_ID || '').trim() ||
    String(env.ZOHO_PRICING_TIERS_CONTACT_ID || '').trim()
  if (!catalogId) {
    console.error(
      'Set ZOHO_PRODUCT_CATEGORIES_CONTACT_ID (or ZOHO_PRICING_TIERS_CONTACT_ID) in .env, or pass contact id:\n' +
        '  npm run zoho:setup-product-categories-json-field -- <contact_id>'
    )
    process.exit(1)
  }

  console.log('organization_id:', orgId)
  console.log('catalog contact_id:', catalogId)
  console.log('')

  const defs = await listModule('/settings/fields', { entity: 'contact', filter_custom_fields: true })
  const existing = Array.isArray(defs?.fields) ? defs.fields : []

  const findBy = (label, apiName) =>
    existing.find((f) => {
      const fn = String(f.field_name || f.api_name || '')
      const lb = String(f.label || '').trim()
      return lb === label || fn === apiName
    })

  let jsonField = findBy(JSON_FIELD_LABEL, JSON_FIELD_API)

  if (!jsonField) {
    console.log('Creating contact custom field:', JSON_FIELD_LABEL, '…')
    const r = await createModule('/settings/fields', {
      label: JSON_FIELD_LABEL,
      data_type: 'multiline',
      entity: 'contact',
      show_on_pdf: false,
      is_mandatory: false
    })
    jsonField = r.data || r.field || r
    console.log('  customfield_id:', resolveFieldId(r.data || r.field || r))
  } else {
    console.log('Found existing field:', resolveFieldId(jsonField), jsonField.label || jsonField.field_name || jsonField.api_name)
  }

  const jsonFid = resolveFieldId(jsonField)
  if (!jsonFid) {
    console.error('Could not resolve field id from Zoho response.', jsonField)
    process.exit(1)
  }

  console.log('')
  console.log('Seeding catalog contact categories JSON with [] …')
  const detail = await getModuleById('/contacts', catalogId)
  const c = detail?.contact || detail
  if (!c?.contact_id) {
    console.error('Catalog contact not found')
    process.exit(1)
  }
  const custom_fields = mergeCf(c, jsonFid, '[]')
  await updateModule('/contacts', catalogId, { contact_id: catalogId, custom_fields })

  console.log('')
  console.log('--- .env ---')
  console.log(`ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID=${jsonFid}`)
  console.log('')

  const raw = readFileSync(envPath, 'utf8')
  writeFileSync(envPath, upsertEnvLine(raw, 'ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID', jsonFid), 'utf8')
  console.log('Updated', envPath, '— restart the backend to pick up changes.')
}

main().catch((e) => {
  const msg = e?.response?.data?.message || e?.message || String(e)
  console.error(msg)
  if (String(msg).includes('scope') || String(msg).includes('401') || String(msg).includes('403')) {
    console.log('')
    console.log('Regenerate Zoho refresh token with ZohoBooks.settings.CREATE and contacts update scope.')
  }
  process.exit(1)
})
