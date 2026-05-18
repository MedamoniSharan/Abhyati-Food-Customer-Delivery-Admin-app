/**
 * List Zoho Books *item* custom fields and optionally set ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID in .env.
 *
 * From my-app/backend (uses ZOHO_* from .env):
 *
 *   npm run zoho:item-customer-name-env
 *
 * Write / update .env (pick the id from the table Zoho shows):
 *
 *   npm run zoho:item-customer-name-env -- --apply=2179961000012345678
 *
 * Or positional:
 *
 *   npm run zoho:item-customer-name-env -- 2179961000012345678
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
config({ path: envPath })

function pickApplyId(argv) {
  const fromFlag = argv.find((a) => a.startsWith('--apply='))
  if (fromFlag) return fromFlag.slice('--apply='.length).trim()
  const pos = argv.filter((a) => !a.startsWith('--'))
  const maybe = pos[2]?.trim()
  if (maybe && /^\d+$/.test(maybe)) return maybe
  return ''
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
      return { source: 'settings', data: await listModule('/settings/fields', q) }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

async function listFieldsFromSampleItem(listModule, getModuleById) {
  const list = await listModule('/items', { per_page: 1, page: 1 })
  const rows = Array.isArray(list?.items) ? list.items : []
  const id = rows[0]?.item_id
  if (!id) {
    return {
      source: 'sample_item',
      data: { fields: [], note: 'No items in Zoho to sample.' }
    }
  }
  const detail = await getModuleById('/items', String(id))
  const item = detail?.item ?? detail
  const cfs = Array.isArray(item?.custom_fields) ? item.custom_fields : []
  const fields = cfs.map((f) => ({
    field_id: f.customfield_id ?? f.customfieldid,
    customfield_id: f.customfield_id ?? f.customfieldid,
    label: f.label || f.placeholder || '',
    api_name: f.api_name || f.field_name || '',
    data_type: f.data_type || 'string',
    _sample_value: f.value
  }))
  return {
    source: 'sample_item',
    data: {
      fields,
      note: `Sample item_id=${id} — ids are from this item's custom_fields (same as Settings → Items custom fields).`
    }
  }
}

async function main() {
  const argv = process.argv
  const applyId = pickApplyId(argv)

  const { listModule, getModuleById, getOrganizationId } = await import('../src/services/zohoBooksService.js')

  const orgId = await getOrganizationId()
  console.log('')
  console.log('organization_id:', orgId)
  console.log('')

  let pack
  try {
    pack = await listItemFieldDefinitions(listModule)
  } catch (e) {
    const detail = e?.response?.data != null ? JSON.stringify(e.response.data) : ''
    console.log('settings/fields for item failed:', e?.message || e, detail || '')
    console.log('Falling back to custom_fields on the first Zoho item…')
    console.log('')
    pack = await listFieldsFromSampleItem(listModule, getModuleById)
  }

  const settingsData = pack.data
  const defs = Array.isArray(settingsData?.fields) ? settingsData.fields : []
  if (defs.length === 0) {
    console.log('No item custom fields found.')
    if (settingsData?.note) console.log(settingsData.note)
    console.log('In Zoho Books: Settings → Items → Custom fields (or Field customization),')
    console.log('add a single-line text field (e.g. "Customer product name"), then run this script again.')
    process.exit(0)
  }

  console.log(
    pack.source === 'settings'
      ? 'Item custom fields (use field_id as ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID)'
      : 'Custom fields on a sample item (use field_id / customfield_id below)'
  )
  if (settingsData?.note) console.log(settingsData.note)
  console.log('')
  for (const f of defs) {
    const fid = f.field_id ?? f.customfield_id
    console.log(`  field_id:   ${fid}`)
    console.log(`  label:      ${f.label || ''}`)
    console.log(`  api_name:   ${f.field_name || f.api_name || ''}`)
    console.log(`  data_type:  ${f.data_type || ''}`)
    if (f._sample_value != null && f._sample_value !== '')
      console.log(`  (sample value: ${String(f._sample_value).slice(0, 80)})`)
    console.log('')
  }

  if (applyId) {
    const ok = defs.some((f) => String(f.field_id ?? f.customfield_id) === applyId)
    if (!ok) {
      console.error(`Id "${applyId}" is not in the list above. Pick an existing field_id.`)
      process.exit(1)
    }
    const raw = readFileSync(envPath, 'utf8')
    const next = upsertEnvLine(raw, 'ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID', applyId)
    writeFileSync(envPath, next, 'utf8')
    console.log('Updated', envPath)
    console.log('')
    console.log('ZOHO_CUSTOM_FIELD_ITEM_CUSTOMER_NAME_ID=' + applyId)
    console.log('')
    console.log('Restart the backend (npm run dev) so the new env is picked up.')
  } else {
    console.log('To write .env automatically:')
    console.log('  npm run zoho:item-customer-name-env -- --apply=<field_id_from_above>')
  }
  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
