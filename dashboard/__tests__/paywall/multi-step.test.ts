import { parseWorkflow } from "@/components/paywall/tree/parse"
import {
  Json,
  navigationTargets,
  patchNode,
  stepRoot,
  stepRows,
} from "@/components/paywall/tree/edit"
import type { PaywallNode } from "@/components/paywall/tree/types"

/**
 * D15 — the dashboard half of multi-step workflows.
 *
 * The SDK and the dashboard parse the same trees, so a `button` the SDK navigates with must be a
 * button the dashboard can see, edit and preview. `MultiStepWorkflowTest` is the Kotlin twin.
 */

const TWO_STEP = {
  schema_version: 2,
  initial_step_id: "intro",
  steps: [
    {
      id: "intro",
      name: "Intro",
      components_config: {
        type: "stack",
        components: [
          { type: "text", text_lid: "intro_copy" },
          { type: "button", text_lid: "next", action: { type: "navigate_to", destination: "plans" } },
        ],
      },
    },
    {
      id: "plans",
      name: "Plans",
      is_last_step: true,
      components_config: {
        type: "stack",
        components: [{ type: "text", text_lid: "plans_copy" }],
      },
    },
  ],
  localizations: { en_US: { intro_copy: "Why premium", plans_copy: "Choose a plan", next: "See plans" } },
}

function doc(): Json {
  return JSON.parse(JSON.stringify(TWO_STEP)) as Json
}

describe("multi-step workflows", () => {
  it("parses a navigate_to button and both shorthand forms", () => {
    const wf = parseWorkflow(doc())!
    expect(wf.steps).toHaveLength(2)
    const btn = (wf.steps[0].root as { components: PaywallNode[] }).components.find(
      (n) => n.kind === "button",
    ) as Extract<PaywallNode, { kind: "button" }>
    expect(btn.action).toEqual({ kind: "navigate_to", stepId: "plans" })

    const shorthand = doc()
    ;(shorthand.steps as Json[])[0].components_config = {
      type: "stack",
      components: [{ type: "button", text_lid: "next", navigate_to: "plans" }],
    }
    const wf2 = parseWorkflow(shorthand)!
    const btn2 = (wf2.steps[0].root as { components: PaywallNode[] }).components[0] as Extract<
      PaywallNode,
      { kind: "button" }
    >
    expect(btn2.action).toEqual({ kind: "navigate_to", stepId: "plans" })
  })

  it("degrades an unreadable action instead of showing a dead control", () => {
    const d = doc()
    ;((d.steps as Json[])[0].components_config as Json).components = [
      { type: "button", text_lid: "next", action: { type: "teleport" } },
    ]
    const wf = parseWorkflow(d)!
    const node = (wf.steps[0].root as { components: PaywallNode[] }).components[0]
    expect(node.kind).toBe("unknown")
  })

  it("lists steps and offers every OTHER step as a destination", () => {
    const rows = stepRows(doc())
    expect(rows.map((r) => r.id)).toEqual(["intro", "plans"])
    expect(rows.find((r) => r.id === "plans")!.isLast).toBe(true)
    // A button may not navigate to the step it sits on — that is a control that does nothing.
    expect(navigationTargets(doc(), "intro").map((r) => r.id)).toEqual(["plans"])
  })

  it("edits the step the author selected, not always the first", () => {
    // The bug this pins: keyed on initial_step_id, editing step 2 silently overwrote step 1.
    const d = doc()
    const plansRoot = stepRoot(d, "plans")!
    const edited = patchNode(plansRoot, "0.0", { font_size: 33 })

    const steps = d.steps as Json[]
    const idx = steps.findIndex((s) => s.id === "plans")
    steps[idx].components_config = edited

    const wf = parseWorkflow(d)!
    const introText = (wf.steps[0].root as { components: { fontSize?: number }[] }).components[0]
    const plansText = (wf.steps[1].root as { components: { fontSize?: number }[] }).components[0]
    expect(plansText.fontSize).toBe(33)
    expect(introText.fontSize).not.toBe(33)
  })

  it("stepRoot resolves the requested step, falling back to the initial one", () => {
    expect(stepRoot(doc(), "plans")).not.toBeNull()
    expect(stepRoot(doc())).toEqual(stepRoot(doc(), "intro"))
  })
})
