// The per-platform provider list behind Providers → Platform providers.
//
// A platform's routing rule (migration 060/075) stores an ORDERED `priority_methods` of any length. The
// panel used to read and write only `[primary, fallback]`; a merchant can now rank as many providers as
// they connect. Order matters twice: `/config` orders `providers[]` by it (the app's primary is the first
// that can serve the buyer), and the web's "Choose how to pay" lists every provider on the list that can
// charge the buyer's price, in this order.

/** The providers a rule names, in order, each once (a provider may appear through several methods). */
export function providersFromRule(priorityMethods: string[] | null | undefined, methodToProvider: Map<string, string>): string[] {
  const out: string[] = []
  for (const m of priorityMethods ?? []) {
    const p = methodToProvider.get(m)
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** [list] with [provider] added at the end (lowest priority); unchanged if already present. */
export function addProvider(list: string[], provider: string): string[] {
  return list.includes(provider) ? list : [...list, provider]
}

/** [list] with the provider at [index] moved one step (-1 = up / higher priority, +1 = down). */
export function moveProvider(list: string[], index: number, step: -1 | 1): string[] {
  const to = index + step
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** [list] without the provider at [index]. */
export function removeProvider(list: string[], index: number): string[] {
  return list.filter((_, i) => i !== index)
}

/**
 * The rule's `priority_methods` for [list]: each provider's cheapest method, in order. A web provider
 * counts only once its account is connected (it cannot take a payment otherwise); a native store
 * (App Store / Google Play) is intrinsic to its platform and always counts.
 */
export function toPriorityMethods(
  list: string[],
  cheapestMethod: Map<string, string>,
  connected: Set<string>,
  webProviders: Set<string>,
): string[] {
  return list
    .filter((p) => (webProviders.has(p) ? connected.has(p) : true))
    .map((p) => cheapestMethod.get(p))
    .filter((m): m is string => !!m)
}
