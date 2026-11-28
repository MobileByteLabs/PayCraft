import { LiveView } from "@/components/live/live-view"

// Data is read in the browser (TanStack Query + Supabase Realtime) — the page renders instantly.
export default function LivePage() {
  return <LiveView />
}
