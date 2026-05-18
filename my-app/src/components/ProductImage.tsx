import { useEffect, useRef, useState } from 'react'
import type { Product } from '../types/app'
import { FALLBACK_PRODUCT_IMAGE, getProductImageSrc } from '../utils/productImage'

type Props = {
  product: Product
  className?: string
}

export function ProductImage({ product, className }: Props) {
  const [src, setSrc] = useState(() => getProductImageSrc(product))
  const usedFallback = useRef(false)

  useEffect(() => {
    usedFallback.current = false
    setSrc(getProductImageSrc(product))
  }, [product])

  return (
    <img
      className={className}
      src={src}
      alt={product.name}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (usedFallback.current) return
        usedFallback.current = true
        setSrc(FALLBACK_PRODUCT_IMAGE)
      }}
    />
  )
}
