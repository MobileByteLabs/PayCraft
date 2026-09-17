/**
 * ISO 3166-1 alpha-3 → alpha-2 normalization, server-side.
 *
 * The two stores disagree about which code they speak. Play's `getBillingConfig().countryCode`
 * returns alpha-2 ("IN"); StoreKit's `Storefront.current.countryCode` returns **alpha-3** ("IND") —
 * measured on an iOS 26 simulator, which reports `country=USA id=143441`. The SDK forwards whatever
 * the store gave it, so an iOS caller arrives here as `Accept-Language: en-USA`.
 *
 * Everything that CONSUMES a buyer country is keyed on alpha-2 — `tenant_pricing.locale`,
 * `tenant_providers.supported_locales` — so an un-normalized alpha-3 matches nothing and fails
 * quietly, in the merchant's disfavour. Measured against live `/config` before this landed:
 *
 * | country | resolved                     |
 * |---------|------------------------------|
 * | `IN`    | ₹299.00 INR, source `manual` |
 * | `IND`   | $9.99 USD, source `fallback` |
 * | `US`    | $9.90 USD, source `stripe`   |
 * | `USA`   | $9.99 USD, source `fallback` |
 *
 * An Indian buyer on iOS was quoted the fallback USD price rather than their storefront's rupee
 * price, and any tenant whose provider is locale-scoped lost the provider outright, because
 * `["US"].includes("USA")` is false. The paywall still renders and a price still appears; only the
 * amount is wrong, which is why it survived review.
 *
 * ── Why the table lives HERE and not in the SDK ────────────────────────────────────────────────
 * The obvious place is the SDK, next to the code that reads the storefront. It is the wrong place:
 * the SDK is pinned per consumer, so correcting one row would cost a Maven Central release plus a
 * version bump in every app — a storefront Apple adds tomorrow would stay broken until three
 * separate releases shipped. Here it is one function deploy, and it applies to every consumer at
 * once including versions already in the field.
 *
 * The table is the full ISO 3166-1 set rather than Apple's current storefront list, because Apple
 * adds and removes storefronts and a missing row degrades to the raw alpha-3 — the exact bug this
 * exists to fix. Complete is cheaper to maintain than current.
 */

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  ABW: "AW", AFG: "AF", AGO: "AO", AIA: "AI", ALA: "AX", ALB: "AL", AND: "AD", ARE: "AE",
  ARG: "AR", ARM: "AM", ASM: "AS", ATA: "AQ", ATF: "TF", ATG: "AG", AUS: "AU", AUT: "AT",
  AZE: "AZ", BDI: "BI", BEL: "BE", BEN: "BJ", BES: "BQ", BFA: "BF", BGD: "BD", BGR: "BG",
  BHR: "BH", BHS: "BS", BIH: "BA", BLM: "BL", BLR: "BY", BLZ: "BZ", BMU: "BM", BOL: "BO",
  BRA: "BR", BRB: "BB", BRN: "BN", BTN: "BT", BVT: "BV", BWA: "BW", CAF: "CF", CAN: "CA",
  CCK: "CC", CHE: "CH", CHL: "CL", CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COG: "CG",
  COK: "CK", COL: "CO", COM: "KM", CPV: "CV", CRI: "CR", CUB: "CU", CUW: "CW", CXR: "CX",
  CYM: "KY", CYP: "CY", CZE: "CZ", DEU: "DE", DJI: "DJ", DMA: "DM", DNK: "DK", DOM: "DO",
  DZA: "DZ", ECU: "EC", EGY: "EG", ERI: "ER", ESH: "EH", ESP: "ES", EST: "EE", ETH: "ET",
  FIN: "FI", FJI: "FJ", FLK: "FK", FRA: "FR", FRO: "FO", FSM: "FM", GAB: "GA", GBR: "GB",
  GEO: "GE", GGY: "GG", GHA: "GH", GIB: "GI", GIN: "GN", GLP: "GP", GMB: "GM", GNB: "GW",
  GNQ: "GQ", GRC: "GR", GRD: "GD", GRL: "GL", GTM: "GT", GUF: "GF", GUM: "GU", GUY: "GY",
  HKG: "HK", HMD: "HM", HND: "HN", HRV: "HR", HTI: "HT", HUN: "HU", IDN: "ID", IMN: "IM",
  IND: "IN", IOT: "IO", IRL: "IE", IRN: "IR", IRQ: "IQ", ISL: "IS", ISR: "IL", ITA: "IT",
  JAM: "JM", JEY: "JE", JOR: "JO", JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG", KHM: "KH",
  KIR: "KI", KNA: "KN", KOR: "KR", KWT: "KW", LAO: "LA", LBN: "LB", LBR: "LR", LBY: "LY",
  LCA: "LC", LIE: "LI", LKA: "LK", LSO: "LS", LTU: "LT", LUX: "LU", LVA: "LV", MAC: "MO",
  MAF: "MF", MAR: "MA", MCO: "MC", MDA: "MD", MDG: "MG", MDV: "MV", MEX: "MX", MHL: "MH",
  MKD: "MK", MLI: "ML", MLT: "MT", MMR: "MM", MNE: "ME", MNG: "MN", MNP: "MP", MOZ: "MZ",
  MRT: "MR", MSR: "MS", MTQ: "MQ", MUS: "MU", MWI: "MW", MYS: "MY", MYT: "YT", NAM: "NA",
  NCL: "NC", NER: "NE", NFK: "NF", NGA: "NG", NIC: "NI", NIU: "NU", NLD: "NL", NOR: "NO",
  NPL: "NP", NRU: "NR", NZL: "NZ", OMN: "OM", PAK: "PK", PAN: "PA", PCN: "PN", PER: "PE",
  PHL: "PH", PLW: "PW", PNG: "PG", POL: "PL", PRI: "PR", PRK: "KP", PRT: "PT", PRY: "PY",
  PSE: "PS", PYF: "PF", QAT: "QA", REU: "RE", ROU: "RO", RUS: "RU", RWA: "RW", SAU: "SA",
  SDN: "SD", SEN: "SN", SGP: "SG", SGS: "GS", SHN: "SH", SJM: "SJ", SLB: "SB", SLE: "SL",
  SLV: "SV", SMR: "SM", SOM: "SO", SPM: "PM", SRB: "RS", SSD: "SS", STP: "ST", SUR: "SR",
  SVK: "SK", SVN: "SI", SWE: "SE", SWZ: "SZ", SXM: "SX", SYC: "SC", SYR: "SY", TCA: "TC",
  TCD: "TD", TGO: "TG", THA: "TH", TJK: "TJ", TKL: "TK", TKM: "TM", TLS: "TL", TON: "TO",
  TTO: "TT", TUN: "TN", TUR: "TR", TUV: "TV", TWN: "TW", TZA: "TZ", UGA: "UG", UKR: "UA",
  UMI: "UM", URY: "UY", USA: "US", UZB: "UZ", VAT: "VA", VCT: "VC", VEN: "VE", VGB: "VG",
  VIR: "VI", VNM: "VN", VUT: "VU", WLF: "WF", WSM: "WS", YEM: "YE", ZAF: "ZA", ZMB: "ZM",
  ZWE: "ZW",
}

/**
 * Normalize a caller-supplied country to alpha-2.
 *
 * A 2-letter input is already alpha-2 and passes through (Play, browsers, every geo header). A
 * 3-letter input is looked up. Anything else — a locale tag, an empty string, a code invented after
 * this deploy — is returned trimmed and upper-cased rather than dropped: a wrong country is
 * recoverable by the caller's next signal, a null one silently becomes the default.
 */
export function toAlpha2(raw: string | null | undefined): string | null {
  const v = raw?.trim().toUpperCase()
  if (!v) return null
  if (v.length === 3) return ALPHA3_TO_ALPHA2[v] ?? v
  return v
}
