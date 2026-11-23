import { describe, expect, it } from "@jest/globals"
import {
  EXPERIMENT_ERROR_CODES,
  experimentErrorMessage,
  significance,
  uplift,
  validateExperiment,
  type ExperimentDraft,
} from "@/lib/experiments"

// Mirrors migration 206's paywall_experiment_save(): same codes, same order of checks.
const A = "11111111-1111-1111-1111-111111111111"
const B = "22222222-2222-2222-2222-222222222222"
const base = (over: Partial<ExperimentDraft> = {}): ExperimentDraft => ({
  key: "annual-price-test",
  name: "Annual price",
  variants: [
    { key: "control", weight: 50, offering_id: A },
    { key: "cheaper", weight: 50, offering_id: B },
  ],
  ...over,
})
const v = base().variants

describe("validateExperiment", () => {
  it("accepts a complete draft", () => {
    expect(validateExperiment(base(), [A, B])).toBeNull()
    expect(validateExperiment(base({ key: "a1" }), [A, B])).toBeNull()
  })

  it("names what is wrong, with the database's codes", () => {
    expect(validateExperiment(base({ key: "x" }), [A, B])).toBe("experiment_key_invalid")
    expect(validateExperiment(base({ key: "-abc" }), [A, B])).toBe("experiment_key_invalid")
    expect(validateExperiment(base({ key: "Abc" }), [A, B])).toBe("experiment_key_invalid")
    expect(validateExperiment(base({ key: "a".repeat(49) }), [A, B])).toBe("experiment_key_invalid")
    expect(validateExperiment(base({ variants: [v[0]] }), [A, B])).toBe("experiment_variants_count")
    expect(validateExperiment(base({ variants: [v[0], v[1], { ...v[1], key: "c" }, { ...v[1], key: "d" }, { ...v[1], key: "e" }] }), [A, B]))
      .toBe("experiment_variants_count")
    expect(validateExperiment(base({ variants: [v[0], { ...v[1], key: "Cheaper" }] }), [A, B])).toBe("experiment_variant_key_invalid")
    expect(validateExperiment(base({ variants: [v[0], { ...v[1], key: "" }] }), [A, B])).toBe("experiment_variant_key_invalid")
    expect(validateExperiment(base({ variants: [v[0], { ...v[1], key: "control" }] }), [A, B])).toBe("experiment_variant_key_duplicate")
    expect(validateExperiment(base({ variants: [v[0], { ...v[1], weight: 0 }] }), [A, B])).toBe("experiment_weight_invalid")
    expect(validateExperiment(base({ variants: [v[0], { ...v[1], weight: 101 }] }), [A, B])).toBe("experiment_weight_invalid")
    expect(validateExperiment(base({ variants: [v[0], { ...v[1], weight: 12.5 }] }), [A, B])).toBe("experiment_weight_invalid")
    expect(validateExperiment(base(), [A])).toBe("experiment_offering_unknown")
  })

  it("explains every code in words", () => {
    for (const code of EXPERIMENT_ERROR_CODES) expect(experimentErrorMessage(code)).not.toBe(experimentErrorMessage("nope"))
  })
})

describe("uplift", () => {
  it("is the relative conversion change vs control", () => {
    expect(uplift(0.1, 0.13)).toBeCloseTo(0.3, 10)
    expect(uplift(0.2, 0.1)).toBeCloseTo(-0.5, 10)
    expect(uplift(0, 0.1)).toBeNull()
  })
})

describe("significance", () => {
  it("runs a two-proportion z-test on buyers/viewers", () => {
    // 10% vs 13% on 1000 each: z ≈ 2.103, two-sided p ≈ 0.0355.
    const r = significance({ viewers: 1000, buyers: 100 }, { viewers: 1000, buyers: 130 })
    expect(r.p).toBeCloseTo(0.0355, 3)
    expect(r.significant).toBe(true)
  })

  it("is not significant when p ≥ 0.05", () => {
    const r = significance({ viewers: 1000, buyers: 100 }, { viewers: 1000, buyers: 110 })
    expect(r.p!).toBeGreaterThan(0.05)
    expect(r.significant).toBe(false)
  })

  it("needs at least 100 viewers in each arm", () => {
    const r = significance({ viewers: 99, buyers: 5 }, { viewers: 1000, buyers: 300 })
    expect(r.p!).toBeLessThan(0.05)
    expect(r.significant).toBe(false)
  })

  it("has no p-value without viewers, and p = 1 for identical zero rates", () => {
    expect(significance({ viewers: 0, buyers: 0 }, { viewers: 10, buyers: 1 })).toEqual({ p: null, significant: false })
    expect(significance({ viewers: 200, buyers: 0 }, { viewers: 200, buyers: 0 })).toEqual({ p: 1, significant: false })
  })
})
