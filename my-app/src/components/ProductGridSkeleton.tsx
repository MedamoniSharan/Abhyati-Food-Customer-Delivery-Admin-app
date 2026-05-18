type Props = {
  /** Initial grid fill vs compact row for infinite scroll */
  variant?: 'grid' | 'inline'
  count?: number
}

function SkeletonCard() {
  return (
    <div className="product-skeleton-card" aria-hidden>
      <div className="product-skeleton-shimmer product-skeleton-image" />
      <div className="product-skeleton-shimmer product-skeleton-line title" />
      <div className="product-skeleton-shimmer product-skeleton-line short" />
      <div className="product-skeleton-shimmer product-skeleton-line price" />
      <div className="product-skeleton-shimmer product-skeleton-btn" />
    </div>
  )
}

export function ProductGridSkeleton({ variant = 'grid', count }: Props) {
  const n = count ?? (variant === 'grid' ? 6 : 2)
  return (
    <div className={variant === 'grid' ? 'product-grid product-grid-skeleton' : 'product-grid-skeleton-inline'}>
      {Array.from({ length: n }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
