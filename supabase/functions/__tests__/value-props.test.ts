// `/config` must always serve value_props in the shape the SDK decodes, whatever is stored.
// Run: deno test --no-check supabase/functions/__tests__/value-props.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { normalizeValueProps } from "../_shared/value-props.ts"

Deno.test("plain strings become check-icon triples", () => {
  assertEquals(normalizeValueProps(["Auto-Save every new status", "  ", "No ads"]), [
    { icon: "check", title: "Auto-Save every new status" },
    { icon: "check", title: "No ads" },
  ])
})

Deno.test("triples pass through; missing icon defaults; titleless rows dropped", () => {
  assertEquals(
    normalizeValueProps([
      { icon: "hd", title: "HD", description: "1080p" },
      { title: "Unlimited" },
      { icon: "star" },
      null,
      7,
    ]),
    [
      { icon: "hd", title: "HD", description: "1080p" },
      { icon: "check", title: "Unlimited" },
    ],
  )
})

Deno.test("non-array is empty", () => {
  assertEquals(normalizeValueProps(null), [])
  assertEquals(normalizeValueProps("x"), [])
})
