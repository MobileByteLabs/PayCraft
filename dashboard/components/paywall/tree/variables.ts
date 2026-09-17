import { PackagePrice, PaywallNode, PaywallWorkflow, RenderContext } from "./types"
import { resolveLid } from "./parse"

/**
 * `{{ product.price }}` substitution, mirroring `PaywallVariables.kt`.
 *
 * The closed set matters more here than in the SDK: this is the list the properties panel offers an
 * author, so a variable missing from it is a variable nobody can insert, and one present here but
 * absent in the SDK is a variable that renders in the preview and vanishes on the device.
 */
export const PAYWALL_VARIABLES = [
  "product.price",
  "product.price_per_period",
  "product.offer_savings",
  "product.offer_savings_label",
] as const

const PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

export function hasVariable(text: string): boolean {
  PATTERN.lastIndex = 0
  return PATTERN.test(text)
}

/** Unknown or unpriced variables resolve to "" — never to braces shown to a paying customer. */
export function substituteVariables(text: string, price: PackagePrice | null): string {
  if (!hasVariable(text)) return text
  return text.replace(PATTERN, (_m, name: string) => {
    switch (name) {
      case "product.price":
        return price?.display ?? ""
      case "product.price_per_period":
        return price?.perPeriodNote ?? ""
      case "product.offer_savings":
        return price?.savingsPercent != null ? `${price.savingsPercent}%` : ""
      case "product.offer_savings_label":
        return price?.savingsPercent != null ? `SAVE ${price.savingsPercent}%` : ""
      default:
        return ""
    }
  })
}

/** A subtree that lays out its own price; the corner-overlay fallback is skipped for it. */
export function pricesItself(
  node: PaywallNode,
  wf: PaywallWorkflow,
  ctx: RenderContext,
): boolean {
  switch (node.kind) {
    case "text":
      return hasVariable(resolveLid(wf, node.textLid, ctx.locale))
    case "stack":
    case "footer":
      return node.components.some((c) => pricesItself(c, wf, ctx))
    case "package":
      return pricesItself(node.stack, wf, ctx)
    case "purchase_button":
      return node.stack ? pricesItself(node.stack, wf, ctx) : false
    default:
      return false
  }
}

/**
 * A node that would paint only its own decoration — a savings chip whose text substituted away.
 * A CHILDLESS decorated stack is exempt: that is a divider, and decoration is its entire purpose.
 */
export function rendersNothing(
  node: PaywallNode,
  wf: PaywallWorkflow,
  ctx: RenderContext,
  price: PackagePrice | null,
): boolean {
  switch (node.kind) {
    case "text":
      return substituteVariables(resolveLid(wf, node.textLid, ctx.locale), price).trim() === ""
    case "spacer":
      return true
    case "stack":
      return (
        node.components.length > 0 &&
        node.components.every((c) => rendersNothing(c, wf, ctx, price))
      )
    default:
      return false
  }
}

/** Winning property values for the current context; later overrides win, as in the SDK. */
export function effectiveProperties(
  node: PaywallNode,
  ctx: RenderContext,
  packageRole: string | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const override of node.overrides) {
    const holds = override.conditions.every((c) =>
      c === "intro_offer"
        ? ctx.hasIntroOffer
        : packageRole !== null && packageRole === ctx.selectedPackageRole,
    )
    if (holds) Object.assign(out, override.properties)
  }
  return out
}
