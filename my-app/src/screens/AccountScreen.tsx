import { useState } from 'react'
import type { AuthUser } from '../services/authApi'

type Props = {
  user: AuthUser | null
  onNavigateOrders: () => void
  onOpenSettings: () => void
  onOpenAddresses: () => string[]
  onOpenPayments: () => string[]
  onLogout: () => void
}

export function AccountScreen({
  user,
  onNavigateOrders,
  onOpenSettings,
  onOpenAddresses,
  onOpenPayments,
  onLogout
}: Props) {
  const [addresses, setAddresses] = useState<string[]>([])
  const [payments, setPayments] = useState<string[]>([])
  const [openSection, setOpenSection] = useState<'none' | 'addresses' | 'payments'>('none')

  function handleOpenAddresses() {
    setAddresses(onOpenAddresses())
    setOpenSection('addresses')
  }

  function handleOpenPayments() {
    setPayments(onOpenPayments())
    setOpenSection('payments')
  }

  return (
    <>
      <header className="top-header light-header">
        <div className="header-row centered-title">
          <div className="icon-btn" />
          <h1>Account</h1>
          <div className="icon-btn" />
        </div>
      </header>

      <main className="content">
        <section className="account-card">
          <img src="/app-logo.png" alt="Abhyati food logo" className="avatar avatar-logo" />
          <div>
            <h3>{user?.fullName?.trim() || 'Your account'}</h3>
            <p>{user?.email?.trim() || 'Signed in'}</p>
          </div>
        </section>

        <div className="account-actions">
          <button type="button" className="btn btn-muted block" onClick={onOpenSettings}>
            Account settings
          </button>
          <button type="button" className="btn btn-muted block" onClick={onNavigateOrders}>
            My Orders
          </button>
          <button type="button" className="btn btn-muted block" onClick={handleOpenAddresses}>
            Delivery Addresses
          </button>
          <button type="button" className="btn btn-muted block" onClick={handleOpenPayments}>
            Payment Methods
          </button>
          <button type="button" className="btn btn-dark block" onClick={onLogout}>
            Logout
          </button>
        </div>

        {openSection === 'addresses' ? (
          <section className="info-list-card">
            <h4>Saved Addresses</h4>
            {addresses.length === 0 ? <p>No saved addresses yet.</p> : null}
            {addresses.map((address) => (
              <p key={address}>{address}</p>
            ))}
          </section>
        ) : null}

        {openSection === 'payments' ? (
          <section className="info-list-card">
            <h4>Payment Methods</h4>
            {payments.length === 0 ? <p>No saved payment methods yet.</p> : null}
            {payments.map((method) => (
              <p key={method}>{method}</p>
            ))}
          </section>
        ) : null}
      </main>
    </>
  )
}
