import type { Order, Product } from '../types/app'

export function matchOrderToProduct(order: Order, products: Product[]): Product | null {
  const match = products.find((product) =>
    order.items.toLowerCase().includes(product.name.split(' ')[0].toLowerCase()),
  )
  return match ?? null
}
