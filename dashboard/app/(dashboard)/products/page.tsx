export const runtime = "edge"

import { ProductsList } from "@/components/products/products-list"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function ProductsPage() {
  return <ProductsList />
}
