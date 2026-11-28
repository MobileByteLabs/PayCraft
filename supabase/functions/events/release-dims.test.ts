// Run: deno test -A supabase/functions/events/release-dims.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { releaseDims } from "./release-dims.ts"

Deno.test("valid per-event values are kept", () => {
  assertEquals(releaseDims({ app_version: " 2.4.1 ", app_build: 241, os_version: "17.1" }, {}),
    { app_version: "2.4.1", app_build: 241, os_version: "17.1" })
})

Deno.test("invalid values are dropped, not truncated", () => {
  assertEquals(releaseDims({ app_version: "9".repeat(41), app_build: -1, os_version: "1".repeat(21) }, {}),
    { app_version: null, app_build: null, os_version: null })
  assertEquals(releaseDims({ app_version: 2, app_build: 1.5, os_version: "" }, {}),
    { app_version: null, app_build: null, os_version: null })
  assertEquals(releaseDims({ app_build: 2_147_483_648 }, {}).app_build, null)
  assertEquals(releaseDims({ app_build: "12a" }, {}).app_build, null)
})

Deno.test("edge of the caps is accepted; a numeric-string build is parsed", () => {
  assertEquals(releaseDims({ app_version: "9".repeat(40), app_build: "0", os_version: "1".repeat(20) }, {}),
    { app_version: "9".repeat(40), app_build: 0, os_version: "1".repeat(20) })
})

Deno.test("falls back to the batch, then the legacy appVersion", () => {
  assertEquals(releaseDims({}, { app_version: "3.0", app_build: 30, os_version: "15" }),
    { app_version: "3.0", app_build: 30, os_version: "15" })
  assertEquals(releaseDims({}, { appVersion: "2.0" }).app_version, "2.0")
  assertEquals(releaseDims({ app_version: "3.1" }, { appVersion: "2.0" }).app_version, "3.1")
  assertEquals(releaseDims({ app_version: "x".repeat(41) }, { appVersion: "2.0" }).app_version, "2.0")
})
