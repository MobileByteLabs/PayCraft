"use client"

import { useParams } from "next/navigation"
import { WebhookEventLoader } from "./event-view"

// Reads the id from the URL rather than a `params` prop: the same file renders under Next.js and in the Vite
// dashboard (spa/), and an async page — what Next 16's Promise `params` would need — cannot render in a browser.
export default function WebhookEventPage() {
  const { id } = useParams<{ id: string }>()
  return <WebhookEventLoader id={id} />
}
