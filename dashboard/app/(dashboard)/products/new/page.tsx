"use client"

import { useSearchParams } from "next/navigation"
import { NewProduct } from "@/components/products/product-form-pages"

// Reads ?mode= from the URL rather than a `searchParams` prop — see products/[id]/page.tsx.
export default function NewProductPage() {
  return <NewProduct mode={useSearchParams().get("mode") ?? undefined} />
}
