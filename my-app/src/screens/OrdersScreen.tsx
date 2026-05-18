import { useMemo, useState } from 'react'
import type { Order } from '../types/app'
import { OrderCard } from '../components/OrderCard'

type Props = {
  orders: Order[]
  onBackHome: () => void
  onTrackOrder: (order: Order) => void
  onViewDetails: (order: Order) => void
  onInvoice: (order: Order) => void
  onReorder: (order: Order) => void
  onQuickAddFromOrder: (order: Order) => void
}

export function OrdersScreen({
  orders,
  onBackHome,
  onTrackOrder,
  onViewDetails,
  onInvoice,
  onReorder,
  onQuickAddFromOrder,
}: Props) {
  const [tab, setTab] = useState<'active' | 'past'>('active')

  const visibleOrders = useMemo(() => {
    if (tab === 'active') return orders.filter((order) => order.status !== 'Delivered')
    return orders.filter((order) => order.status === 'Delivered')
  }, [orders, tab])

  return (
    <>
      <header className="top-header light-header">
        <div className="header-row centered-title">
          <button type="button" className="icon-btn" onClick={onBackHome}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1>My Orders</h1>
          <span style={{ width: 40 }} aria-hidden="true" />
        </div>
      </header>

      <div className="tabs">
        <button type="button" className={tab === 'active' ? 'tab active' : 'tab'} onClick={() => setTab('active')}>
          In Progress
        </button>
        <button type="button" className={tab === 'past' ? 'tab active' : 'tab'} onClick={() => setTab('past')}>
          Delivered
        </button>
      </div>

      <main className="content orders-content">
        <p className="orders-intro">
          {tab === 'active'
            ? 'Track ongoing orders and check what to do next.'
            : 'See completed orders, download invoice, or buy again.'}
        </p>
        {visibleOrders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            onTrackOrder={onTrackOrder}
            onViewDetails={onViewDetails}
            onInvoice={onInvoice}
            onReorder={onReorder}
          />
        ))}

        {tab === 'past' && visibleOrders.length > 0 ? (
          <button
            type="button"
            className="btn btn-dark block"
            onClick={() => onQuickAddFromOrder(visibleOrders[0])}
          >
            Buy Last Delivered Order Again
          </button>
        ) : null}

        {visibleOrders.length === 0 ? (
          <div className="empty-state">
            <h3>{tab === 'active' ? 'No active orders right now' : 'No delivered orders yet'}</h3>
            <p>
              {tab === 'active'
                ? 'New orders will appear here and you can track delivery in one tap.'
                : 'Delivered orders will show up here once completed.'}
            </p>
          </div>
        ) : null}
      </main>
    </>
  )
}
