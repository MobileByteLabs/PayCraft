// `paywall.value_props` as the SDK decodes it: `{icon, title, description?}` objects.
//
// The column is JSONB and its writers never checked the shape, so a tenant can hold plain strings
// (`["Auto-Save every new status", …]`). The SDK's decoder then rejects the WHOLE config, and every
// app falls back to its cached catalogue indefinitely — Status Saver kept selling a retired plan for
// two days that way (2026-11-24). Normalise at the edge so no stored shape can do that again.

export type ValueProp = { icon: string; title: string; description?: string }

export function normalizeValueProps(raw: unknown): ValueProp[] {
  if (!Array.isArray(raw)) return []
  const out: ValueProp[] = []
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ icon: "check", title: item.trim() })
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>
      if (typeof o.title !== "string" || !o.title.trim()) continue
      const vp: ValueProp = { icon: typeof o.icon === "string" && o.icon ? o.icon : "check", title: o.title }
      if (typeof o.description === "string") vp.description = o.description
      out.push(vp)
    }
  }
  return out
}
