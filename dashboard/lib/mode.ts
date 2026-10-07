// Test/Live mode duality — Stripe-aligned.
//
// One cookie (`pc_mode`) lets every dashboard surface know whether the operator
// is editing the test-mode or live-mode view. Consumer apps mirror the toggle
// via their build type, which the SDK resolves itself from ONE mode-less key; it picks
// payment_links from the matching map at checkout, and `/config` returns
// mode-appropriate webhook routes server-side.
//
// Server components: import { getMode } from "@/lib/mode" → read it in render.
// Client components: import { useMode } from "@/lib/mode-client" → reactive.

import { cookies } from "next/headers"

export type Mode = "test" | "live"

export const MODE_COOKIE = "pc_mode"
export const MODE_DEFAULT: Mode = "live"

/** Server-component helper: resolve the active mode from the cookie. */
export function getMode(): Mode {
  const c = cookies().get(MODE_COOKIE)?.value
  return c === "test" || c === "live" ? c : MODE_DEFAULT
}

/** Pick the right entry from a `{ test, live }` shaped object using the cookie. */
export function pickByMode<T>(maps: { test: T; live: T }): T {
  return getMode() === "test" ? maps.test : maps.live
}

/**
 * Derive mode from a LEGACY mode-prefixed PayCraft key, else null.
 *
 * Does NOT match the SDK's `PayCraft.mode` any more, and cannot: since the one-key model the SDK
 * resolves modeOverride → legacy prefix → HOST BUILD TYPE, and a server has no view of how the
 * client was compiled. A mode-less `pk_<hex>` key (the norm since migration 148) returns null here
 * — which is the honest answer, not a failure. The authority for a client's mode is the
 * `x-paycraft-mode` header it sends; dashboard surfaces use the `pc_mode` cookie instead.
 *
 * Currently unused — kept for legacy-key triage.
 */
export function modeFromApiKey(apiKey: string | null | undefined): Mode | null {
  if (!apiKey) return null
  if (apiKey.startsWith("pk_test_")) return "test"
  if (apiKey.startsWith("pk_live_")) return "live"
  return null
}
