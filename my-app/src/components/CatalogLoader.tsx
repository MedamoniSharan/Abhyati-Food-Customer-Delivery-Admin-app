type Props = {
  /** Screen-reader + visible label */
  label?: string
}

export function CatalogLoader({ label = 'Loading products' }: Props) {
  return (
    <div className="catalog-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="catalog-loader-spinner" aria-hidden />
      <p className="catalog-loader-text">{label}</p>
    </div>
  )
}
