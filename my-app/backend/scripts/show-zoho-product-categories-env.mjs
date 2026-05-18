/**
 * Print Zoho Books ids for product categories (.env) and optionally write backend/.env.
 *
 * From my-app/backend:
 *
 *   npm run zoho:product-categories-env
 *
 * List customers to pick a catalog contact (reuse pricing catalog contact or create a dedicated one):
 *
 *   npm run zoho:product-categories-env -- --search=Abhyati
 *
 * Show custom fields on a contact + org-wide contact/item field definitions:
 *
 *   npm run zoho:product-categories-env -- 2179961000012345678
 *
 * Write all three vars (comma-separated: contact_id, contact_json_field_id, item_category_field_id):
 *
 *   npm run zoho:product-categories-env -- --apply=2179961000011111111,2179961000022222222,2179961000033333333
 *
 * Or set individually (on Windows quote flags so npm passes them through):
 *
 *   node scripts/show-zoho-product-categories-env.mjs --apply-contact=... --apply-contact-json=... --apply-item-category=...
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
config({ path: envPath })

function pickArg(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'))
  return positional[2]?.trim() || ''
}

function pickSearch(argv) {
  const raw = argv.find((a) => a.startsWith('--search='))
  if (!raw) return ''
  return decodeURIComponent(raw.slice('--search='.length).trim())
}

function flagValue(argv, prefix) {
  const a = argv.find((x) => x.startsWith(prefix))
  return a ? a.slice(prefix.length).trim() : ''
}

function upsertEnvLine(text, key, val) {
  let out = text.replace(/\r\n/g, '\n')
  const line = `${key}=${val}`
  const re = new RegExp(`^#?\\s*${key}=.*$`, 'm')
  if (re.test(out)) out = out.replace(re, line)
  else out = out.trimEnd() + '\n' + line + '\n'
  return out.endsWith('\n') ? out : `${out}\n`
}

async function listItemFieldDefinitions(listModule) {
  const attempts = [
    { entity: 'item', filter_custom_fields: true },
    { entity: 'item', filter_custom_fields: false },
    { entity: 'item' },
    { entity: 'items', filter_custom_fields: true },
    { entity: 'product', filter_custom_fields: true }
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

async function listContactFieldDefinitions(listModule) {
  const attempts = [
    { entity: 'contact', filter_custom_fields: true },
    { entity: 'contact', filter_custom_fields: false },
    { entity: 'contact' },
    { entity: 'contacts', filter_custom_fields: true },
    { entity: 'customer', filter_custom_fields: true }
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

function printItemFields(defs) {
  console.log('Item custom fields (pick one **string** / text field for the category *name* → ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID)')
  console.log('Often: cf_category_name or similar.')
  console.log('')
  for (const f of defs) {
    const fid = f.field_id ?? f.customfield_id
    const api = f.field_name || f.api_name || ''
    const mark =
      /category/i.test(`${f.label || ''} ${api}`) && String(f.data_type || '').toLowerCase() === 'string' ? '  ← likely' : ''
    console.log(`  field_id:   ${fid}${mark}`)
    console.log(`  label:      ${f.label || ''}`)
    console.log(`  api_name:   ${api}`)
    console.log(`  data_type:  ${f.data_type || ''}`)
    console.log('')
  }
}

function printContactFields(defs) {
  console.log('Contact custom fields (pick one **multiline** or long **string** field for JSON array → ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID)')
  console.log('Create a new field on your catalog contact if you do not want to reuse pricing JSON field.')
  console.log('')
  for (const f of defs) {
    const fid = f.field_id ?? f.customfield_id
    const dt = String(f.data_type || '').toLowerCase()
    const mark = /multiline|textarea|url|text/.test(dt) || dt === 'string' ? '  ← often used for JSON' : ''
    console.log(`  field_id:   ${fid}${mark}`)
    console.log(`  label:      ${f.label || ''}`)
    console.log(`  api_name:   ${f.field_name || f.api_name || ''}`)
    console.log(`  data_type:  ${f.data_type || ''}`)
    console.log('')
  }
}

async function main() {
  const argv = process.argv
  const search = pickSearch(argv)
  let contactId = pickArg(argv)

  const applyTriple = flagValue(argv, '--apply=')
  const applyContact = flagValue(argv, '--apply-contact=') || (applyTriple ? applyTriple.split(',')[0]?.trim() : '')
  const applyJson =
    flagValue(argv, '--apply-contact-json=') ||
    (applyTriple ? applyTriple.split(',')[1]?.trim() : '')
  const applyItem =
    flagValue(argv, '--apply-item-category=') ||
    (applyTriple ? applyTriple.split(',')[2]?.trim() : '')

  const { env } = await import('../src/config/env.js')
  const { listModule, getModuleById, getOrganizationId } = await import('../src/services/zohoBooksService.js')

  const orgId = await getOrganizationId()
  console.log('')
  console.log('organization_id:', orgId)
  console.log('')

  if (applyContact || applyJson || applyItem) {
    const checks = [
      [applyContact, 'ZOHO_PRODUCT_CATEGORIES_CONTACT_ID / --apply-contact'],
      [applyJson, 'ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID / --apply-contact-json'],
      [applyItem, 'ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID / --apply-item-category']
    ]
    for (const [val, label] of checks) {
      if (!val) continue
      if (!/^\d+$/.test(val)) {
        console.error(`${label} must be a numeric id, got: "${val}"`)
        process.exit(1)
      }
    }
    if (applyTriple) {
      const p = applyTriple.split(',').map((s) => s.trim()).filter(Boolean)
      if (p.length !== 3) {
        console.error('--apply= must be exactly three comma-separated ids: CONTACT_ID,CONTACT_JSON_FIELD_ID,ITEM_FIELD_ID')
        process.exit(1)
      }
    }
    const raw = readFileSync(envPath, 'utf8')
    let next = raw
    if (applyContact) next = upsertEnvLine(next, 'ZOHO_PRODUCT_CATEGORIES_CONTACT_ID', applyContact)
    if (applyJson) next = upsertEnvLine(next, 'ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID', applyJson)
    if (applyItem) next = upsertEnvLine(next, 'ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID', applyItem)
    writeFileSync(envPath, next, 'utf8')
    console.log('Updated', envPath)
    console.log('')
    if (applyContact) console.log(`ZOHO_PRODUCT_CATEGORIES_CONTACT_ID=${applyContact}`)
    if (applyJson) console.log(`ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID=${applyJson}`)
    if (applyItem) console.log(`ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID=${applyItem}`)
    console.log('')
    console.log('Restart the backend so env.js picks up the new variables.')
    process.exit(0)
  }

  if (search) {
    const data = await listModule('/contacts', {
      search_text: search,
      contact_type: 'customer',
      per_page: 25,
      page: 1
    })
    const rows = Array.isArray(data?.contacts) ? data.contacts : []
    if (rows.length === 0) {
      console.error(`No customers found for search_text="${search}". Try another --search= or pass contact_id.`)
      process.exit(1)
    }
    console.log(`Contacts matching "${search}" (use one as ZOHO_PRODUCT_CATEGORIES_CONTACT_ID if it is your catalog row):`)
    console.log('')
    for (const c of rows) {
      console.log(`  ${c.contact_id}\t${c.contact_name || ''}`)
    }
    console.log('')
    console.log('Then run:  npm run zoho:product-categories-env -- <contact_id>')
    process.exit(0)
  }

  if (!contactId) contactId = String(env.ZOHO_PRICING_TIERS_CONTACT_ID || '').trim()
  if (!contactId) contactId = String(env.ZOHO_PRODUCT_CATEGORIES_CONTACT_ID || '').trim()

  let itemDefs = []
  try {
    const settingsData = await listItemFieldDefinitions(listModule)
    itemDefs = Array.isArray(settingsData?.fields) ? settingsData.fields : []
  } catch (e) {
    console.error('Failed to list item custom fields:', e?.message || e)
    process.exit(1)
  }
  printItemFields(itemDefs)

  let contactDefs = []
  try {
    const settingsData = await listContactFieldDefinitions(listModule)
    contactDefs = Array.isArray(settingsData?.fields) ? settingsData.fields : []
  } catch (e) {
    console.error('Failed to list contact custom fields:', e?.message || e)
    process.exit(1)
  }
  printContactFields(contactDefs)
  console.log(
    'WARNING: Do not reuse the pricing tier JSON field (e.g. cf_abhyati_tier_catalog_json). Add a separate multiline contact field for product categories JSON.'
  )
  console.log('')

  if (contactId) {
    const data = await getModuleById('/contacts', contactId)
    const c = data?.contact || data
    if (c?.contact_id) {
      console.log('--- Custom field values on selected catalog contact ---')
      console.log(`contact_id: ${c.contact_id}`)
      console.log(`contact_name: ${c.contact_name || ''}`)
      console.log('')
      const cfs = Array.isArray(c.custom_fields) ? c.custom_fields : []
      if (cfs.length === 0) {
        console.log('(No custom_fields on this contact in API response — use field_id list above.)')
      } else {
        for (const f of cfs) {
          const fid = f.customfield_id ?? f.customfieldid
          let val = f.value
          if (val != null && String(val).length > 60) val = `${String(val).slice(0, 60)}…`
          console.log(`  customfield_id: ${fid}`)
          console.log(`  label:          ${f.label || f.api_name || ''}`)
          console.log(`  value:          ${val == null || val === '' ? '(empty)' : val}`)
          console.log('')
        }
      }
      console.log('')
    } else {
      console.log(`(Could not load contact ${contactId} — check id.)`)
      console.log('')
    }
  } else {
    console.log('(No catalog contact id yet — pass one as first argument, or set ZOHO_PRICING_TIERS_CONTACT_ID / ZOHO_PRODUCT_CATEGORIES_CONTACT_ID in .env, or use --search=Name)')
    console.log('')
  }

  console.log('--- Paste into backend/.env ---')
  console.log('')
  if (contactId) console.log(`ZOHO_PRODUCT_CATEGORIES_CONTACT_ID=${contactId}`)
  else console.log('# ZOHO_PRODUCT_CATEGORIES_CONTACT_ID=<contact_id>')
  console.log('# ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID=<contact custom field_id from list above>')
  console.log('# ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID=<item custom field_id from list above>')
  console.log('')
  console.log('Write .env in one shot (contact, contact JSON field, item category field):')
  console.log('  npm run zoho:product-categories-env -- --apply=CONTACT_ID,CONTACT_JSON_FIELD_ID,ITEM_FIELD_ID')
  console.log('')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
