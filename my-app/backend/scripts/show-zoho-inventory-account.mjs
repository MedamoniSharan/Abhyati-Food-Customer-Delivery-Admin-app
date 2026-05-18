/**
 * List Zoho Books chart-of-accounts and highlight candidates for ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID
 * (used with POST /inventoryadjustments — adjustment_account_id).
 *
 * From my-app/backend:
 *   npm run zoho:inventory-account
 *
 * Optional filter (case-insensitive substring on name):
 *   npm run zoho:inventory-account -- --search=Inventory
 *
 * Requires OAuth scope that includes chart of accounts read (e.g. ZohoBooks.accountants.READ).
 */
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

function pickSearch(argv) {
  const raw = argv.find((a) => a.startsWith('--search='))
  if (!raw) return ''
  return decodeURIComponent(raw.slice('--search='.length).trim())
}

function scoreAccount(a) {
  const name = String(a.account_name || '').toLowerCase()
  const type = String(a.account_type || '').toLowerCase()
  let s = 0
  const okType = type === 'cost_of_goods_sold' || type === 'expense' || type === 'other_expense'
  if (!okType) return -100
  if (a.is_active === false || a.is_active === 'false') return -100

  if (type === 'cost_of_goods_sold') s += 12
  if (type === 'other_expense') s += 2
  if (/inventory adjustment|stock adjustment|inventory shrink/.test(name)) s += 15
  if (/cogs|cost of goods|cost of sales/.test(name)) s += 10
  if (/raw material|merchandise|material|inbound|outbound|warehouse exp|storage|packing|freight/.test(name)) s += 6
  if (/uncategorized|general expense|misc/.test(name)) s += 1
  return s
}

async function fetchAllChartAccounts(listModule) {
  const all = []
  for (let page = 1; page <= 50; page += 1) {
    const data = await listModule('/chartofaccounts', {
      filter_by: 'AccountType.Active',
      per_page: 200,
      page
    })
    const rows = Array.isArray(data?.chartofaccounts) ? data.chartofaccounts : []
    all.push(...rows)
    if (!data?.page_context?.has_more_page) break
  }
  return all
}

async function main() {
  const search = pickSearch(process.argv)

  await import('../src/config/env.js')
  const { listModule, getOrganizationId } = await import('../src/services/zohoBooksService.js')

  const orgId = await getOrganizationId()
  console.log('')
  console.log('organization_id:', orgId)
  console.log('')

  let rows
  try {
    rows = await fetchAllChartAccounts(listModule)
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || String(e)
    console.error(msg)
    console.log('')
    console.log('If you see scope/authorization errors, regenerate the Zoho refresh token and include')
    console.log('ZohoBooks.accountants.READ (or full Books scope) so chart of accounts can be listed.')
    process.exit(1)
  }

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter((a) => String(a.account_name || '').toLowerCase().includes(q))
    console.log(`Filtered by name containing "${search}": ${rows.length} account(s)\n`)
  }

  if (rows.length === 0) {
    console.log('No accounts returned. Try without --search= or check org data.')
    process.exit(0)
  }

  const ranked = [...rows].sort((a, b) => scoreAccount(b) - scoreAccount(a))
  const suggested = ranked.filter((a) => scoreAccount(a) >= 0).slice(0, 20)

  if (suggested.length > 0) {
    console.log(
      'Suggested first (expense / COGS–type accounts often used for quantity adjustments — confirm with your accountant):'
    )
    console.log('')
    for (const a of suggested) {
      console.log(
        `  ${a.account_id}\t${String(a.account_type || '').padEnd(22)}\t${a.account_name || ''}`
      )
    }
    console.log('')
  }

  console.log('All active accounts (account_id, account_type, account_name):')
  console.log('')
  for (const a of rows.sort((x, y) => String(x.account_name).localeCompare(String(y.account_name)))) {
    console.log(`  ${a.account_id}\t${String(a.account_type || '').padEnd(22)}\t${a.account_name || ''}`)
  }

  console.log('')
  console.log('--- Paste ONE line into backend/.env (pick the account that matches your books policy) ---')
  console.log('')
  const best = suggested[0]
  if (best?.account_id && scoreAccount(best) >= 1) {
    console.log(`ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID=${best.account_id}`)
    console.log('')
    console.log('# (Heuristic from expense/COGS-style accounts — verify in Zoho before relying on it.)')
  } else {
    console.log(
      '# ZOHO_INVENTORY_ADJUSTMENT_ACCOUNT_ID=<choose account_id above; prefer COGS or a dedicated inventory adjustment expense>'
    )
  }
  console.log('')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
