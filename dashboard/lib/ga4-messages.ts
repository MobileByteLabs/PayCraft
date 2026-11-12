// GA4 error messages, kept apart from lib/ga4.ts so a client component can show them without bundling the
// service-account token code (jose) into the browser.

/** The sentence the Analytics page shows for a GA4 error. */
export function ga4ErrorMessage(code: string, saEmail: string | null): string {
  switch (code) {
    case "no_access": return `PayCraft can't read this property — add ${saEmail ?? "PayCraft's GA4 email"} as a Viewer in GA4 ▸ Admin ▸ Property access management.`
    case "not_configured": return "Google Analytics isn't set up on this PayCraft server yet."
    case "bad_property_id": return "Use the numeric GA4 property id (Admin ▸ Property details), not the G-… measurement id."
    case "bad_stream_ids": return "Stream ids are the long numbers under Admin ▸ Data streams (not the G-… measurement id), up to 20."
    case "ga4_unreachable": return "Couldn't reach Google Analytics. Try again in a moment."
    case "ga4_429": return "Google Analytics is rate-limiting this property. Try again in a few minutes."
    case "ga4_400": return "Google Analytics rejected the request — check the property id."
    default: return `Google Analytics returned an error (${code}).`
  }
}
