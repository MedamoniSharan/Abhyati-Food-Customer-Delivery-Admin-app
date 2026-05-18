/**
 * Print Zoho Books ids needed for customer pricing tiers (.env).
 *
 * From my-app/backend (requires ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_REGION in .env):
 *
 *   npm run zoho:pricing-env -- 2179961000013482090
 *
 * Optional: list customer contacts whose name contains TEXT, then GET the first match for custom fields:
 *
 *   npm run zoho:pricing-env -- --search=Abhyati
 *
 * If ZOHO_PRICING_TIERS_CONTACT_ID is already set in .env, you can omit the id:
 *
 *   npm run zoho:pricing-env
 */
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

function pickArg(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'))
  return positional[2]?.trim() || ''
}

function pickSearch(argv) {
  const raw = argv.find((a) => a.startsWith('--search='))
  if (!raw) return ''
  return decodeURIComponent(raw.slice('--search='.length).trim())
}

async function main() {
  const argv = process.argv
  const search = pickSearch(argv)
  let id = pickArg(argv)

  const { env } = await import('../src/config/env.js')
  const { getModuleById, listModule, getOrganizationId } = await import('../src/services/zohoBooksService.js')

  const orgId = await getOrganizationId()
  console.log('')
  console.log('Resolved organization_id:', orgId)
  if (!env.ZOHO_ORGANIZATION_ID) {
    console.log('(Set ZOHO_ORGANIZATION_ID in .env to pin this org explicitly.)')
  }
  console.log('')

  if (!id && search) {
    const data = await listModule('/contacts', {
      search_text: search,
      contact_type: 'customer',
      per_page: 25,
      page: 1
    })
    const rows = Array.isArray(data?.contacts) ? data.contacts : []
    if (rows.length === 0) {
      console.error(`No customers found for search_text="${search}". Try another --search= or pass contact id from Books URL.`)
      process.exit(1)
    }
    console.log(`Contacts matching search "${search}" (showing up to ${rows.length}):`)
    for (const c of rows) {
      console.log(`  ${c.contact_id}\t${c.contact_name || ''}`)
    }
    console.log('')
    console.log('Pick the catalog contact (e.g. _AbhyatiPricingTiers), then run:')
    console.log(`  npm run zoho:pricing-env -- <contact_id>`)
    process.exit(0)
  }

  if (!id) id = String(env.ZOHO_PRICING_TIERS_CONTACT_ID || '').trim()
  if (!id) {
    console.error('Missing contact id. Examples:')
    console.error('  npm run zoho:pricing-env -- 2179961000013482090')
    console.error('  npm run zoho:pricing-env -- --search=Abhyati')
    process.exit(1)
  }

  const data = await getModuleById('/contacts', id)
  const c = data?.contact || data
  if (!c?.contact_id) {
    console.error('Unexpected response (no contact). Raw keys:', data && typeof data === 'object' ? Object.keys(data) : data)
    process.exit(1)
  }

  console.log('Contact')
  console.log('  contact_id:   ', c.contact_id)
  console.log('  contact_name: ', c.contact_name || '')
  console.log('  contact_type: ', c.contact_type || '')
  console.log('')

  let cfs = Array.isArray(c.custom_fields) ? c.custom_fields : []
  if (cfs.length === 0) {
    console.log('No custom_fields on this contact — fetching org-wide Contact custom fields (settings API)…')
    console.log('')
    try {
      const settingsData = await listModule('/settings/fields', {
        entity: 'contact',
        filter_custom_fields: true
      })
      const defs = Array.isArray(settingsData?.fields) ? settingsData.fields : []
      if (defs.length === 0) {
        console.log('No contact custom fields in this org. In Zoho Books: Settings → Preferences →')
        console.log('Customers → Custom fields — create two fields (JSON list + tier id), then run again.')
        process.exit(0)
      }
      console.log('Contact module custom fields (field_id = use as ZOHO_CUSTOM_FIELD_* in .env)')
      console.log('')
      for (const f of defs) {
        const fid = f.field_id ?? f.customfield_id
        console.log(`  field_id:   ${fid}`)
        console.log(`  label:      ${f.label || ''}`)
        console.log(`  api_name:   ${f.api_name || ''}`)
        console.log(`  data_type:  ${f.data_type || ''}`)
        console.log('')
      }
      cfs = defs.map((f) => ({
        customfield_id: f.field_id ?? f.customfield_id,
        label: f.label,
        api_name: f.api_name,
        data_type: f.data_type,
        value: ''
      }))
    } catch (e) {
      console.error(String(e?.message || e))
      console.log('')
      console.log('If this was a 401/403, regenerate the Zoho refresh token with scope ZohoBooks.settings.READ')
      console.log('or open this contact in Books once after adding custom fields and run again.')
      process.exit(1)
    }
  } else {
    console.log('Custom fields on this contact (use customfield_id in .env)')
    console.log('')
    for (const f of cfs) {
      const fid = f.customfield_id ?? f.customfieldid
      const lab = f.label || f.api_name || ''
      let val = f.value
      if (val != null && String(val).length > 80) val = `${String(val).slice(0, 80)}…`
      console.log(`  customfield_id: ${fid}`)
      console.log(`  label:          ${lab}`)
      console.log(`  value (sample): ${val == null || val === '' ? '(empty)' : val}`)
      console.log('')
    }
  }

  const labelOf = (f) => `${f.label || ''} ${f.api_name || ''}`.toLowerCase()
  const tiersJsonHint = cfs.find((f) => {
    const v = f.value
    if (typeof v === 'string' && (/^\s*[\[{]/.test(v) || v.length > 200)) return true
    return /json|catalog|tier list|tiers json/.test(labelOf(f))
  })
  const customerTierHint = cfs.find((f) => {
    if (String(f.customfield_id) === String(tiersJsonHint?.customfield_id)) return false
    return /tier id|assigned tier|customer tier|pricing tier/.test(labelOf(f))
  })

  let jsonId = tiersJsonHint?.customfield_id
  let tierIdField = customerTierHint?.customfield_id
  if (!jsonId && !tierIdField && cfs.length === 2) {
    const byMultiline = cfs.find((f) => /multiline|textarea|text/i.test(String(f.data_type || '')))
    if (byMultiline) {
      jsonId = byMultiline.customfield_id
      tierIdField = cfs.find((f) => String(f.customfield_id) !== String(jsonId))?.customfield_id
    } else {
      jsonId = cfs[0].customfield_id
      tierIdField = cfs[1].customfield_id
    }
    console.log('(Heuristic: org has exactly 2 contact custom fields — mapped first/second to JSON + tier id.)')
    console.log('')
  }

  console.log('--- Paste into backend/.env (verify custom field ids match labels above) ---')
  console.log('')
  console.log(`ZOHO_ORGANIZATION_ID=${orgId}`)
  console.log(`ZOHO_PRICING_TIERS_CONTACT_ID=${c.contact_id}`)
  if (jsonId) {
    console.log(`ZOHO_CUSTOM_FIELD_TIERS_JSON_ID=${jsonId}`)
  } else {
    console.log('# ZOHO_CUSTOM_FIELD_TIERS_JSON_ID=<customfield_id for JSON tier list — see table above>')
  }
  if (tierIdField) {
    console.log(`ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID=${tierIdField}`)
  } else {
    console.log('# ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID=<customfield_id for per-customer tier id — see table above>')
  }
  console.log('')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
