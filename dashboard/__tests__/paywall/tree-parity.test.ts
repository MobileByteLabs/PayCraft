import { readFileSync, existsSync } from "fs"
import { join } from "path"
import {
  parseWorkflow,
  resolveLid,
  packageRoles,
  defaultSelectedRole,
} from "@/components/paywall/tree/parse"
import {
  effectiveProperties,
  hasVariable,
  substituteVariables,
  rendersNothing,
  pricesItself,
} from "@/components/paywall/tree/variables"
import type { PaywallNode, PaywallWorkflow, RenderContext } from "@/components/paywall/tree/types"

/**
 * The dashboard's tree parser, run over the SAME seed files the SDK's tests parse.
 *
 * Two parsers for one format is a drift machine; the seeds are the shared fixture that makes the
 * drift fail a test instead of shipping. Each assertion below has a twin in `SeedTreeSuiteTest.kt`,
 * deliberately — not pixel geometry (which will never match, and should not), but the CONCLUSIONS:
 * which packages exist, which one is selected, whether the card prices itself, whether an empty
 * variable erases its chip.
 */

const SEED_DIR = join(
  __dirname,
  "../../../cmp-paycraft/src/commonMain/composeResources/files/paycraft/seed",
)
const SLUGS = ["branded_stack", "minimal", "dark", "premium"] as const

function seed(name: string): PaywallWorkflow {
  const path = join(SEED_DIR, `${name}.json`)
  expect(existsSync(path)).toBe(true)
  const wf = parseWorkflow(readFileSync(path, "utf8"))
  expect(wf).not.toBeNull()
  return wf as PaywallWorkflow
}

function ctx(role: string | null, locale = "en_US"): RenderContext {
  return { locale, hasIntroOffer: false, selectedPackageRole: role }
}

function collectPackages(wf: PaywallWorkflow): Extract<PaywallNode, { kind: "package" }>[] {
  const out: Extract<PaywallNode, { kind: "package" }>[] = []
  const walk = (n: PaywallNode | null) => {
    if (!n) return
    if (n.kind === "package") {
      out.push(n)
      walk(n.stack)
    } else if (n.kind === "stack" || n.kind === "footer") {
      n.components.forEach(walk)
    } else if (n.kind === "purchase_button") {
      walk(n.stack)
    }
  }
  wf.steps.forEach((s) => walk(s.root))
  return out
}

function findNodes(wf: PaywallWorkflow, kind: PaywallNode["kind"]): PaywallNode[] {
  const out: PaywallNode[] = []
  const walk = (n: PaywallNode | null) => {
    if (!n) return
    if (n.kind === kind) out.push(n)
    if (n.kind === "stack" || n.kind === "footer") n.components.forEach(walk)
    if (n.kind === "package") walk(n.stack)
    if (n.kind === "purchase_button") walk(n.stack)
  }
  wf.steps.forEach((s) => walk(s.root))
  return out
}

describe("shipped seed trees, parsed by the dashboard", () => {
  it.each(SLUGS)("%s parses into a renderable workflow", (slug) => {
    const wf = seed(slug)
    expect(wf.schemaVersion).toBe(2)
    expect(wf.steps.length).toBeGreaterThan(0)
    expect(wf.steps.find((s) => s.id === wf.initialStepId)).toBeDefined()
    expect(wf.steps[0].root).not.toBeNull()
  })

  it.each(SLUGS)("%s is purchasable — it has a CTA and a restore", (slug) => {
    const wf = seed(slug)
    // A paywall with no purchase_button cannot be bought from: `package` nodes only SELECT.
    expect(findNodes(wf, "purchase_button").length).toBeGreaterThan(0)
    expect(findNodes(wf, "restore_purchases").length).toBeGreaterThan(0)
  })

  it.each(SLUGS)("%s marks its selected package (D18)", (slug) => {
    const wf = seed(slug)
    const pkgs = collectPackages(wf)
    expect(pkgs.length).toBeGreaterThanOrEqual(2)

    const role = pkgs[0].roleIdentifier
    const on = effectiveProperties(pkgs[0].stack, ctx(role), role)
    const off = effectiveProperties(
      pkgs[pkgs.length - 1].stack,
      ctx(role),
      pkgs[pkgs.length - 1].roleIdentifier,
    )
    expect(on.border).toBeDefined()
    expect(Number(on.border_width)).toBeGreaterThan(0)
    expect(Object.keys(off)).toHaveLength(0)
  })

  it.each(SLUGS)("%s prices itself rather than relying on the overlay (D17)", (slug) => {
    const wf = seed(slug)
    const pkgs = collectPackages(wf)
    for (const p of pkgs) expect(pricesItself(p.stack, wf, ctx(p.roleIdentifier))).toBe(true)
  })

  it.each(SLUGS)("%s declares an authored default selection", (slug) => {
    const wf = seed(slug)
    const role = defaultSelectedRole(wf)
    expect(role).not.toBeNull()
    expect(packageRoles(wf)).toContain(role)
  })
})

describe("variables", () => {
  const price = { display: "$41.99", perPeriodNote: "$3.49 / mo billed annually", savingsPercent: 50 }

  it("substitutes the closed set", () => {
    expect(substituteVariables("{{ product.price }}", price)).toBe("$41.99")
    expect(substituteVariables("{{ product.price_per_period }}", price)).toBe(
      "$3.49 / mo billed annually",
    )
    expect(substituteVariables("{{ product.offer_savings }}", price)).toBe("50%")
    expect(substituteVariables("{{ product.offer_savings_label }}", price)).toBe("SAVE 50%")
  })

  it("resolves unknown and unpriced variables to empty, never to braces", () => {
    expect(substituteVariables("{{ product.nonsense }}", price)).toBe("")
    expect(substituteVariables("{{ product.price }}", null)).toBe("")
    expect(hasVariable("no variables here")).toBe(false)
  })

  it("erases a savings chip whose label substitutes away (D19)", () => {
    const wf = seed("minimal")
    const pkgs = collectPackages(wf)
    const monthly = pkgs[pkgs.length - 1]
    // No saving on the monthly plan: the chip's stack must render nothing AT ALL, decoration
    // included — otherwise a coloured pill floats in the card promising a discount with no number.
    const chip = findChipStack(monthly.stack)
    expect(chip).not.toBeNull()
    expect(rendersNothing(chip!, wf, ctx(monthly.roleIdentifier), { display: "$6.99" })).toBe(true)
    // …and stays when there IS one.
    expect(
      rendersNothing(chip!, wf, ctx(monthly.roleIdentifier), { display: "$41.99", savingsPercent: 50 }),
    ).toBe(false)
  })

  function findChipStack(node: PaywallNode): PaywallNode | null {
    if (node.kind !== "stack") return null
    for (const c of node.components) {
      if (
        c.kind === "stack" &&
        c.backgroundHex &&
        c.components.length === 1 &&
        c.components[0].kind === "text"
      ) {
        return c
      }
      const nested = findChipStack(c)
      if (nested) return nested
    }
    return null
  }
})

describe("degradation", () => {
  it("substitutes an unknown node instead of dropping its subtree", () => {
    const wf = parseWorkflow(
      JSON.stringify({
        schema_version: 99,
        initial_step_id: "s",
        steps: [
          {
            id: "s",
            components_config: {
              type: "stack",
              components: [{ type: "hologram", components: [{ type: "text", text_lid: "t" }] }],
            },
          },
        ],
        localizations: { en_US: { t: "kept" } },
      }),
    )
    expect(wf).not.toBeNull()
    const unknown = findNodes(wf!, "unknown")
    expect(unknown).toHaveLength(1)
    expect((unknown[0] as { type: string }).type).toBe("hologram")
  })

  it("drops an override whose conditions are all unrecognised", () => {
    const wf = parseWorkflow(
      JSON.stringify({
        schema_version: 2,
        initial_step_id: "s",
        steps: [
          {
            id: "s",
            components_config: {
              type: "stack",
              overrides: [{ conditions: [{ type: "solar_eclipse" }], properties: { background: "#fff" } }],
              components: [],
            },
          },
        ],
        localizations: {},
      }),
    )
    // Applying it would restyle UNCONDITIONALLY — the opposite of what it asks for.
    expect(wf!.steps[0].root!.overrides).toHaveLength(0)
  })

  it("falls back through locales rather than rendering a bare lid", () => {
    const wf = seed("minimal")
    expect(resolveLid(wf, "title", "de_DE")).toBe("Upgrade to Premium")
    expect(resolveLid(wf, "no_such_lid", "en_US")).toBe("no_such_lid")
  })
})
