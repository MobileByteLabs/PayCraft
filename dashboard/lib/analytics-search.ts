// The Analytics page's URL filters — shared by the page (browser) and /api/dash/analytics (server), so both read
// the same filter set from the same query string.

export type AnalyticsSearch = { range?: string; platform?: string; country?: string; app_version?: string; plan?: string }
export type AnalyticsFilterValue = { platform?: string; country?: string; appVersion?: string; plan?: string }

/** The URL's filters, kept only when well-formed (a malformed one is ignored, never sent to a query). */
export function readFilters(q: AnalyticsSearch | undefined): AnalyticsFilterValue {
  const platform = q?.platform?.toLowerCase()
  const country = q?.country?.toUpperCase()
  return {
    platform: platform && ["android", "ios", "web", "desktop", "macos"].includes(platform) ? platform : undefined,
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    appVersion: q?.app_version && /^[0-9A-Za-z._+-]{1,32}$/.test(q.app_version) ? q.app_version : undefined,
    plan: q?.plan && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(q.plan) ? q.plan : undefined,
  }
}

/** The filters back as a query string (`platform=…&country=…`), empty when none are set. */
export function filterQueryString(filters: AnalyticsFilterValue): string {
  return new URLSearchParams(
    Object.entries({ platform: filters.platform, country: filters.country, app_version: filters.appVersion, plan: filters.plan })
      .filter((e): e is [string, string] => !!e[1]),
  ).toString()
}
