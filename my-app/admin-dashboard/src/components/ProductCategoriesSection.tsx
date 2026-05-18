import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../adminApi'
import { AdminBlockLoader } from './AdminDataLoader'
import { IconDeleteButton, IconEditButton } from './AdminIconButtons'
import { useToast } from './Toast'

type CategoryRow = { id: string; name: string }

type EnvStatus = { hasContact?: boolean; hasJsonField?: boolean; hasItemField?: boolean }

export function ProductCategoriesSection() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await adminFetch<{
        configured?: boolean
        envStatus?: EnvStatus
        categories?: CategoryRow[]
      }>('/api/admin/product-categories')
      setConfigured(!!r.configured)
      setEnvStatus(r.envStatus && typeof r.envStatus === 'object' ? r.envStatus : null)
      setCategories(Array.isArray(r.categories) ? r.categories : [])
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load categories', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      toast('Enter a category name', 'info')
      return
    }
    try {
      await adminFetch('/api/admin/product-categories', {
        method: 'POST',
        body: JSON.stringify({ name })
      })
      setNewName('')
      toast('Category created in Zoho', 'info')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create', 'error')
    }
  }

  async function saveEdit() {
    if (!editingId) return
    const name = editName.trim()
    if (!name) {
      toast('Name is required', 'info')
      return
    }
    try {
      await adminFetch(`/api/admin/product-categories/${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name })
      })
      setEditingId(null)
      toast('Category updated', 'info')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update', 'error')
    }
  }

  async function removeRow(id: string, label: string) {
    if (!confirm(`Remove category “${label}” from the catalog? Products keep their current label in Zoho until you edit them.`)) return
    try {
      await adminFetch(`/api/admin/product-categories/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast('Category removed', 'info')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    }
  }

  if (loading) {
    return <AdminBlockLoader label="Loading product categories…" />
  }

  return (
    <section>
      <div className="admin-products-header">
        <h2 style={{ marginTop: 0 }}>Product categories</h2>
      </div>

      {!configured ? (
        <div className="admin-card" style={{ padding: 20 }}>
          {envStatus ? (
            <ul className="admin-muted" style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.6 }}>
              <li style={{ color: envStatus.hasContact ? 'var(--admin-text, #111)' : undefined }}>
                <strong>ZOHO_PRODUCT_CATEGORIES_CONTACT_ID</strong> — {envStatus.hasContact ? 'set' : 'missing'}
              </li>
              <li style={{ color: envStatus.hasJsonField ? 'var(--admin-text, #111)' : undefined }}>
                <strong>ZOHO_CUSTOM_FIELD_PRODUCT_CATEGORIES_JSON_ID</strong> — {envStatus.hasJsonField ? 'set' : 'missing'}
              </li>
              <li style={{ color: envStatus.hasItemField ? 'var(--admin-text, #111)' : undefined }}>
                <strong>ZOHO_CUSTOM_FIELD_ITEM_CATEGORY_NAME_ID</strong> — {envStatus.hasItemField ? 'set' : 'missing'}
              </li>
            </ul>
          ) : null}
          {envStatus?.hasContact && envStatus?.hasItemField && !envStatus?.hasJsonField ? (
            <>
              <p style={{ margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
                One step left: add a <strong>new</strong> multiline contact custom field for the category list JSON.
              </p>
              <p className="admin-muted" style={{ margin: '12px 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Do <strong>not</strong> reuse <code>cf_abhyati_tier_catalog_json</code> (pricing tiers). In Zoho Books:
                Settings → Preferences → Customers → Custom fields → add a multiline field (e.g. &quot;Abhyati product
                categories JSON&quot;), add it to your catalog contact layout, then from <code>my-app/backend</code> run:
              </p>
              <pre
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'var(--admin-border-subtle, #f5f5f5)',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  overflow: 'auto'
                }}
              >
                {`npm run zoho:product-categories-env -- <your_catalog_contact_id>`}
                {'\n'}
                {`node scripts/show-zoho-product-categories-env.mjs --apply-contact-json=<new_field_id>`}
              </pre>
              <p className="admin-muted" style={{ margin: '12px 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Restart the backend after updating <code>.env</code>.
              </p>
            </>
          ) : (
            <>
              <p className="admin-muted" style={{ margin: 0, lineHeight: 1.5 }}>
                Product categories are stored in <strong>Zoho Books</strong>: a catalog contact holds JSON in a contact
                custom field, and each item&apos;s category name is saved on an <strong>item</strong> custom field.
              </p>
              <p className="admin-muted" style={{ margin: '12px 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Set all three variables in the backend <code>.env</code> (see <code>.env.example</code>), then restart
                the API. List ids with <code>npm run zoho:product-categories-env</code> from <code>my-app/backend</code>.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <section className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Add category</h3>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                className="admin-input"
                style={{ minWidth: 220, flex: '1 1 200px' }}
                placeholder="Category name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                aria-label="New category name"
              />
              <button type="submit" className="admin-btn admin-btn-inline">
                Add to Zoho catalog
              </button>
            </form>
          </section>

          <div className="admin-card" style={{ padding: 0 }}>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Id</th>
                    <th className="admin-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="admin-muted" style={{ padding: 20 }}>
                        No categories yet. Add one above, then assign products from the Products page.
                      </td>
                    </tr>
                  ) : (
                    categories.map((c) => (
                      <tr key={c.id}>
                        <td className="admin-td-strong">
                          {editingId === c.id ? (
                            <input
                              className="admin-input"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              aria-label="Edit category name"
                            />
                          ) : (
                            c.name
                          )}
                        </td>
                        <td className="admin-td-mono" style={{ fontSize: '0.8rem' }}>
                          {c.id}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            {editingId === c.id ? (
                              <>
                                <button type="button" className="admin-btn admin-btn-inline" onClick={() => void saveEdit()}>
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--ghost"
                                  onClick={() => {
                                    setEditingId(null)
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <IconEditButton
                                  label={`Edit ${c.name}`}
                                  onClick={() => {
                                    setEditingId(c.id)
                                    setEditName(c.name)
                                  }}
                                />
                                <IconDeleteButton label={`Delete ${c.name}`} onClick={() => void removeRow(c.id, c.name)} />
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
