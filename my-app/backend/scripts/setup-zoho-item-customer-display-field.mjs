/**
 * Create the Zoho Books *item* string custom field for customer-facing product name (if missing),
 * and set ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID in backend/.env.
 *
 * Requires OAuth scopes including ZohoBooks.settings.CREATE.
 *
 * From my-app/backend:
 *   npm run zoho:setup-item-customer-display-field
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
config({ path: envPath })

const FIELD_LABEL = 'Abhyati customer product name'
const FIELD_API = 'cf_abhyati_customer_product_name'

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

async function listItemFieldDefinitions(listModule) {
  const attempts = [
    { entity: 'item', filter_custom_fields: true },
    { entity: 'item', filter_custom_fields: false },
    { entity: 'item' }
  ]
  let lastErr = null
  for (const q of attempts) {
    try {
      return await listModule('/settings/fields', q)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

async function main() {
  const { listModule, createModule, getOrganizationId } = await import('../src/services/zohoBooksService.js')

  const orgId = await getOrganizationId()
  console.log('')
  console.log('organization_id:', orgId)
  console.log('')

  const defsRes = await listItemFieldDefinitions(listModule)
  const existing = Array.isArray(defsRes?.fields) ? defsRes.fields : []

  const findBy = (label, apiName) =>
    existing.find((f) => {
      const fn = String(f.field_name || f.api_name || '')
      const lb = String(f.label || '').trim()
      return lb === label || fn === apiName
    })

  let field = findBy(FIELD_LABEL, FIELD_API)

  if (!field) {
    console.log('Creating item custom field:', FIELD_LABEL, '…')
    const r = await createModule('/settings/fields', {
      label: FIELD_LABEL,
      data_type: 'string',
      entity: 'item',
      show_on_pdf: false,
      is_mandatory: false,
      value_length: 255
    })
    field = r.data || r.field || r
    console.log('  customfield_id:', resolveFieldId(r.data || r.field || r))
  } else {
    console.log('Found existing field:', resolveFieldId(field), field.label || field.field_name || field.api_name)
  }

  const fid = resolveFieldId(field)
  if (!fid) {
    console.error('Could not resolve field id from Zoho response.', field)
    process.exit(1)
  }

  console.log('')
  console.log('--- .env ---')
  console.log(`ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID=${fid}`)
  console.log('')

  const raw = readFileSync(envPath, 'utf8')
  writeFileSync(envPath, upsertEnvLine(raw, 'ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID', fid), 'utf8')
  console.log('Updated', envPath, '— add this field to your item layout in Zoho if needed, then restart the backend.')
}

main().catch((e) => {
  const msg = e?.response?.data?.message || e?.message || String(e)
  console.error(msg)
  if (String(msg).includes('scope') || String(msg).includes('401') || String(msg).includes('403')) {
    console.log('')
    console.log('Regenerate Zoho refresh token with ZohoBooks.settings.CREATE scope.')
  }
  process.exit(1)
})
