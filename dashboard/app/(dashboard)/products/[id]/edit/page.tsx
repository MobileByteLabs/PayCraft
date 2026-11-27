export const runtime = "edge"

import { ProductEdit } from "@/components/products/product-form-pages"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function ProductEditPage({ params }: { params: { id: string } }) {
  return <ProductEdit productId={params.id} />
}
