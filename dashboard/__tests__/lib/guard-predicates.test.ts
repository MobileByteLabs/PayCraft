import { ALL_GUARDS } from "../support/guards"

/**
 * Proves every guard can FAIL.
 *
 * A source-scanning test that never fires is worse than no test: it reports green on the exact code
 * it was written to reject, and the green is trusted. This codebase produced three of them, each
 * caught only by hand-reintroducing the bug afterwards — a manual step that was forgotten twice.
 *
 * So the check is mechanical now. Every guard ships with `mustFlag` (verbatim lines from real
 * defects) and `mustNotFlag` (verbatim false positives it actually produced). Weaken a predicate
 * and `mustFlag` fails; over-broaden it and `mustNotFlag` fails. The gap where an assertion quietly
 * matches nothing has nowhere left to hide.
 *
 * Adding a guard without fixtures is itself a failure, asserted below.
 */

describe("guard register", () => {
  it("holds every source-scanning guard", () => {
    expect(ALL_GUARDS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(ALL_GUARDS.map((g) => g.id)).size).toBe(ALL_GUARDS.length)
  })

  it.each(ALL_GUARDS.map((g) => [g.id, g]))(
    "%s carries fixtures in both directions",
    (_id, g: any) => {
      // A guard with no positive fixture is a guard nobody proved fires.
      expect(g.mustFlag.length).toBeGreaterThan(0)
      // A guard with no negative fixture will be deleted the first time it cries wolf.
      expect(g.mustNotFlag.length).toBeGreaterThan(0)
      expect(g.what.length).toBeGreaterThan(10)
    },
  )
})

describe("every guard fires on the defect it was written for", () => {
  for (const g of ALL_GUARDS) {
    describe(g.id, () => {
      it.each(g.mustFlag.map((s) => [s.slice(0, 68), s]))("flags: %s", (_label, sample: string) => {
        expect(g.test(sample)).toBe(true)
      })
    })
  }
})

describe("and stays quiet on what it must not flag", () => {
  for (const g of ALL_GUARDS) {
    describe(g.id, () => {
      it.each(g.mustNotFlag.map((s) => [s.slice(0, 68), s]))(
        "ignores: %s",
        (_label, sample: string) => {
          expect(g.test(sample)).toBe(false)
        },
      )
    })
  }
})
