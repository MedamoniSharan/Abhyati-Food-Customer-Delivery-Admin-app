import type { Product } from '../types/app'
import { formatCatalogTitle } from '../utils/productTitle'
import { ProductImage } from './ProductImage'
import { formatInr } from '../utils/currency'

type Props = {
  product: Product
  onOpenProduct: (product: Product) => void
  onAddToCart: (product: Product) => void
}

export function ProductCard({ product, onOpenProduct, onAddToCart }: Props) {
  const titleDisplay = formatCatalogTitle(product.name)

  return (
    <article className="product-card">
      <button
        type="button"
        className="image-frame image-button"
        onClick={() => onOpenProduct(product)}
        aria-label={`View ${product.name}`}
      >
        <ProductImage product={product} />
        {product.badge ? (
          <span className={`badge badge-${product.badge.tone}`}>{product.badge.label}</span>
        ) : null}
      </button>

      <div className="product-card__body">
        <h3 className="product-card__title" title={product.name}>
          {titleDisplay}
        </h3>
        {product.subtitle.trim() ? (
          <p className="product-subtitle" title={product.subtitle}>
            {product.subtitle}
          </p>
        ) : null}

        <div className="price-row">
          {product.oldPriceInr ? (
            <div className="price-row__line">
              <span className="old-price">{formatInr(product.oldPriceInr)}</span>
              <span className="price">{formatInr(product.priceInr)}</span>
            </div>
          ) : (
            <span className="price price--solo">{formatInr(product.priceInr)}</span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-accent product-card__cta"
        onClick={() => onAddToCart(product)}
      >
        Add to Cart
      </button>
    </article>
  )
}
