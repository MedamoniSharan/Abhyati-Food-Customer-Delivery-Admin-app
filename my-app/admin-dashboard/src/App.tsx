import { useCallback, useEffect, useMemo, useState } from 'react'
import { ADMIN_SESSION_LOST_EVENT, adminFetch, adminLogin, getAdminToken, setAdminToken } from './adminApi'
import { ADMIN_DEFAULT_EMAIL, ADMIN_DEFAULT_PASSWORD } from './adminLoginDefaults'
import { AdminBlockLoader, AdminBusyOverlay, AdminInlineSpinner } from './components/AdminDataLoader'
import { IconDeleteButton, IconEditButton } from './components/AdminIconButtons'
import { PasswordWithVisibility } from './components/PasswordWithVisibility'
import { ProductsSection } from './components/ProductsSection'
import { ProductCategoriesSection } from './components/ProductCategoriesSection'
import { AssignmentTrackingSection, assignmentActivityMs, type DeliveryAssignmentRow } from './components/AssignmentTrackingSection'
import { useToast } from './components/Toast'

type Page =
  | 'customers'
  | 'pricing-categories'
  | 'product-categories'
  | 'drivers'
  | 'products'
  | 'deliveries'
  | 'assignments'

type ZohoContactPerson = { email?: string; is_primary_contact?: boolean }
type ZohoContactRow = {
  contact_id?: string
  contact_name?: string
  email?: string
  mobile?: string
  phone?: string
  contact_persons?: ZohoContactPerson[]
  is_active?: boolean | string
}
type SalesOrderRow = {
  salesorder_id?: string
  salesorder_number?: string
  reference_number?: string
  customer_name?: string
  date?: string
  status?: string
  total?: number
}

type ZohoInvoiceRow = {
  invoice_id?: string
  invoice_number?: string
  date?: string
  invoice_date?: string
  due_date?: string
  customer_name?: string
  status?: string
  total?: number
  reference_number?: string
  salesorder_number?: string
  app_payment?: {
    method?: string
    status?: string
    razorpayPaymentId?: string | null
    paidAt?: string | null
    label?: string
  }
}

function formatPaymentLabel(inv: ZohoInvoiceRow): string {
  const app = inv.app_payment
  if (app?.label) return app.label
  const status = String(inv.status || '').toLowerCase()
  if (status.includes('paid')) return 'Paid'
  return 'Credit'
}

function formatPaidAt(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

type AuthUser = { id: string; fullName: string; email: string }
/** Zoho customer row from GET /api/admin/customers (notes redacted server-side). */
type AdminCustomerRow = ZohoContactRow & {
  has_app_login?: boolean
  disabled?: boolean
  pricing_tier_id?: string | null
  pricing_tier_name?: string | null
  created_time?: string
}
type CustomerTableRow = {
  key: string
  fullName: string
  /** Display (top-level or primary contact person email, or "—"). */
  email: string
  /** Resolved email for login/API when top-level email is empty. */
  lookupEmail: string
  /** Zoho contact top-level email (may be empty). */
  zohoTopEmail: string
  /** Primary contact person email (may be empty). */
  primaryPersonEmail: string
  mobile: string
  zohoContactId: string
  contactId: string
  hasAppLogin: boolean
  /** Zoho Books `is_active === false` — blocks customer app login. */
  disabled: boolean
  pricingTierId: string | null
  pricingTierName: string | null
  createdTime: string
}

type CustomerBulkRowDraft = {
  fullName: string
  email: string
  mobile: string
  pricingTierId: string
  disabled: boolean
  hasAppLogin: boolean
  lookupEmail: string
}

type PricingTierRow = { id: string; name: string; discountPercent?: number; discountAmountInr?: number }

type CustomerListSort = 'name_asc' | 'name_desc' | 'newest'

type DeliveryRow = {
  id: string
  orderId: string
  customerName: string
  statusTag: string
  amount: number
}

const TABLE_PAGE_SIZE = 8

function formatMoneyInr(value: number) {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function adminPageLoadingPhrase(p: Page): string {
  switch (p) {
    case 'customers':
      return 'Loading customers…'
    case 'pricing-categories':
      return 'Loading customer category…'
    case 'product-categories':
      return 'Opening product categories…'
    case 'drivers':
      return 'Loading drivers…'
    case 'products':
      return 'Loading products…'
    case 'deliveries':
      return 'Loading orders and delivery…'
    case 'assignments':
      return 'Loading assignments…'
    default:
      return 'Loading…'
  }
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    pageRows: rows.slice(start, start + pageSize),
    totalPages,
    safePage
  }
}

function readPrimaryContactPersonEmail(c: AdminCustomerRow): string {
  const persons = c.contact_persons
  if (!Array.isArray(persons) || persons.length === 0) return ''
  const primary = persons.find((p) => p?.is_primary_contact) || persons[0]
  return String(primary?.email || '').trim()
}

/** First usable email for forms (Zoho contact vs contact person). */
function pickFirstCustomerEmail(...parts: string[]): string {
  for (const p of parts) {
    const t = String(p || '').trim()
    if (t.includes('@')) return t
  }
  return ''
}

function customerRowToBulkDraft(c: CustomerTableRow): CustomerBulkRowDraft {
  const email = pickFirstCustomerEmail(c.lookupEmail, c.zohoTopEmail, c.primaryPersonEmail)
  return {
    fullName: c.fullName === '—' ? '' : c.fullName,
    email,
    mobile: c.mobile === '—' ? '' : c.mobile,
    pricingTierId: c.pricingTierId || '',
    disabled: c.disabled,
    hasAppLogin: c.hasAppLogin,
    lookupEmail: c.lookupEmail
  }
}

function customerBulkDraftsEqual(a: CustomerBulkRowDraft, b: CustomerBulkRowDraft): boolean {
  return (
    a.fullName === b.fullName &&
    a.email === b.email &&
    a.mobile === b.mobile &&
    a.pricingTierId === b.pricingTierId &&
    a.disabled === b.disabled
  )
}

function SidebarIcon({
  kind
}: {
  kind:
    | 'customers'
    | 'tags'
    | 'folder'
    | 'drivers'
    | 'products'
    | 'deliveries'
    | 'assignments'
    | 'orders'
    | 'logout'
    | 'plus'
}) {
  const p = { className: 'admin-nav-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }

  if (kind === 'plus') {
    return (<svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>)
  }
  if (kind === 'folder') {
    return (
      <svg {...p}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    )
  }
  if (kind === 'customers') {
    return (
      <svg {...p}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  }
  if (kind === 'tags') {
    return (
      <svg {...p}>
        <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l6.58-6.58a1 1 0 0 0 0-1.41L12 2z" />
        <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (kind === 'drivers') {
    return (
      <svg {...p}>
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 3v5h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    )
  }
  if (kind === 'products') {
    return (
      <svg {...p}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    )
  }
  if (kind === 'orders') {
    return (
      <svg {...p}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    )
  }
  if (kind === 'deliveries') {
    return (
      <svg {...p}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    )
  }
  if (kind === 'assignments') {
    return (
      <svg {...p}>
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12h6M9 16h4" />
      </svg>
    )
  }
  return (
    <svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export default function App() {
  const { toast } = useToast()
  const [token, setTokenState] = useState<string | null>(() => getAdminToken())
  const [loginEmail, setLoginEmail] = useState(ADMIN_DEFAULT_EMAIL)
  const [loginPassword, setLoginPassword] = useState(ADMIN_DEFAULT_PASSWORD)
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [page, setPage] = useState<Page>('products')
  const [loadErr, setLoadErr] = useState('')
  const [zohoStatus, setZohoStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [zohoStatusDetail, setZohoStatusDetail] = useState('')
  const [pageDataLoading, setPageDataLoading] = useState(false)
  const [customers, setCustomers] = useState<AdminCustomerRow[]>([])
  const [drivers, setDrivers] = useState<
    Array<AuthUser & { zohoContactId?: string; disabled?: boolean }>
  >([])
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [salesOrdersRaw, setSalesOrdersRaw] = useState<SalesOrderRow[]>([])
  /** Zoho items for sales-order line picker (broader list than paginated products page). */
  const [orderItems, setOrderItems] = useState<Array<Record<string, unknown>>>([])
  const [zohoContacts, setZohoContacts] = useState<ZohoContactRow[]>([])
  const [newCustomer, setNewCustomer] = useState({ fullName: '', email: '', password: '', mobile: '' })
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<{
    id?: string
    contactId?: string
    hasAppLogin?: boolean
    fullName: string
    email: string
    originalEmail?: string
    zohoTopEmail?: string
    primaryPersonEmail?: string
    disabled?: boolean
  } | null>(null)
  const [editingCustomerMobile, setEditingCustomerMobile] = useState('')
  const [editingCustomerPassword, setEditingCustomerPassword] = useState('')
  const [editingDriver, setEditingDriver] = useState<{
    fullName: string
    email: string
    originalEmail: string
    zohoContactId: string
    disabled?: boolean
  } | null>(null)
  const [editingDriverPassword, setEditingDriverPassword] = useState('')
  const [newDriver, setNewDriver] = useState({ fullName: '', email: '', password: '' })
  const [showAddDriverModal, setShowAddDriverModal] = useState(false)
  const [orderCustomerId, setOrderCustomerId] = useState('')
  const [orderRef, setOrderRef] = useState('')
  const [orderLines, setOrderLines] = useState([{ item_id: '', quantity: '1', rate: '' }])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customerListSort, setCustomerListSort] = useState<CustomerListSort>('newest')
  const [customersPage, setCustomersPage] = useState(1)
  const [customersMeta, setCustomersMeta] = useState<{ total: number; has_more: boolean; page: number }>({
    total: 0,
    has_more: false,
    page: 1
  })
  const [selectedCustomerContactIds, setSelectedCustomerContactIds] = useState<Record<string, boolean>>({})
  const [customerBulkEditMode, setCustomerBulkEditMode] = useState(false)
  const [customerBulkEditDraft, setCustomerBulkEditDraft] = useState<Record<string, CustomerBulkRowDraft>>({})
  const [customerBulkEditOriginal, setCustomerBulkEditOriginal] = useState<Record<string, CustomerBulkRowDraft>>({})
  const [customerBulkEditSaving, setCustomerBulkEditSaving] = useState(false)
  const [, setZohoCustomersLoading] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerCategoryFilter, setCustomerCategoryFilter] = useState('')
  const [pricingTiers, setPricingTiers] = useState<PricingTierRow[]>([])
  const [pricingConfigured, setPricingConfigured] = useState(false)
  const [pricingTiersLoadError, setPricingTiersLoadError] = useState('')
  const [pricingTiersLoading, setPricingTiersLoading] = useState(false)
  const [newTier, setNewTier] = useState({ id: '', name: '', discountPercent: '', discountAmountInr: '' })
  const [editingTier, setEditingTier] = useState<PricingTierRow | null>(null)
  const [driversSortAsc, setDriversSortAsc] = useState(true)
  const [driversPage, setDriversPage] = useState(1)
  const [selectedDriverEmails, setSelectedDriverEmails] = useState<Record<string, boolean>>({})
  const [driversRefreshing, setDriversRefreshing] = useState(false)
  const [deliveriesSortAsc, setDeliveriesSortAsc] = useState(true)
  const [deliveriesPage, setDeliveriesPage] = useState(1)
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<Record<string, boolean>>({})
  const [salesOrdersSortAsc, setSalesOrdersSortAsc] = useState(true)
  const [salesOrdersPage, setSalesOrdersPage] = useState(1)
  const [selectedSalesOrders, setSelectedSalesOrders] = useState<Record<string, boolean>>({})
  const [invoicesRaw, setInvoicesRaw] = useState<ZohoInvoiceRow[]>([])
  const [invoicesSortAsc, setInvoicesSortAsc] = useState(false)
  const [invoicesPage, setInvoicesPage] = useState(1)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [invoicesMeta, setInvoicesMeta] = useState<{ total: number; has_more: boolean; page: number }>({
    total: 0,
    has_more: false,
    page: 1
  })
  const [invoiceAssignDriverEmail, setInvoiceAssignDriverEmail] = useState('')
  const [assigningInvoiceId, setAssigningInvoiceId] = useState<string | null>(null)
  const [assignmentsRaw, setAssignmentsRaw] = useState<DeliveryAssignmentRow[]>([])
  const [assignmentsRefreshing, setAssignmentsRefreshing] = useState(false)
  const [assignmentsSortAsc, setAssignmentsSortAsc] = useState(false)
  const [assignmentsPage, setAssignmentsPage] = useState(1)

  const refreshPricingTiers = useCallback(async () => {
    setPricingTiersLoading(true)
    setPricingTiersLoadError('')
    try {
      const r = await adminFetch<{ configured?: boolean; tiers?: PricingTierRow[]; loadError?: string }>(
        '/api/admin/customer-pricing-categories'
      )
      setPricingConfigured(Boolean(r.configured))
      setPricingTiers(Array.isArray(r.tiers) ? r.tiers : [])
      setPricingTiersLoadError(typeof r.loadError === 'string' ? r.loadError : '')
    } catch (e) {
      setPricingConfigured(false)
      setPricingTiers([])
      setPricingTiersLoadError(e instanceof Error ? e.message : 'Failed to load pricing tiers')
    } finally {
      setPricingTiersLoading(false)
    }
  }, [])

  const refreshCustomers = useCallback(
    async (opts?: { page?: number; sort?: CustomerListSort }) => {
      setCustomersLoading(true)
      try {
        const page = opts?.page ?? customersPage
        const sort = opts?.sort ?? customerListSort
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('per_page', String(TABLE_PAGE_SIZE))
        if (customerSearch.trim()) params.set('search', customerSearch.trim())
        if (customerCategoryFilter.trim()) params.set('pricing_category_id', customerCategoryFilter.trim())
        const sortParam = sort === 'name_desc' ? 'desc' : sort === 'newest' ? 'newest' : 'asc'
        params.set('sort', sortParam)
        const r = await adminFetch<{
          customers: AdminCustomerRow[]
          total?: number
          has_more_page?: boolean
          page?: number
        }>(`/api/admin/customers?${params.toString()}`)
        setCustomers(r.customers || [])
        setCustomersMeta({
          total: typeof r.total === 'number' ? r.total : (r.customers || []).length,
          has_more: Boolean(r.has_more_page),
          page: typeof r.page === 'number' ? r.page : page
        })
        if (opts?.page !== undefined) setCustomersPage(opts.page)
        if (opts?.sort !== undefined) setCustomerListSort(opts.sort)
      } finally {
        setCustomersLoading(false)
      }
    },
    [customersPage, customerSearch, customerCategoryFilter, customerListSort]
  )

  const refreshDrivers = useCallback(async (opts?: { delayMs?: number }) => {
    if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
    setDriversRefreshing(true)
    try {
      const r = await adminFetch<{ drivers: typeof drivers }>('/api/admin/drivers')
      const list = r.drivers || []
      setDrivers(list)
      return list
    } finally {
      setDriversRefreshing(false)
    }
  }, [])

  const refreshDeliveries = useCallback(async () => {
    const r = await adminFetch<{ deliveries: DeliveryRow[]; salesorders?: SalesOrderRow[] }>(
      '/api/admin/deliveries'
    )
    setDeliveries(r.deliveries || [])
    setSalesOrdersRaw(Array.isArray(r.salesorders) ? r.salesorders : [])
    try {
      const ir = await adminFetch<{ items?: Array<Record<string, unknown>> }>('/api/admin/items?per_page=200')
      setOrderItems(Array.isArray(ir.items) ? ir.items : [])
    } catch {
      setOrderItems([])
    }
  }, [])

  const refreshInvoices = useCallback(
    async (opts?: { page?: number; sortAsc?: boolean }) => {
      setInvoicesLoading(true)
      try {
        const p = opts?.page ?? invoicesPage
        const sortAsc = opts?.sortAsc ?? invoicesSortAsc
        const params = new URLSearchParams()
        params.set('page', String(p))
        params.set('per_page', String(TABLE_PAGE_SIZE))
        params.set('sort', sortAsc ? 'asc' : 'desc')
        const data = await adminFetch<{
          invoices?: ZohoInvoiceRow[]
          total?: number
          has_more_page?: boolean
          page?: number
        }>(`/api/admin/invoices?${params.toString()}`)
        setInvoicesRaw(Array.isArray(data.invoices) ? data.invoices : [])
        setInvoicesMeta({
          total: typeof data.total === 'number' ? data.total : (data.invoices || []).length,
          has_more: Boolean(data.has_more_page),
          page: typeof data.page === 'number' ? data.page : p
        })
        if (opts?.page !== undefined) setInvoicesPage(opts.page)
        if (opts?.sortAsc !== undefined) setInvoicesSortAsc(opts.sortAsc)
      } finally {
        setInvoicesLoading(false)
      }
    },
    [invoicesPage, invoicesSortAsc]
  )

  const refreshAssignments = useCallback(async () => {
    setAssignmentsRefreshing(true)
    try {
      const data = await adminFetch<{ assignments?: DeliveryAssignmentRow[] }>('/api/admin/delivery-assignments')
      setAssignmentsRaw(Array.isArray(data.assignments) ? data.assignments : [])
    } finally {
      setAssignmentsRefreshing(false)
    }
  }, [])

  const refreshZohoContacts = useCallback(async () => {
    setZohoCustomersLoading(true)
    try {
      const r = await adminFetch<{ contacts?: ZohoContactRow[] }>('/api/admin/zoho/customer-contacts')
      setZohoContacts(Array.isArray(r.contacts) ? r.contacts : [])
    } finally {
      setZohoCustomersLoading(false)
    }
  }, [])

  const loadPageData = useCallback(async () => {
    setLoadErr('')
    if (page === 'products' || page === 'pricing-categories' || page === 'product-categories') {
      setPageDataLoading(false)
      return
    }
    try {
      if (page === 'drivers') await refreshDrivers()
      if (page === 'deliveries') {
        await Promise.all([refreshDeliveries(), refreshZohoContacts(), refreshDrivers(), refreshAssignments()])
      }
      if (page === 'assignments') {
        await refreshAssignments()
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load')
      if (String(e).includes('401') || String(e).includes('Invalid')) {
        setAdminToken(null)
        setTokenState(null)
      }
    } finally {
      setPageDataLoading(false)
    }
  }, [
    page,
    refreshDeliveries,
    refreshDrivers,
    refreshInvoices,
    refreshAssignments,
    refreshZohoContacts
  ])

  useEffect(() => {
    if (!token) {
      setPageDataLoading(false)
      return
    }
    setPageDataLoading(true)
    void loadPageData()
  }, [token, page, loadPageData])

  useEffect(() => {
    if (!token || (page !== 'customers' && page !== 'pricing-categories')) return
    void refreshPricingTiers()
  }, [token, page, refreshPricingTiers])

  useEffect(() => {
    if (!token || page !== 'customers') return
    setLoadErr('')
    void refreshCustomers().catch((e) => {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load')
      if (String(e).includes('401') || String(e).includes('Invalid')) {
        setAdminToken(null)
        setTokenState(null)
      }
    })
  }, [token, page, customersPage, customerSearch, customerCategoryFilter, customerListSort, refreshCustomers])

  useEffect(() => {
    if (!token || page !== 'deliveries') return
    setLoadErr('')
    void refreshInvoices().catch((e) => {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load invoices')
      if (String(e).includes('401') || String(e).includes('Invalid')) {
        setAdminToken(null)
        setTokenState(null)
      }
    })
  }, [token, page, invoicesPage, invoicesSortAsc, refreshInvoices])

  useEffect(() => {
    const onSessionLost = () => {
      setAdminToken(null)
      setTokenState(null)
      setPageDataLoading(false)
      setLoadErr('')
      setZohoStatus('idle')
      setZohoStatusDetail('')
    }
    window.addEventListener(ADMIN_SESSION_LOST_EVENT, onSessionLost)
    return () => window.removeEventListener(ADMIN_SESSION_LOST_EVENT, onSessionLost)
  }, [])

  const refreshZohoStatus = useCallback(async () => {
    if (!token) {
      setZohoStatus('idle')
      setZohoStatusDetail('')
      return
    }
    setZohoStatus('checking')
    try {
      const r = await adminFetch<{ connected?: boolean; message?: string }>('/api/admin/zoho-status')
      if (r.connected) {
        setZohoStatus('ok')
        setZohoStatusDetail(typeof r.message === 'string' ? r.message : 'Zoho Books connected')
      } else {
        setZohoStatus('error')
        setZohoStatusDetail(typeof r.message === 'string' ? r.message : 'Zoho Books not connected')
      }
    } catch (e) {
      setZohoStatus('error')
      const msg = e instanceof Error ? e.message : 'Zoho Books check failed'
      if (/404/.test(msg) || /Cannot GET/i.test(msg)) {
        setZohoStatusDetail('Zoho status unavailable — restart the backend (npm run dev in my-app/backend)')
      } else {
        setZohoStatusDetail(msg.slice(0, 240))
      }
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    void refreshZohoStatus()
    const id = window.setInterval(() => void refreshZohoStatus(), 120_000)
    return () => window.clearInterval(id)
  }, [token, refreshZohoStatus])

  const customerRows = useMemo((): CustomerTableRow[] => {
    return customers.map((c, index) => {
      const id = String(c.contact_id ?? '').trim()
      const top = String(c.email ?? '').trim()
      const fromPerson = readPrimaryContactPersonEmail(c)
      const lookup = top || fromPerson
      const displayEmail = lookup || '—'
      const inactive = c.is_active === false || c.is_active === 'false'
      const ptid = c.pricing_tier_id != null && String(c.pricing_tier_id).trim() ? String(c.pricing_tier_id).trim() : null
      const ptn =
        c.pricing_tier_name != null && String(c.pricing_tier_name).trim() ? String(c.pricing_tier_name).trim() : null
      return {
        key: `zoho:${id || `idx-${index}`}`,
        fullName: String(c.contact_name ?? '—'),
        email: displayEmail,
        lookupEmail: lookup,
        zohoTopEmail: top,
        primaryPersonEmail: fromPerson,
        mobile: String(c.mobile ?? c.phone ?? '—'),
        zohoContactId: id || '—',
        hasAppLogin: Boolean(c.has_app_login),
        contactId: id,
        disabled: Boolean(c.disabled ?? inactive),
        pricingTierId: ptid,
        pricingTierName: ptn,
        createdTime: String(c.created_time ?? '')
      }
    })
  }, [customers])

  const selectedCustomersForDelete = useMemo(
    () =>
      Object.entries(selectedCustomerContactIds)
        .filter(([, on]) => on)
        .map(([contactId]) => contactId)
        .filter((id) => Boolean(id) && id !== '—'),
    [selectedCustomerContactIds]
  )

  const handleDeleteSelectedCustomers = useCallback(async () => {
    if (selectedCustomersForDelete.length === 0) {
      toast('Select at least one customer with a Zoho contact ID to delete.', 'info')
      return
    }
    if (!confirm(`Delete ${selectedCustomersForDelete.length} selected customer(s) from Zoho?`)) return
    try {
      await Promise.all(
        selectedCustomersForDelete.map((contactId) =>
          adminFetch(`/api/admin/customers/contact/${encodeURIComponent(contactId)}`, {
            method: 'DELETE'
          })
        )
      )
      setSelectedCustomerContactIds((prev) => {
        const next = { ...prev }
        for (const id of selectedCustomersForDelete) delete next[id]
        return next
      })
      await refreshCustomers()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error')
    }
  }, [selectedCustomersForDelete, refreshCustomers, toast])

  const hasCustomerBulkEditChanges = useMemo(() => {
    for (const id of Object.keys(customerBulkEditDraft)) {
      const orig = customerBulkEditOriginal[id]
      const draft = customerBulkEditDraft[id]
      if (!orig || !draft) continue
      if (!customerBulkDraftsEqual(orig, draft)) return true
    }
    return false
  }, [customerBulkEditDraft, customerBulkEditOriginal])

  const confirmDiscardCustomerBulkEdit = useCallback(() => {
    if (!customerBulkEditMode || !hasCustomerBulkEditChanges) return true
    return confirm('You have unsaved bulk edits. Discard them?')
  }, [customerBulkEditMode, hasCustomerBulkEditChanges])

  const exitCustomerBulkEditMode = useCallback(() => {
    setCustomerBulkEditMode(false)
    setCustomerBulkEditDraft({})
    setCustomerBulkEditOriginal({})
  }, [])

  const guardCustomerBulkEditNavigation = useCallback(() => {
    if (!confirmDiscardCustomerBulkEdit()) return false
    if (customerBulkEditMode) exitCustomerBulkEditMode()
    return true
  }, [confirmDiscardCustomerBulkEdit, customerBulkEditMode, exitCustomerBulkEditMode])

  const enterCustomerBulkEditMode = useCallback(() => {
    const draft: Record<string, CustomerBulkRowDraft> = {}
    const original: Record<string, CustomerBulkRowDraft> = {}
    for (const c of customerRows) {
      if (!c.contactId) continue
      const row = customerRowToBulkDraft(c)
      draft[c.contactId] = { ...row }
      original[c.contactId] = { ...row }
    }
    setCustomerBulkEditDraft(draft)
    setCustomerBulkEditOriginal(original)
    setCustomerBulkEditMode(true)
  }, [customerRows])

  const cancelCustomerBulkEditMode = useCallback(() => {
    if (!confirmDiscardCustomerBulkEdit()) return
    exitCustomerBulkEditMode()
  }, [confirmDiscardCustomerBulkEdit, exitCustomerBulkEditMode])

  const updateCustomerBulkDraftField = useCallback(
    (contactId: string, field: keyof CustomerBulkRowDraft, value: string | boolean) => {
      setCustomerBulkEditDraft((prev) => {
        const row = prev[contactId]
        if (!row) return prev
        return { ...prev, [contactId]: { ...row, [field]: value } }
      })
    },
    []
  )

  const isCustomerBulkRowChanged = useCallback(
    (contactId: string) => {
      const orig = customerBulkEditOriginal[contactId]
      const draft = customerBulkEditDraft[contactId]
      if (!orig || !draft) return false
      return !customerBulkDraftsEqual(orig, draft)
    },
    [customerBulkEditDraft, customerBulkEditOriginal]
  )

  const saveCustomerBulkEdits = useCallback(async () => {
    const changedIds = Object.keys(customerBulkEditDraft).filter((id) => isCustomerBulkRowChanged(id))
    if (changedIds.length === 0) {
      toast('No changes to save', 'info')
      exitCustomerBulkEditMode()
      return
    }
    setCustomerBulkEditSaving(true)
    let ok = 0
    const failures: string[] = []
    for (const contactId of changedIds) {
      const original = customerBulkEditOriginal[contactId]
      const draft = customerBulkEditDraft[contactId]
      if (!original || !draft) continue
      const nameTrim = draft.fullName.trim()
      if (nameTrim.length < 2) {
        failures.push(`${contactId}: Full name must be at least 2 characters`)
        continue
      }
      const emailTrim = draft.email.trim()
      if (emailTrim && !emailTrim.includes('@')) {
        failures.push(`${contactId}: Enter a valid email`)
        continue
      }
      try {
        const profileChanged =
          draft.fullName !== original.fullName ||
          draft.email !== original.email ||
          draft.mobile !== original.mobile
        if (profileChanged) {
          const mobile = draft.mobile.trim()
          if (draft.hasAppLogin && original.lookupEmail.includes('@')) {
            await adminFetch(`/api/admin/customers/${encodeURIComponent(original.lookupEmail)}`, {
              method: 'PUT',
              body: JSON.stringify({
                fullName: nameTrim,
                ...(emailTrim ? { email: emailTrim } : {}),
                ...(mobile ? { mobile } : {})
              })
            })
          } else {
            await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(contactId)}`, {
              method: 'PUT',
              body: JSON.stringify({
                fullName: nameTrim,
                ...(emailTrim ? { email: emailTrim } : {}),
                mobile,
                ...(original.lookupEmail.includes('@') ? { currentEmail: original.lookupEmail } : {})
              })
            })
          }
        }
        if (pricingConfigured && draft.pricingTierId !== original.pricingTierId) {
          await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(contactId)}/pricing-category`, {
            method: 'PUT',
            body: JSON.stringify({ tierId: draft.pricingTierId || null })
          })
        }
        if (draft.disabled !== original.disabled) {
          await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(contactId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ disabled: draft.disabled })
          })
        }
        ok += 1
      } catch (e) {
        failures.push(`${contactId}: ${e instanceof Error ? e.message : 'Failed'}`)
      }
    }
    setCustomerBulkEditSaving(false)
    exitCustomerBulkEditMode()
    await refreshCustomers()
    if (failures.length > 0) {
      toast(`Saved ${ok}; ${failures.length} failed. ${failures.slice(0, 2).join('; ')}`, 'error')
    } else {
      toast(`Saved ${ok} customer(s)`)
    }
  }, [
    customerBulkEditDraft,
    customerBulkEditOriginal,
    exitCustomerBulkEditMode,
    isCustomerBulkRowChanged,
    pricingConfigured,
    refreshCustomers,
    toast
  ])

  const sortedDrivers = useMemo(
    () =>
      [...drivers].sort((a, b) =>
        driversSortAsc ? a.fullName.localeCompare(b.fullName) : b.fullName.localeCompare(a.fullName)
      ),
    [drivers, driversSortAsc]
  )
  const driversPaged = useMemo(() => paginateRows(sortedDrivers, driversPage, TABLE_PAGE_SIZE), [sortedDrivers, driversPage])

  const selectedDriversForDelete = useMemo(
    () =>
      drivers
        .filter((d) => selectedDriverEmails[d.email])
        .map((d) => ({
          email: d.email,
          zohoContactId: String(d.zohoContactId || d.id || '').trim()
        }))
        .filter((d) => d.zohoContactId),
    [drivers, selectedDriverEmails]
  )

  const handleDeleteSelectedDrivers = useCallback(async () => {
    if (selectedDriversForDelete.length === 0) {
      toast('Select at least one driver to delete.', 'info')
      return
    }
    if (!confirm(`Remove ${selectedDriversForDelete.length} selected driver(s)?`)) return
    let ok = 0
    const failures: string[] = []
    const deletedZids = new Set<string>()
    const deletedEmails = new Set<string>()
    for (const { email, zohoContactId } of selectedDriversForDelete) {
      try {
        await adminFetch(`/api/admin/drivers/zoho/${encodeURIComponent(zohoContactId)}`, { method: 'DELETE' })
        ok += 1
        deletedZids.add(zohoContactId)
        deletedEmails.add(email)
      } catch (e) {
        failures.push(`${email}: ${e instanceof Error ? e.message : 'Failed'}`)
      }
    }
    if (deletedZids.size > 0) {
      setDrivers((prev) =>
        prev.filter((row) => !deletedZids.has(String(row.zohoContactId || row.id || '').trim()))
      )
      setSelectedDriverEmails((prev) => {
        const next = { ...prev }
        for (const em of deletedEmails) delete next[em]
        return next
      })
    }
    const list = await refreshDrivers({ delayMs: 250 })
    const totalPages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE))
    setDriversPage((p) => Math.min(p, totalPages))
    if (failures.length > 0) {
      toast(`Removed ${ok}; ${failures.length} failed. ${failures.slice(0, 2).join('; ')}`, 'error')
    } else {
      toast(`Removed ${ok} driver(s)`)
    }
  }, [selectedDriversForDelete, refreshDrivers, toast])

  const sortedDeliveries = useMemo(
    () =>
      [...deliveries].sort((a, b) =>
        deliveriesSortAsc ? a.customerName.localeCompare(b.customerName) : b.customerName.localeCompare(a.customerName)
      ),
    [deliveries, deliveriesSortAsc]
  )
  const deliveriesPaged = useMemo(
    () => paginateRows(sortedDeliveries, deliveriesPage, TABLE_PAGE_SIZE),
    [sortedDeliveries, deliveriesPage]
  )
  const sortedSalesOrders = useMemo(
    () =>
      [...salesOrdersRaw].sort((a, b) =>
        salesOrdersSortAsc
          ? String(a.customer_name ?? '').localeCompare(String(b.customer_name ?? ''))
          : String(b.customer_name ?? '').localeCompare(String(a.customer_name ?? ''))
      ),
    [salesOrdersRaw, salesOrdersSortAsc]
  )
  const salesOrdersPaged = useMemo(
    () => paginateRows(sortedSalesOrders, salesOrdersPage, TABLE_PAGE_SIZE),
    [sortedSalesOrders, salesOrdersPage]
  )

  const sortedAssignments = useMemo(
    () =>
      [...assignmentsRaw].sort((a, b) => {
        const da = assignmentActivityMs(a)
        const db = assignmentActivityMs(b)
        return assignmentsSortAsc ? da - db : db - da
      }),
    [assignmentsRaw, assignmentsSortAsc]
  )
  const assignmentsPaged = useMemo(
    () => paginateRows(sortedAssignments, assignmentsPage, TABLE_PAGE_SIZE),
    [sortedAssignments, assignmentsPage]
  )
  const assignmentsByInvoiceId = useMemo(() => {
    const map = new Map<string, DeliveryAssignmentRow>()
    for (const row of assignmentsRaw) {
      const invoiceId = String(row.invoiceId || '').trim()
      if (!invoiceId) continue
      map.set(invoiceId, row)
    }
    return map
  }, [assignmentsRaw])
  /** ProductsSection lives inside this branch; gating on its fetch would unmount it during load,
   * abort requests, and remount in a loop (many canceled /api/admin/items calls). */
  const isCurrentPageLoading = pageDataLoading

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    try {
      const t = await adminLogin(loginEmail.trim(), loginPassword)
      setTokenState(t)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  function logout() {
    setAdminToken(null)
    setTokenState(null)
    setPageDataLoading(false)
  }

  if (!token) {
    return (
      <div className="admin-login">
        <form className="admin-login-card" onSubmit={onLogin}>
          <h1>Abhyati Admin</h1>
          <p>Sign in with your administrator account. Your session stays in this tab until you log out or close it.</p>
          <p className="admin-login-hint">
            Form is pre-filled with backend defaults (<code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code> in{' '}
            <code>backend/.env</code>). Change them there if you use different credentials.
          </p>
          {loginError ? <div className="admin-error">{loginError}</div> : null}
          <input
            className="admin-input"
            type="email"
            autoComplete="username"
            placeholder="Admin email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            required
          />
          <PasswordWithVisibility
            value={loginPassword}
            onChange={setLoginPassword}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          <button className="admin-btn" type="submit" disabled={loginLoading}>
            {loginLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand__logo" aria-hidden>
            <img src="/admin-logo.png" alt="Abhyati logo" />
          </div>
          <div className="admin-brand__text">
            <strong>Abhyati</strong>
            <span>Admin Dashboard</span>
          </div>
        </div>
        <nav className="admin-nav">
          {(
            [
              ['products', 'Products', 'products'],
              ['product-categories', 'Product categories', 'folder'],
              ['customers', 'Customers', 'customers'],
              ['pricing-categories', 'Customer category', 'tags'],
              ['drivers', 'Deliverers', 'drivers'],
              ['deliveries', 'Orders', 'orders'],
              ['assignments', 'Assignments', 'assignments']
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} type="button" className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              <SidebarIcon kind={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-quick">
          <button type="button" className="admin-nav-add-btn" onClick={() => setPage('products')}>
            <SidebarIcon kind="plus" />
            <span>Add product</span>
          </button>
        </div>
        <div className="admin-sidebar-footer">
          <button type="button" onClick={logout}>
            <SidebarIcon kind="logout" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <strong>
            {{
              products: 'Products',
              'product-categories': 'Product categories',
              customers: 'Customers',
              'pricing-categories': 'Customer category',
              drivers: 'Deliverers',
              deliveries: 'Orders',
              assignments: 'Assignments'
            }[page]}
          </strong>
          <span
            style={{
              color:
                zohoStatus === 'ok'
                  ? '#15803d'
                  : zohoStatus === 'error'
                    ? '#b91c1c'
                    : 'var(--admin-muted)',
              fontSize: '0.875rem',
              maxWidth: 420,
              textAlign: 'right',
              lineHeight: 1.35
            }}
            title={zohoStatusDetail || undefined}
          >
            {zohoStatus === 'checking'
              ? 'Checking Zoho Books…'
              : zohoStatus === 'ok'
                ? zohoStatusDetail || 'Zoho Books connected'
                : zohoStatus === 'error'
                  ? zohoStatusDetail || 'Zoho Books not connected'
                  : 'Sign in to check Zoho'}
          </span>
        </header>
        <main className="admin-content">
          {loadErr ? <div className="admin-error">{loadErr}</div> : null}

          {isCurrentPageLoading ? (
            <div className="admin-page-loader" role="status" aria-live="polite" aria-busy="true">
              <div className="admin-page-loader__spinner" aria-hidden />
              <p className="admin-page-loader__text">{adminPageLoadingPhrase(page)}</p>
            </div>
          ) : (
            <>
          {page === 'product-categories' ? <ProductCategoriesSection /> : null}

          {page === 'customers' ? (
            <>
              <div className="admin-products-header" style={{ justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!customerBulkEditMode ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn-inline"
                      disabled={selectedCustomersForDelete.length === 0}
                      onClick={() => void handleDeleteSelectedCustomers()}
                    >
                      Delete selected ({selectedCustomersForDelete.length})
                    </button>
                  ) : null}
                  <button type="button" className="admin-btn admin-btn-inline" onClick={() => setShowAddCustomerModal(true)}>
                    Add Customer
                  </button>
                </div>
              </div>
              <section className="admin-card" style={{ marginBottom: 20 }}>
                <div className="admin-toolbar">
                  <div className="admin-toolbar__search">
                    <span className="admin-toolbar__search-icon" aria-hidden>⌕</span>
                    <input
                      type="search"
                      className="admin-toolbar__search-input"
                      placeholder="Search by name, email, or mobile…"
                      value={customerSearch}
                      onChange={(e) => {
                        if (!guardCustomerBulkEditNavigation()) return
                        setCustomerSearch(e.target.value)
                        setCustomersPage(1)
                      }}
                      aria-label="Search customers"
                    />
                  </div>
                  <select
                    className="admin-select"
                    value={pricingConfigured ? customerCategoryFilter : ''}
                    onChange={(e) => {
                      if (!guardCustomerBulkEditNavigation()) {
                        e.target.value = customerCategoryFilter
                        return
                      }
                      setCustomerCategoryFilter(e.target.value)
                      setCustomersPage(1)
                    }}
                    disabled={!pricingConfigured}
                    title={
                      pricingConfigured
                        ? 'Filter by assigned customer category (Zoho)'
                        : 'Configure Zoho customer category env vars to enable this filter'
                    }
                    aria-label="Filter by customer category"
                  >
                    <option value="">All customers</option>
                    <option value="__none__">No category</option>
                    {pricingTiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-toolbar-meta" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span className="admin-muted">
                    {customerBulkEditMode
                      ? hasCustomerBulkEditChanges
                        ? 'Bulk edit mode — unsaved changes on this page'
                        : 'Bulk edit mode — edit cells inline, then save'
                      : `~${customersMeta.total} in Zoho · this page ${customerRows.length}${
                          customerCategoryFilter ? ' · category filter applies to this Zoho page only' : ''
                        }`}
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {customerBulkEditMode ? (
                      <>
                        <button
                          type="button"
                          className="admin-btn admin-btn-inline"
                          disabled={customerBulkEditSaving || customersLoading}
                          onClick={() => void saveCustomerBulkEdits()}
                        >
                          {customerBulkEditSaving ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost"
                          disabled={customerBulkEditSaving}
                          onClick={cancelCustomerBulkEditMode}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost"
                        disabled={customerRows.length === 0 || customersLoading}
                        onClick={enterCustomerBulkEditMode}
                      >
                        Bulk edit
                      </button>
                    )}
                    {customersLoading ? <AdminInlineSpinner label="Loading customers…" /> : null}
                  </div>
                </div>
                <div className="admin-toolbar" style={{ marginTop: 12, flexWrap: 'wrap', gap: 12 }}>
                  <label className="admin-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Sort list</span>
                    <select
                      className="admin-select"
                      value={customerListSort}
                      onChange={(e) => {
                        if (!guardCustomerBulkEditNavigation()) {
                          e.target.value = customerListSort
                          return
                        }
                        setCustomerListSort(e.target.value as CustomerListSort)
                        setCustomersPage(1)
                      }}
                      aria-label="Customer list sort"
                    >
                      <option value="name_asc">Name A–Z</option>
                      <option value="name_desc">Name Z–A</option>
                      <option value="newest">Newest first</option>
                    </select>
                  </label>
                </div>
              {customersLoading && customerRows.length === 0 ? (
                <AdminBlockLoader label="Loading customers from Zoho…" />
              ) : (
                <div className="admin-busy-host" style={{ minHeight: customerRows.length > 0 ? 120 : 0 }}>
                  {customersLoading && customerRows.length > 0 ? <AdminBusyOverlay label="Updating customers…" /> : null}
                  {customerBulkEditSaving ? <AdminBusyOverlay label="Saving changes…" /> : null}
                  <div className="admin-table-wrap">
                    <table className={`admin-table${customerBulkEditMode ? ' admin-table--bulk-edit' : ''}`}>
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              checked={
                                customerRows.length > 0 &&
                                customerRows.every((c) => Boolean(c.contactId) && selectedCustomerContactIds[c.contactId])
                              }
                              onChange={(e) =>
                                setSelectedCustomerContactIds((prev) => {
                                  const next = { ...prev }
                                  for (const c of customerRows) {
                                    if (c.contactId) next[c.contactId] = e.target.checked
                                  }
                                  return next
                                })
                              }
                              disabled={customersLoading}
                            />
                          </th>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Mobile</th>
                          <th>Category</th>
                          <th>App login</th>
                          <th>Zoho</th>
                          <th>Zoho Contact ID</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!customersLoading && customerRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="admin-muted">
                              No customers found.
                            </td>
                          </tr>
                        ) : null}
                        {customerRows.map((c) => {
                          const draft = c.contactId ? customerBulkEditDraft[c.contactId] : undefined
                          const rowChanged = c.contactId ? isCustomerBulkRowChanged(c.contactId) : false
                          return (
                          <tr key={c.key} className={rowChanged ? 'admin-table-row--changed' : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                checked={Boolean(c.contactId && selectedCustomerContactIds[c.contactId])}
                                onChange={(e) =>
                                  setSelectedCustomerContactIds((prev) => ({
                                    ...prev,
                                    [c.contactId]: e.target.checked
                                  }))
                                }
                              />
                            </td>
                            <td>
                              {customerBulkEditMode && draft && c.contactId ? (
                                <input
                                  className="admin-table-input"
                                  value={draft.fullName}
                                  onChange={(e) => updateCustomerBulkDraftField(c.contactId, 'fullName', e.target.value)}
                                  aria-label={`Name for ${c.fullName}`}
                                />
                              ) : (
                                c.fullName
                              )}
                            </td>
                            <td>
                              {customerBulkEditMode && draft && c.contactId ? (
                                <input
                                  className="admin-table-input"
                                  type="email"
                                  value={draft.email}
                                  onChange={(e) => updateCustomerBulkDraftField(c.contactId, 'email', e.target.value)}
                                  aria-label={`Email for ${c.fullName}`}
                                />
                              ) : (
                                c.email
                              )}
                            </td>
                            <td>
                              {customerBulkEditMode && draft && c.contactId ? (
                                <input
                                  className="admin-table-input"
                                  value={draft.mobile}
                                  onChange={(e) => updateCustomerBulkDraftField(c.contactId, 'mobile', e.target.value)}
                                  aria-label={`Mobile for ${c.fullName}`}
                                />
                              ) : (
                                c.mobile
                              )}
                            </td>
                            <td>
                              {customerBulkEditMode && draft && c.contactId && pricingConfigured ? (
                                <select
                                  className="admin-table-select"
                                  value={draft.pricingTierId}
                                  onChange={(e) => updateCustomerBulkDraftField(c.contactId, 'pricingTierId', e.target.value)}
                                  aria-label={`Customer category for ${c.fullName}`}
                                >
                                  <option value="">None</option>
                                  {pricingTiers.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              ) : c.contactId && pricingConfigured && !customerBulkEditMode ? (
                                <select
                                  className="admin-select"
                                  style={{ maxWidth: 200, fontSize: '0.85rem' }}
                                  value={c.pricingTierId || ''}
                                  onChange={async (e) => {
                                    const v = e.target.value || null
                                    try {
                                      await adminFetch(
                                        `/api/admin/customers/contact/${encodeURIComponent(c.contactId)}/pricing-category`,
                                        { method: 'PUT', body: JSON.stringify({ tierId: v }) }
                                      )
                                      await refreshCustomers()
                                      toast('Customer category updated', 'info')
                                    } catch (err) {
                                      toast(err instanceof Error ? err.message : 'Failed', 'error')
                                    }
                                  }}
                                  aria-label={`Customer category for ${c.fullName}`}
                                >
                                  <option value="">None</option>
                                  {pricingTiers.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="admin-muted" title={pricingConfigured ? '' : 'Configure Zoho customer category env vars'}>
                                  {c.pricingTierName || '—'}
                                </span>
                              )}
                            </td>
                            <td>
                              {c.hasAppLogin ? (
                                <span className="admin-pill">Yes</span>
                              ) : (
                                <span className="admin-pill admin-pill--muted">No</span>
                              )}
                            </td>
                            <td>
                              {customerBulkEditMode && draft && c.contactId ? (
                                <select
                                  className="admin-table-select"
                                  value={draft.disabled ? 'inactive' : 'active'}
                                  onChange={(e) =>
                                    updateCustomerBulkDraftField(c.contactId, 'disabled', e.target.value === 'inactive')
                                  }
                                  aria-label={`Zoho status for ${c.fullName}`}
                                >
                                  <option value="active">Active</option>
                                  <option value="inactive">Inactive</option>
                                </select>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                                  {Boolean(c.disabled) ? (
                                    <span className="admin-pill-warn admin-pill">Inactive</span>
                                  ) : (
                                    <span className="admin-pill">Active</span>
                                  )}
                                  {c.contactId ? (
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost"
                                      style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                                      onClick={async () => {
                                        const nextDisabled = !Boolean(c.disabled)
                                        try {
                                          await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(c.contactId)}`, {
                                            method: 'PATCH',
                                            body: JSON.stringify({ disabled: nextDisabled })
                                          })
                                          await refreshCustomers()
                                          toast(nextDisabled ? 'Customer deactivated in Zoho' : 'Customer activated in Zoho', 'info')
                                        } catch (e) {
                                          toast(e instanceof Error ? e.message : 'Failed', 'error')
                                        }
                                      }}
                                    >
                                      {Boolean(c.disabled) ? 'Activate' : 'Deactivate'}
                                    </button>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td style={{ fontSize: '0.75rem' }}>{c.zohoContactId}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <IconEditButton
                                  label={`Edit customer ${c.fullName}`}
                                  disabled={customerBulkEditMode}
                                  onClick={() => {
                                    const initialEmail = pickFirstCustomerEmail(
                                      c.lookupEmail,
                                      c.zohoTopEmail,
                                      c.primaryPersonEmail
                                    )
                                    setEditingCustomer({
                                      contactId: c.contactId,
                                      hasAppLogin: c.hasAppLogin,
                                      id: c.contactId,
                                      fullName: c.fullName,
                                      email: initialEmail,
                                      originalEmail: c.hasAppLogin ? initialEmail : undefined,
                                      zohoTopEmail: c.zohoTopEmail,
                                      primaryPersonEmail: c.primaryPersonEmail,
                                      disabled: Boolean(c.disabled)
                                    })
                                    setEditingCustomerMobile(c.mobile === '—' ? '' : c.mobile)
                                    setEditingCustomerPassword('')
                                  }}
                                />
                                {c.contactId ? (
                                  <IconDeleteButton
                                    label={`Delete customer ${c.fullName}`}
                                    disabled={customerBulkEditMode}
                                    onClick={async () => {
                                      if (!confirm(`Delete customer "${c.fullName}" from Zoho?`)) return
                                      try {
                                        await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(c.contactId)}`, {
                                          method: 'DELETE'
                                        })
                                        await refreshCustomers()
                                      } catch (e) {
                                        toast(e instanceof Error ? e.message : 'Failed', 'error')
                                      }
                                    }}
                                  />
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <nav className="admin-pagination" aria-label="Customer pages">
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  disabled={customersLoading || customersPage <= 1}
                  onClick={() => {
                    if (!guardCustomerBulkEditNavigation()) return
                    setCustomersPage((p) => Math.max(1, p - 1))
                  }}
                >
                  Previous
                </button>
                <span className="admin-pagination__info">
                  Page <strong>{customersPage}</strong>
                  {customersMeta.total > 0 ? (
                    <>
                      {' '}
                      · ~{Math.max(1, Math.ceil(customersMeta.total / TABLE_PAGE_SIZE))} pages (Zoho total)
                    </>
                  ) : null}
                </span>
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  disabled={customersLoading || !customersMeta.has_more}
                  onClick={() => {
                    if (!guardCustomerBulkEditNavigation()) return
                    setCustomersPage((p) => p + 1)
                  }}
                >
                  Next
                </button>
              </nav>
              </section>
            </>
          ) : null}

          {page === 'pricing-categories' ? (
            <>
              <p style={{ color: 'var(--admin-muted)' }}>
                Create and edit discount tiers per customer category in Zoho Books. Assign a category to each customer
                from the Customers page (category column).
              </p>
              <section className="admin-card">
                <h3 style={{ marginTop: 0 }}>Tiers</h3>
                {!pricingConfigured ? (
                  <p className="admin-muted" style={{ marginBottom: 0 }}>
                    Set <code>ZOHO_PRICING_TIERS_CONTACT_ID</code>, <code>ZOHO_CUSTOM_FIELD_TIERS_JSON_ID</code>, and{' '}
                    <code>ZOHO_CUSTOM_FIELD_CUSTOMER_TIER_ID</code> in the backend <code>.env</code> to enable tier storage
                    in Zoho. See <code>.env.example</code> for setup notes.
                  </p>
                ) : pricingTiersLoadError ? (
                  <div className="admin-error" style={{ marginBottom: 0 }}>
                    <p style={{ margin: '0 0 8px' }}>
                      Pricing tiers are configured, but Zoho returned invalid tier data (often wrong JSON in the catalog
                      contact custom field).
                    </p>
                    <p style={{ margin: 0, fontSize: '0.9rem' }}>{pricingTiersLoadError}</p>
                    <p className="admin-muted" style={{ margin: '12px 0 0', fontSize: '0.85rem' }}>
                      Fix the JSON in Zoho or run <code>npm run zoho:setup-pricing-fields</code> from{' '}
                      <code>my-app/backend</code>, then refresh this page.
                    </p>
                  </div>
                ) : (
                  <>
                    {pricingTiersLoading && pricingTiers.length > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                        <AdminInlineSpinner label="Syncing tiers…" />
                      </div>
                    ) : null}
                    {editingTier ? (
                      <div className="admin-form-row admin-form-row--wrap" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
                        <span className="admin-muted" style={{ width: '100%' }}>
                          Edit tier <strong>{editingTier.id}</strong>
                        </span>
                        <input
                          className="admin-input"
                          style={{ minWidth: 160 }}
                          placeholder="Name"
                          value={editingTier.name}
                          onChange={(e) => setEditingTier((t) => (t ? { ...t, name: e.target.value } : t))}
                        />
                        <input
                          className="admin-input"
                          style={{ width: 100 }}
                          placeholder="% off"
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={editingTier.discountPercent ?? ''}
                          onChange={(e) =>
                            setEditingTier((t) =>
                              t ? { ...t, discountPercent: e.target.value === '' ? undefined : Number(e.target.value) } : t
                            )
                          }
                        />
                        <input
                          className="admin-input"
                          style={{ width: 120 }}
                          placeholder="₹ off"
                          type="number"
                          min={0}
                          step="0.01"
                          value={editingTier.discountAmountInr ?? ''}
                          onChange={(e) =>
                            setEditingTier((t) =>
                              t ? { ...t, discountAmountInr: e.target.value === '' ? undefined : Number(e.target.value) } : t
                            )
                          }
                        />
                        <button
                          type="button"
                          className="admin-btn admin-btn-inline"
                          onClick={async () => {
                            try {
                              await adminFetch(
                                `/api/admin/customer-pricing-categories/${encodeURIComponent(editingTier.id)}`,
                                {
                                  method: 'PUT',
                                  body: JSON.stringify({
                                    name: editingTier.name.trim(),
                                    ...(editingTier.discountPercent != null
                                      ? { discountPercent: editingTier.discountPercent }
                                      : {}),
                                    ...(editingTier.discountAmountInr != null
                                      ? { discountAmountInr: editingTier.discountAmountInr }
                                      : {})
                                  })
                                }
                              )
                              setEditingTier(null)
                              await refreshPricingTiers()
                              await refreshCustomers()
                              toast('Tier updated', 'info')
                            } catch (e) {
                              toast(e instanceof Error ? e.message : 'Failed', 'error')
                            }
                          }}
                        >
                          Save tier
                        </button>
                        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setEditingTier(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : null}
                    <div className="admin-form-row admin-form-row--wrap" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
                      <input
                        className="admin-input"
                        style={{ width: 120 }}
                        placeholder="Tier id (optional)"
                        value={newTier.id}
                        onChange={(e) => setNewTier((n) => ({ ...n, id: e.target.value }))}
                      />
                      <input
                        className="admin-input"
                        style={{ minWidth: 160 }}
                        placeholder="Display name *"
                        value={newTier.name}
                        onChange={(e) => setNewTier((n) => ({ ...n, name: e.target.value }))}
                      />
                      <input
                        className="admin-input"
                        style={{ width: 100 }}
                        placeholder="% discount"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={newTier.discountPercent}
                        onChange={(e) => setNewTier((n) => ({ ...n, discountPercent: e.target.value }))}
                      />
                      <input
                        className="admin-input"
                        style={{ width: 120 }}
                        placeholder="₹ discount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={newTier.discountAmountInr}
                        onChange={(e) => setNewTier((n) => ({ ...n, discountAmountInr: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="admin-btn admin-btn-inline"
                        onClick={async () => {
                          const name = newTier.name.trim()
                          const pct = newTier.discountPercent.trim() === '' ? undefined : Number(newTier.discountPercent)
                          const amt =
                            newTier.discountAmountInr.trim() === '' ? undefined : Number(newTier.discountAmountInr)
                          if (!name) {
                            toast('Tier name is required', 'info')
                            return
                          }
                          if ((!pct || !Number.isFinite(pct) || pct <= 0) && (!amt || !Number.isFinite(amt) || amt <= 0)) {
                            toast('Enter a percent and/or flat amount greater than zero', 'info')
                            return
                          }
                          try {
                            await adminFetch('/api/admin/customer-pricing-categories', {
                              method: 'POST',
                              body: JSON.stringify({
                                ...(newTier.id.trim() ? { id: newTier.id.trim() } : {}),
                                name,
                                ...(pct != null && Number.isFinite(pct) && pct > 0 ? { discountPercent: pct } : {}),
                                ...(amt != null && Number.isFinite(amt) && amt > 0 ? { discountAmountInr: amt } : {})
                              })
                            })
                            setNewTier({ id: '', name: '', discountPercent: '', discountAmountInr: '' })
                            await refreshPricingTiers()
                            await refreshCustomers()
                            toast('Tier created in Zoho', 'info')
                          } catch (e) {
                            toast(e instanceof Error ? e.message : 'Failed', 'error')
                          }
                        }}
                      >
                        Add tier
                      </button>
                    </div>
                    {pricingTiersLoading && pricingTiers.length === 0 ? (
                      <AdminBlockLoader label="Loading tiers from Zoho…" />
                    ) : (
                      <div className="admin-busy-host" style={{ minHeight: pricingTiers.length > 0 ? 100 : 0 }}>
                        {pricingTiersLoading && pricingTiers.length > 0 ? (
                          <AdminBusyOverlay label="Updating tiers…" />
                        ) : null}
                        <div className="admin-table-wrap">
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th>Id</th>
                                <th>Name</th>
                                <th>% off</th>
                                <th>₹ off</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pricingTiers.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="admin-muted">
                                    No tiers yet. Add one above (stored as JSON on the catalog contact in Zoho).
                                  </td>
                                </tr>
                              ) : null}
                              {pricingTiers.map((t) => (
                                <tr key={t.id}>
                                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{t.id}</td>
                                  <td>{t.name}</td>
                                  <td>{t.discountPercent != null ? String(t.discountPercent) : '—'}</td>
                                  <td>{t.discountAmountInr != null ? String(t.discountAmountInr) : '—'}</td>
                                  <td>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <button
                                        type="button"
                                        className="admin-btn admin-btn--ghost"
                                        style={{ fontSize: '0.8rem' }}
                                        onClick={() => setEditingTier({ ...t })}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="admin-btn admin-btn--ghost"
                                        style={{ fontSize: '0.8rem' }}
                                        onClick={async () => {
                                          if (!confirm(`Delete tier "${t.name}" from Zoho? Unassign customers first if in use.`))
                                            return
                                          try {
                                            await adminFetch(
                                              `/api/admin/customer-pricing-categories/${encodeURIComponent(t.id)}`,
                                              { method: 'DELETE' }
                                            )
                                            await refreshPricingTiers()
                                            await refreshCustomers()
                                            toast('Tier deleted', 'info')
                                          } catch (e) {
                                            toast(e instanceof Error ? e.message : 'Failed', 'error')
                                          }
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    <p className="admin-muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
                      Final price: max(0, list × (1 − %/100) − ₹). Applied in the customer app catalog and enforced on
                      checkout.
                    </p>
                  </>
                )}
              </section>
            </>
          ) : null}

          {page === 'drivers' ? (
            <>
              <p style={{ color: 'var(--admin-muted)' }}>
                Creates a Zoho Books contact plus delivery login for drivers.
              </p>
              <div className="admin-form-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn-inline"
                  disabled={selectedDriversForDelete.length === 0 || driversRefreshing}
                  onClick={() => void handleDeleteSelectedDrivers()}
                >
                  Delete selected ({selectedDriversForDelete.length})
                </button>
                <button type="button" className="admin-btn admin-btn-inline" onClick={() => setShowAddDriverModal(true)}>
                  Add
                </button>
              </div>
              <div className="admin-table-wrap admin-busy-host">
                {driversRefreshing ? <AdminBusyOverlay label="Refreshing drivers…" /> : null}
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={driversPaged.pageRows.length > 0 && driversPaged.pageRows.every((d) => selectedDriverEmails[d.email])}
                          onChange={(e) =>
                            setSelectedDriverEmails((prev) => {
                              const next = { ...prev }
                              for (const d of driversPaged.pageRows) next[d.email] = e.target.checked
                              return next
                            })
                          }
                        />
                      </th>
                      <th className="admin-th-sortable" onClick={() => setDriversSortAsc((v) => !v)} title="Sort by name">
                        Name {driversSortAsc ? '▲' : '▼'}
                      </th>
                      <th>Email</th>
                      <th>Zoho ID</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {driversPaged.pageRows.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!selectedDriverEmails[d.email]}
                            onChange={(e) =>
                              setSelectedDriverEmails((prev) => ({ ...prev, [d.email]: e.target.checked }))
                            }
                          />
                        </td>
                        <td>{d.fullName}</td>
                        <td>{d.email}</td>
                        <td style={{ fontSize: '0.75rem' }}>{d.zohoContactId}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                            {Boolean(d.disabled) ? (
                              <span className="admin-pill-warn admin-pill">Disabled</span>
                            ) : (
                              <span className="admin-pill">Active</span>
                            )}
                            {d.zohoContactId ? (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn-inline"
                                onClick={async () => {
                                  const zid = String(d.zohoContactId || '').trim()
                                  if (!zid) return
                                  const nextDisabled = !Boolean(d.disabled)
                                  try {
                                    await adminFetch(`/api/admin/drivers/zoho/${encodeURIComponent(zid)}`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({ disabled: nextDisabled })
                                    })
                                    await refreshDrivers()
                                    toast(nextDisabled ? 'Driver deactivated in Zoho' : 'Driver activated in Zoho', 'info')
                                  } catch (e) {
                                    toast(e instanceof Error ? e.message : 'Failed', 'error')
                                  }
                                }}
                              >
                                {Boolean(d.disabled) ? 'Activate' : 'Deactivate'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <IconEditButton
                              label={`Edit driver ${d.email}`}
                              onClick={() => {
                                const zohoContactId = String(d.zohoContactId || d.id || '').trim()
                                setEditingDriver({
                                  fullName: d.fullName,
                                  email: d.email,
                                  originalEmail: d.email,
                                  zohoContactId,
                                  disabled: Boolean(d.disabled)
                                })
                                setEditingDriverPassword('')
                              }}
                            />
                            <IconDeleteButton
                            label="Delete"
                            onClick={async () => {
                              const zid = String(d.zohoContactId || d.id || '').trim()
                              if (!zid) {
                                toast('Missing Zoho contact id for this driver', 'error')
                                return
                              }
                              if (!confirm(`Remove driver ${d.email}?`)) return
                              const deletedEmail = d.email
                              try {
                                const r = await adminFetch<{ message?: string }>(
                                  `/api/admin/drivers/zoho/${encodeURIComponent(zid)}`,
                                  { method: 'DELETE' }
                                )
                                setDrivers((prev) =>
                                  prev.filter((row) => String(row.zohoContactId || row.id || '').trim() !== zid)
                                )
                                setSelectedDriverEmails((prev) => {
                                  const next = { ...prev }
                                  delete next[deletedEmail]
                                  return next
                                })
                                const list = await refreshDrivers({ delayMs: 250 })
                                const totalPages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE))
                                setDriversPage((p) => Math.min(p, totalPages))
                                toast(typeof r?.message === 'string' ? r.message : 'Driver removed')
                              } catch (e) {
                                await refreshDrivers()
                                toast(e instanceof Error ? e.message : 'Failed', 'error')
                              }
                            }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-table-pagination">
                <button className="admin-btn admin-btn--ghost" type="button" onClick={() => setDriversPage((p) => Math.max(1, p - 1))}>
                  Prev
                </button>
                <span>
                  Page {driversPaged.safePage} / {driversPaged.totalPages}
                </span>
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  onClick={() => setDriversPage((p) => Math.min(driversPaged.totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </>
          ) : null}

          {page === 'deliveries' ? (
            <>
              <div className="admin-form-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: 'var(--admin-muted)' }}>
                  Driver for assignment
                  <select
                    className="admin-input"
                    style={{ minWidth: 220 }}
                    value={invoiceAssignDriverEmail}
                    onChange={(e) => setInvoiceAssignDriverEmail(e.target.value)}
                  >
                    <option value="">Select driver…</option>
                    {drivers
                      .filter((d) => !d.disabled)
                      .map((d) => (
                        <option key={d.email} value={d.email}>
                          {d.fullName} ({d.email})
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  disabled={invoicesLoading}
                  onClick={() => void Promise.all([refreshInvoices(), refreshAssignments()])}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                  Refresh invoices
                </button>
              </div>
              <div className="admin-table-wrap admin-busy-host">
                {invoicesLoading ? <AdminBusyOverlay label="Loading invoices…" /> : null}
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th
                        className="admin-th-sortable"
                        onClick={() => {
                          const next = !invoicesSortAsc
                          setInvoicesSortAsc(next)
                          setInvoicesPage(1)
                        }}
                        title="Sort by date"
                      >
                        Date {invoicesSortAsc ? '▲' : '▼'}
                      </th>
                      <th>Invoice #</th>
                      <th>Order / ref</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th>Payment ID</th>
                      <th>Paid at</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Driver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesLoading && invoicesRaw.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ color: 'var(--admin-muted)', padding: '16px 12px' }}>
                          Loading invoices from Zoho…
                        </td>
                      </tr>
                    ) : null}
                    {!invoicesLoading && invoicesRaw.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ color: 'var(--admin-muted)', padding: '16px 12px' }}>
                          No invoices on this page. Use Refresh or check Zoho Books connection.
                        </td>
                      </tr>
                    ) : null}
                    {invoicesRaw.map((inv) => {
                      const id = String(inv.invoice_id ?? '')
                      const assignment = id ? assignmentsByInvoiceId.get(id) : undefined
                      return (
                        <tr key={id || inv.invoice_number}>
                          <td>{inv.date ?? inv.invoice_date ?? '—'}</td>
                          <td>{inv.invoice_number ?? id}</td>
                          <td>{inv.salesorder_number ?? inv.reference_number ?? '—'}</td>
                          <td>{inv.customer_name ?? '—'}</td>
                          <td>{inv.status ?? '—'}</td>
                          <td>{formatPaymentLabel(inv)}</td>
                          <td>{inv.app_payment?.razorpayPaymentId ?? '—'}</td>
                          <td>{formatPaidAt(inv.app_payment?.paidAt)}</td>
                          <td>{inv.due_date ?? '—'}</td>
                          <td>{formatMoneyInr(Number(inv.total))}</td>
                          <td>
                            {assignment ? (
                              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                                {assignment.driverName || assignment.driverEmail || 'Assigned'}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="admin-btn admin-btn-inline"
                                disabled={!id || assigningInvoiceId === id}
                                onClick={async () => {
                                  if (!invoiceAssignDriverEmail) {
                                    toast('Choose a driver first', 'info')
                                    return
                                  }
                                  if (!id) return
                                  setAssigningInvoiceId(id)
                                  try {
                                    const result = await adminFetch<{
                                      assignment?: DeliveryAssignmentRow
                                      message?: string
                                    }>('/api/admin/delivery-assignments', {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        driver_email: invoiceAssignDriverEmail,
                                        invoice_id: id
                                      })
                                    })
                                    if (result.assignment) {
                                      setAssignmentsRaw((prev) => {
                                        const without = prev.filter((row) => String(row.invoiceId) !== id)
                                        return [...without, result.assignment!]
                                      })
                                    } else {
                                      await refreshAssignments()
                                    }
                                    const driverLabel =
                                      result.assignment?.driverName ||
                                      result.assignment?.driverEmail ||
                                      invoiceAssignDriverEmail
                                    toast(`Assigned to ${driverLabel}`)
                                  } catch (e) {
                                    toast(e instanceof Error ? e.message : 'Assign failed', 'error')
                                  } finally {
                                    setAssigningInvoiceId(null)
                                  }
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="3.5"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                                {assigningInvoiceId === id ? 'Assigning...' : 'Assign'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <nav className="admin-pagination" aria-label="Invoice pages">
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  disabled={invoicesLoading || invoicesPage <= 1}
                  onClick={() => setInvoicesPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="admin-pagination__info">
                  Page <strong>{invoicesPage}</strong>
                  {invoicesMeta.total > 0 ? (
                    <>
                      {' '}
                      · ~{Math.max(1, Math.ceil(invoicesMeta.total / TABLE_PAGE_SIZE))} pages (Zoho total)
                    </>
                  ) : null}
                  {invoicesLoading ? <span className="admin-muted"> · loading…</span> : null}
                </span>
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  disabled={invoicesLoading || !invoicesMeta.has_more}
                  onClick={() => setInvoicesPage((p) => p + 1)}
                >
                  Next
                </button>
              </nav>

              <h3 style={{ marginBottom: 8 }}>Create sales order</h3>
              <div className="admin-form-row" style={{ flexDirection: 'column', alignItems: 'stretch', maxWidth: 640 }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--admin-muted)' }}>Zoho customer</label>
                <select
                  className="admin-input"
                  value={orderCustomerId}
                  onChange={(e) => setOrderCustomerId(e.target.value)}
                  style={{ marginBottom: 8 }}
                >
                  <option value="">Select customer…</option>
                  {zohoContacts.map((c) => (
                    <option key={String(c.contact_id)} value={String(c.contact_id ?? '')}>
                      {c.contact_name || c.email || c.contact_id} ({c.email || 'no email'})
                    </option>
                  ))}
                </select>
                <input
                  className="admin-input"
                  placeholder="Reference (optional, e.g. WEB-1024)"
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                {orderLines.map((line, idx) => (
                  <div key={idx} className="admin-form-row" style={{ width: '100%' }}>
                    <select
                      className="admin-input"
                      style={{ flex: 2, minWidth: 200 }}
                      value={line.item_id}
                      onChange={(e) => {
                        const itemId = e.target.value
                        const it = orderItems.find((x) => String(x.item_id) === itemId)
                        const rate = it?.rate != null ? String(it.rate) : line.rate
                        setOrderLines((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, item_id: itemId, rate } : r))
                        )
                      }}
                    >
                      <option value="">Item…</option>
                      {orderItems.map((it) => (
                        <option key={String(it.item_id)} value={String(it.item_id ?? '')}>
                          {String(it.name ?? it.item_id)} — {String(it.rate ?? '')}
                        </option>
                      ))}
                    </select>
                    <input
                      className="admin-input"
                      style={{ width: 80 }}
                      type="number"
                      min={1}
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) =>
                        setOrderLines((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      className="admin-input"
                      style={{ width: 100 }}
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Rate"
                      value={line.rate}
                      onChange={(e) =>
                        setOrderLines((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, rate: e.target.value } : r))
                        )
                      }
                    />
                    {orderLines.length > 1 ? (
                      <IconDeleteButton
                        label="Remove line"
                        onClick={() => setOrderLines((rows) => rows.filter((_, i) => i !== idx))}
                      />
                    ) : null}
                  </div>
                ))}
                <div className="admin-form-row">
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    style={{ background: '#444' }}
                    onClick={() => setOrderLines((rows) => [...rows, { item_id: '', quantity: '1', rate: '' }])}
                  >
                    Add line
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    onClick={async () => {
                      if (!orderCustomerId) {
                        toast('Choose a Zoho customer', 'info')
                        return
                      }
                      const lines = orderLines
                        .filter((l) => l.item_id)
                        .map((l) => ({
                          item_id: l.item_id,
                          quantity: Number(l.quantity) || 1,
                          rate: Number(l.rate) || 0
                        }))
                      if (lines.length === 0) {
                        toast('Add at least one line with an item', 'info')
                        return
                      }
                      try {
                        await adminFetch('/api/admin/sales-orders', {
                          method: 'POST',
                          body: JSON.stringify({
                            customer_id: orderCustomerId,
                            ...(orderRef.trim() ? { reference_number: orderRef.trim() } : {}),
                            line_items: lines
                          })
                        })
                        setOrderRef('')
                        setOrderLines([{ item_id: '', quantity: '1', rate: '' }])
                        await refreshDeliveries()
                        toast('Sales order created in Zoho Books')
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Failed', 'error')
                      }
                    }}
                  >
                    Create in Zoho
                  </button>
                </div>
              </div>

              <h3 style={{ marginTop: 28, marginBottom: 8 }}>Driver view (stops)</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={
                            deliveriesPaged.pageRows.length > 0 &&
                            deliveriesPaged.pageRows.every((d) => selectedDeliveryIds[d.id])
                          }
                          onChange={(e) =>
                            setSelectedDeliveryIds((prev) => {
                              const next = { ...prev }
                              for (const d of deliveriesPaged.pageRows) next[d.id] = e.target.checked
                              return next
                            })
                          }
                        />
                      </th>
                      <th>Order</th>
                      <th className="admin-th-sortable" onClick={() => setDeliveriesSortAsc((v) => !v)} title="Sort by name">
                        Customer {deliveriesSortAsc ? '▲' : '▼'}
                      </th>
                      <th>Status</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveriesPaged.pageRows.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!selectedDeliveryIds[d.id]}
                            onChange={(e) => setSelectedDeliveryIds((prev) => ({ ...prev, [d.id]: e.target.checked }))}
                          />
                        </td>
                        <td>{d.orderId}</td>
                        <td>{d.customerName}</td>
                        <td>{d.statusTag}</td>
                        <td>{d.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-table-pagination">
                <button className="admin-btn admin-btn--ghost" type="button" onClick={() => setDeliveriesPage((p) => Math.max(1, p - 1))}>
                  Prev
                </button>
                <span>
                  Page {deliveriesPaged.safePage} / {deliveriesPaged.totalPages}
                </span>
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  onClick={() => setDeliveriesPage((p) => Math.min(deliveriesPaged.totalPages, p + 1))}
                >
                  Next
                </button>
              </div>

              <h3 style={{ marginTop: 28, marginBottom: 8 }}>Sales orders (Zoho)</h3>
              <p style={{ color: 'var(--admin-muted)', fontSize: '0.875rem' }}>
                Edit status or details in Zoho Books, or use <code>PUT /api/admin/sales-orders/:id</code> with a raw
                Zoho payload for advanced updates.
              </p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={
                            salesOrdersPaged.pageRows.length > 0 &&
                            salesOrdersPaged.pageRows.every((s) => selectedSalesOrders[String(s.salesorder_id ?? '')])
                          }
                          onChange={(e) =>
                            setSelectedSalesOrders((prev) => {
                              const next = { ...prev }
                              for (const s of salesOrdersPaged.pageRows) next[String(s.salesorder_id ?? '')] = e.target.checked
                              return next
                            })
                          }
                        />
                      </th>
                      <th>Number</th>
                      <th className="admin-th-sortable" onClick={() => setSalesOrdersSortAsc((v) => !v)} title="Sort by name">
                        Customer {salesOrdersSortAsc ? '▲' : '▼'}
                      </th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesOrdersPaged.pageRows.map((so) => (
                      <tr key={String(so.salesorder_id)}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!selectedSalesOrders[String(so.salesorder_id ?? '')]}
                            onChange={(e) =>
                              setSelectedSalesOrders((prev) => ({
                                ...prev,
                                [String(so.salesorder_id ?? '')]: e.target.checked
                              }))
                            }
                          />
                        </td>
                        <td>{String(so.salesorder_number || so.reference_number || '—')}</td>
                        <td>{String(so.customer_name || '—')}</td>
                        <td>{String(so.date || '—')}</td>
                        <td>{String(so.status || '—')}</td>
                        <td>{so.total != null ? String(so.total) : '—'}</td>
                        <td style={{ fontSize: '0.75rem' }}>{String(so.salesorder_id)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-table-pagination">
                <button className="admin-btn admin-btn--ghost" type="button" onClick={() => setSalesOrdersPage((p) => Math.max(1, p - 1))}>
                  Prev
                </button>
                <span>
                  Page {salesOrdersPaged.safePage} / {salesOrdersPaged.totalPages}
                </span>
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  onClick={() => setSalesOrdersPage((p) => Math.min(salesOrdersPaged.totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </>
          ) : null}

          {page === 'assignments' ? (
            <AssignmentTrackingSection
              assignmentsPaged={assignmentsPaged}
              assignmentsSortAsc={assignmentsSortAsc}
              onToggleSort={() => setAssignmentsSortAsc((v) => !v)}
              onAssignmentsPage={setAssignmentsPage}
              totalAssignments={assignmentsRaw.length}
              onRefresh={refreshAssignments}
              assignmentsRefreshing={assignmentsRefreshing}
              onToast={toast}
            />
          ) : null}

          {page === 'products' ? <ProductsSection /> : null}
            </>
          )}

          {showAddCustomerModal ? (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowAddCustomerModal(false)
              }}
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
                <h3 className="admin-modal__title">Add customer</h3>
                <input
                  className="admin-input"
                  placeholder="Full name"
                  value={newCustomer.fullName}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, fullName: e.target.value }))}
                />
                <input
                  className="admin-input"
                  placeholder="Email"
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))}
                />
                <PasswordWithVisibility
                  value={newCustomer.password}
                  onChange={(v) => setNewCustomer((c) => ({ ...c, password: v }))}
                  placeholder="Password"
                  autoComplete="new-password"
                />
                <input
                  className="admin-input"
                  placeholder="Mobile (optional)"
                  value={newCustomer.mobile}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, mobile: e.target.value }))}
                />
                <div className="admin-modal__footer">
                  <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setShowAddCustomerModal(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    onClick={async () => {
                      try {
                        await adminFetch('/api/admin/customers', {
                          method: 'POST',
                          body: JSON.stringify({
                            fullName: newCustomer.fullName,
                            email: newCustomer.email,
                            password: newCustomer.password,
                            ...(newCustomer.mobile ? { mobile: newCustomer.mobile } : {})
                          })
                        })
                        setNewCustomer({ fullName: '', email: '', password: '', mobile: '' })
                        setShowAddCustomerModal(false)
                        await refreshCustomers({ page: 1, sort: 'newest' })
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Failed', 'error')
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showAddDriverModal ? (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowAddDriverModal(false)
              }}
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
                <h3 className="admin-modal__title">Add driver</h3>
                <input
                  className="admin-input"
                  placeholder="Full name"
                  value={newDriver.fullName}
                  onChange={(e) => setNewDriver((c) => ({ ...c, fullName: e.target.value }))}
                />
                <input
                  className="admin-input"
                  placeholder="Email"
                  type="email"
                  value={newDriver.email}
                  onChange={(e) => setNewDriver((c) => ({ ...c, email: e.target.value }))}
                />
                <PasswordWithVisibility
                  value={newDriver.password}
                  onChange={(v) => setNewDriver((c) => ({ ...c, password: v }))}
                  placeholder="Password (min 6 characters)"
                  autoComplete="new-password"
                />
                <div className="admin-modal__footer">
                  <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setShowAddDriverModal(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    onClick={async () => {
                      try {
                        await adminFetch('/api/admin/drivers', {
                          method: 'POST',
                          body: JSON.stringify(newDriver)
                        })
                        setNewDriver({ fullName: '', email: '', password: '' })
                        setShowAddDriverModal(false)
                        await refreshDrivers()
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Failed', 'error')
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {editingDriver ? (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) setEditingDriver(null)
              }}
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
                <h3 className="admin-modal__title">Edit driver</h3>
                <input
                  className="admin-input"
                  placeholder="Full name"
                  value={editingDriver.fullName}
                  onChange={(e) => setEditingDriver((d) => (d ? { ...d, fullName: e.target.value } : d))}
                />
                <input
                  className="admin-input"
                  placeholder="Email"
                  type="email"
                  value={editingDriver.email}
                  onChange={(e) => setEditingDriver((d) => (d ? { ...d, email: e.target.value } : d))}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '12px 0 4px' }}>Zoho contact status</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  {Boolean(editingDriver.disabled) ? (
                    <span className="admin-pill-warn admin-pill">Inactive (app sign-in blocked)</span>
                  ) : (
                    <span className="admin-pill">Active</span>
                  )}
                  {editingDriver.zohoContactId ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn-inline"
                      onClick={async () => {
                        const zid = editingDriver.zohoContactId
                        if (!zid) return
                        const nextDisabled = !Boolean(editingDriver.disabled)
                        try {
                          await adminFetch(`/api/admin/drivers/zoho/${encodeURIComponent(zid)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ disabled: nextDisabled })
                          })
                          setEditingDriver((x) => (x ? { ...x, disabled: nextDisabled } : x))
                          await refreshDrivers()
                          toast(nextDisabled ? 'Driver deactivated in Zoho' : 'Driver activated in Zoho', 'info')
                        } catch (e) {
                          toast(e instanceof Error ? e.message : 'Failed', 'error')
                        }
                      }}
                    >
                      {Boolean(editingDriver.disabled) ? 'Activate in Zoho' : 'Deactivate in Zoho'}
                    </button>
                  ) : null}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '10px 0 4px' }}>New password (optional)</p>
                <PasswordWithVisibility
                  value={editingDriverPassword}
                  onChange={setEditingDriverPassword}
                  placeholder="Leave blank to keep current password"
                  autoComplete="new-password"
                />
                <div className="admin-modal__footer">
                  <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setEditingDriver(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    onClick={async () => {
                      try {
                        const body: Record<string, string> = {}
                        if (editingDriver.fullName.trim()) body.fullName = editingDriver.fullName.trim()
                        if (editingDriver.email.trim()) body.email = editingDriver.email.trim()
                        if (editingDriverPassword) body.password = editingDriverPassword
                        if (Object.keys(body).length === 0) {
                          toast('Change at least one field', 'info')
                          return
                        }
                        if (!editingDriver.zohoContactId) {
                          toast('Missing driver Zoho id; refresh the page and try again', 'error')
                          return
                        }
                        await adminFetch(
                          `/api/admin/drivers/zoho/${encodeURIComponent(editingDriver.zohoContactId)}`,
                          {
                            method: 'PUT',
                            body: JSON.stringify(body)
                          }
                        )
                        setEditingDriver(null)
                        setEditingDriverPassword('')
                        await refreshDrivers()
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Failed', 'error')
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {editingCustomer ? (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setEditingCustomer(null)
                }
              }}
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
                <h3 className="admin-modal__title">Edit customer</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '0 0 4px' }}>Full name</p>
                <input
                  className="admin-input"
                  placeholder="Full name"
                  value={editingCustomer.fullName}
                  onChange={(e) => setEditingCustomer((c) => (c ? { ...c, fullName: e.target.value } : c))}
                />
                <div
                  style={{
                    margin: '10px 0 6px',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--admin-surface-2, rgba(0,0,0,0.04))',
                    fontSize: '0.8rem',
                    color: 'var(--admin-muted)'
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--admin-fg, inherit)', marginBottom: 4 }}>Zoho email(s)</div>
                  {editingCustomer.zohoTopEmail ? <div>Contact: {editingCustomer.zohoTopEmail}</div> : <div>Contact: —</div>}
                  {editingCustomer.primaryPersonEmail ? (
                    <div>Primary person: {editingCustomer.primaryPersonEmail}</div>
                  ) : (
                    <div>Primary person: —</div>
                  )}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '12px 0 4px' }}>Zoho contact status</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  {Boolean(editingCustomer.disabled) ? (
                    <span className="admin-pill-warn admin-pill">Inactive (app sign-in blocked)</span>
                  ) : (
                    <span className="admin-pill">Active</span>
                  )}
                  {editingCustomer.contactId ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn-inline"
                      onClick={async () => {
                        const cid = editingCustomer.contactId
                        if (!cid) return
                        const nextDisabled = !Boolean(editingCustomer.disabled)
                        try {
                          await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(cid)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ disabled: nextDisabled })
                          })
                          setEditingCustomer((x) => (x ? { ...x, disabled: nextDisabled } : x))
                          await refreshCustomers()
                          toast(nextDisabled ? 'Customer deactivated in Zoho' : 'Customer activated in Zoho', 'info')
                        } catch (e) {
                          toast(e instanceof Error ? e.message : 'Failed', 'error')
                        }
                      }}
                    >
                      {Boolean(editingCustomer.disabled) ? 'Activate in Zoho' : 'Deactivate in Zoho'}
                    </button>
                  ) : null}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '10px 0 4px' }}>
                  App login email (editable; used for customer app sign-in when app login exists)
                </p>
                <input
                  className="admin-input"
                  placeholder="Email"
                  type="email"
                  autoComplete="off"
                  value={editingCustomer.email}
                  onChange={(e) => setEditingCustomer((c) => (c ? { ...c, email: e.target.value } : c))}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '10px 0 4px' }}>App password</p>
                <input
                  className="admin-input"
                  readOnly
                  aria-readonly
                  value={
                    editingCustomer.hasAppLogin
                      ? '••••••••  (stored as a hash in Zoho — original password cannot be shown)'
                      : 'No app password on file yet'
                  }
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '10px 0 4px' }}>New password (optional)</p>
                <PasswordWithVisibility
                  value={editingCustomerPassword}
                  onChange={setEditingCustomerPassword}
                  placeholder="Leave blank to keep current password"
                  autoComplete="new-password"
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted)', margin: '10px 0 4px' }}>Mobile</p>
                <input
                  className="admin-input"
                  placeholder="Mobile (optional)"
                  value={editingCustomerMobile}
                  onChange={(e) => setEditingCustomerMobile(e.target.value)}
                />
                <p style={{ margin: '8px 0 6px', color: 'var(--admin-muted)', fontSize: '0.8rem' }}>
                  Saving with a new password updates the app login hash in Zoho. The app login email must stay valid when
                  you set a password.
                </p>
                <div className="admin-modal__footer">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => {
                      setEditingCustomer(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-inline"
                    onClick={async () => {
                      try {
                        if (editingCustomer.hasAppLogin && editingCustomer.originalEmail?.includes('@')) {
                          await adminFetch(`/api/admin/customers/${encodeURIComponent(editingCustomer.originalEmail)}`, {
                            method: 'PUT',
                            body: JSON.stringify({
                              fullName: editingCustomer.fullName,
                              email: editingCustomer.email,
                              ...(editingCustomerPassword ? { password: editingCustomerPassword } : {}),
                              ...(editingCustomerMobile ? { mobile: editingCustomerMobile } : {})
                            })
                          })
                        } else if (editingCustomer.contactId) {
                          await adminFetch(`/api/admin/customers/contact/${encodeURIComponent(editingCustomer.contactId)}`, {
                            method: 'PUT',
                            body: JSON.stringify({
                              fullName: editingCustomer.fullName,
                              email: editingCustomer.email || undefined,
                              mobile: editingCustomerMobile,
                              ...(editingCustomerPassword ? { password: editingCustomerPassword } : {}),
                              ...(editingCustomer.originalEmail ? { currentEmail: editingCustomer.originalEmail } : {})
                            })
                          })
                        } else {
                          toast('Missing Zoho contact', 'error')
                          return
                        }
                        setEditingCustomer(null)
                        setEditingCustomerMobile('')
                        setEditingCustomerPassword('')
                        await refreshCustomers()
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Failed', 'error')
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
