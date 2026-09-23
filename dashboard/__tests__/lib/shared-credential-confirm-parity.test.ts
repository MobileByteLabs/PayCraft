import { hasDoubleArrowHandler } from "../support/guards"
import fs from "fs"
import path from "path"

/**
 * Every credential-save FORM must handle the `shared_credential_in_use` 409.
 *
 * `tenant_psp_account_save` / `tenant_store_account_save` RAISE
 * `shared_credential_in_use:<n>` when the submitted credential already bills N other apps.
 * That is not a failure — it is the RPC asking a question only the operator can answer:
 * a save either ROTATES all N apps onto a new provider account, or was meant to create a
 * SECOND connection. The two payloads are indistinguishable, so the server refuses until told.
 *
 * `savePspAccount` (and the two store routes) translate it into
 * `409 { error: "shared_credential_in_use", appsUsing, requiresConfirmation: true }`.
 * A form that only branches on `!res.ok` shows the operator the raw enum string and offers no
 * way to answer — which is exactly what shipped: app-store and google-play handled it, while
 * stripe, razorpay and cashfree each fell through to a generic error.
 *
 * This test enumerates the surfaces FROM DISK. A hardcoded list would have passed in the same
 * shape as the bug — three forms missing from a list nobody re-read. A new provider form is
 * covered the moment it posts to a keys route.
 */

const ROOT = path.join(__dirname, "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".tsx")) out.push(p)
  }
  return out
}

const KEYS_ROUTE = /["'`]\/api\/providers\/[a-z_-]+\/keys["'`]/

const forms = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))]
  .map((file) => ({ file, src: fs.readFileSync(file, "utf8") }))
  .filter(({ src }) => KEYS_ROUTE.test(src))
  .map(({ file, src }) => ({ rel: path.relative(ROOT, file), src }))

describe("shared_credential_in_use — form parity", () => {
  it("finds every credential-save form (guards against a silently-empty sweep)", () => {
    // An empty list would make every test below vacuously pass.
    expect(forms.length).toBeGreaterThanOrEqual(5)
  })

  it.each(forms.map((f) => [f.rel, f]))("%s handles the 409", (_rel, f: any) => {
    expect(f.src).toMatch(/shared_credential_in_use/)
    expect(f.src).toMatch(/409/)
  })

  it.each(forms.map((f) => [f.rel, f]))("%s sends the confirmation flag", (_rel, f: any) => {
    // Handling the 409 without threading the answer back makes the dialog a dead end.
    expect(f.src).toMatch(/confirm_shared_overwrite/)
  })

  it.each(forms.map((f) => [f.rel, f]))(
    "%s offers the separate-account path, not just replace-or-cancel",
    (_rel, f: any) => {
      // Only `p_create_new` forks a connection (112_psp_account_tier.sql) — a different account
      // label does NOT. So a dialog that offers only "replace" and "cancel" leaves an operator who
      // wanted a SECOND provider account with no way forward at all.
      expect(f.src).toMatch(/create_new/)
    },
  )

  it.each(forms.map((f) => [f.rel, f]))(
    "%s never passes a click event as the confirm flag",
    (_rel, f: any) => {
      // `onClick={save}` hands React's MouseEvent to `save(confirmShared = false)`. An object is
      // truthy, so the FIRST click silently grants the confirmation the dialog exists to ask for —
      // rotating N apps onto a new account with no prompt. The fix is `onClick={() => save()}`.
      expect(f.src).not.toMatch(/onClick=\{save\}/)
    },
  )
})

/**
 * Repo-wide, not provider-specific: `onClick={() => () => doThing()}` type-checks fine because
 * onClick's return value is ignored — so the handler returns a *function* and the click does
 * NOTHING. Silent, invisible in review, and indistinguishable from a working button until someone
 * clicks it in production. Hit for real while wiring the separate-account button above.
 */
describe("no double-arrow click handlers", () => {
  const all = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))]

  it("scans a non-trivial number of components", () => {
    expect(all.length).toBeGreaterThan(20)
  })

  it("has no handler that returns a function instead of calling it", () => {
    const offenders = all
      .filter((f) => hasDoubleArrowHandler(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})
