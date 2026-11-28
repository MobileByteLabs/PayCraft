// The release dimensions an event carries (migration 223): app version name, app build, OS version.
// Pure, so it is tested without the function (release-dims.test.ts). An invalid value is DROPPED (null), never a
// reason to refuse the event — a release must not lose its funnel rows over a malformed version string.
// None of the three is personal data (realtime-analytics design, Non-goals).

export type ReleaseDims = { app_version: string | null; app_build: number | null; os_version: string | null }

const INT_MAX = 2_147_483_647

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s.length > 0 && s.length <= max ? s : null
}

function build(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v.trim()) ? Number(v.trim()) : NaN
  return Number.isInteger(n) && n >= 0 && n <= INT_MAX ? n : null
}

/**
 * The event's own `app_version` / `app_build` / `os_version` first, else the batch's (the SDK may send them once per
 * batch), else — for app_version only — the batch's legacy `appVersion` (migration 215, SDKs before 223).
 */
export function releaseDims(event: Record<string, unknown>, batch: Record<string, unknown>): ReleaseDims {
  return {
    app_version: text(event.app_version, 40) ?? text(batch.app_version, 40) ?? text(batch.appVersion, 40),
    app_build: build(event.app_build) ?? build(batch.app_build),
    os_version: text(event.os_version, 20) ?? text(batch.os_version, 20),
  }
}
