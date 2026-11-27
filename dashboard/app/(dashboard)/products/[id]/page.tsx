export const runtime = "edge"

import { ProductView } from "@/components/products/product-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function ProductViewPage({ params }: { params: { id: string } }) {
  return <ProductView productId={params.id} />
}
