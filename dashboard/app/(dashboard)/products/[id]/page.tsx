"use client"

import { useParams } from "next/navigation"
import { ProductView } from "@/components/products/product-view"

// Reads the id from the URL rather than a `params` prop: the same file renders under Next.js and in the Vite
// dashboard (spa/), and an async page — what Next 16's Promise `params` would need — cannot render in a browser.
export default function ProductViewPage() {
  const { id } = useParams<{ id: string }>()
  return <ProductView productId={id} />
}
