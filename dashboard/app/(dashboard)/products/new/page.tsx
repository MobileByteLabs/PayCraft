export const runtime = "edge"

import { NewProduct } from "@/components/products/product-form-pages"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function NewProductPage({ searchParams }: { searchParams?: { mode?: string } }) {
  return <NewProduct mode={searchParams?.mode} />
}
