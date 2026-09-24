// @public-endpoint developer portal landing page — static marketing/reference shell, holds no data
import { DOCS_HEADERS } from "@/lib/api-security"

export const dynamic = "force-static"

/**
 * The developer portal served at the root of the API host.
 *
 * Lives as a route rather than a React page because this host must never render dashboard chrome:
 * everything else on `api.*` 404s, and an api origin that can show a login form is an invitation to
 * type a password into the wrong place.
 *
 * Self-contained — no framework CSS, no fonts, no script. A docs landing page that cannot render
 * when a CDN is slow is worse than a plain one.
 */

const ENDPOINTS: [string, string, string, string][] = [
  ["GET", "/v1/tenant", "tenant:read", "Plan, limits and the calling key's scopes"],
  ["GET", "/v1/readiness", "readiness:read", "Per-provider, per-mode readiness + manual steps"],
  ["GET", "/v1/products", "products:read", "Catalogue with each provider's synced ids"],
  ["GET", "/v1/products/{id}", "products:read", "One product, with pricing rows"],
  ["POST", "/v1/products/{id}/sync", "products:sync", "Push one product to its providers"],
  ["GET", "/v1/providers", "providers:read", "Connected providers and payment links"],
  ["GET", "/v1/sync", "products:read", "Drift report — what a sync would do"],
  ["POST", "/v1/sync", "products:sync", "Run the drain (confirm_count required)"],
  ["GET", "/v1/sync/events", "products:read", "Per-provider events for a run"],
  ["GET", "/v1/subscribers", "subscribers:read", "Subscription records"],
  ["GET", "/v1/entitlements", "subscribers:read", "Canonical entitlement state"],
  ["GET", "/v1/coupons", "coupons:read", "Discount codes and provider counterparts"],
  ["GET", "/v1/paywall", "paywall:read", "Paywall configuration the SDK renders"],
  ["GET", "/v1/webhooks", "webhooks:read", "Inbound webhook deliveries"],
  ["GET", "/v1/audit", "audit:read", "Who changed what, including this API"],
]

const rows = ENDPOINTS.map(
  ([m, p, s, d]) => `<tr>
    <td><span class="m m-${m.toLowerCase()}">${m}</span></td>
    <td><code>${p}</code></td>
    <td><span class="scope${s === "products:sync" ? " w" : ""}">${s}</span></td>
    <td class="d">${d}</td>
  </tr>`,
).join("")

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PayCraft Management API</title>
<meta name="description" content="Server-to-server API for automating a PayCraft tenant: provider readiness, product sync, subscribers and audit." />
<script>
  // Runs BEFORE first paint. Setting the attribute from JS after render would show a light flash to
  // anyone who chose dark; doing it here means the first painted frame is already correct.
  // No system fallback: absent a stored choice the answer is light.
  (function () {
    try {
      if (localStorage.getItem("pc-theme") === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch (e) { /* storage blocked — light is still the right default */ }
  })();
</script>
<style>
  /* LIGHT IS THE DEFAULT, deliberately — not the system preference.
     The prefers-color-scheme media query used to drive this, which meant a reader on a dark-themed OS got a dark
     docs page they never chose, and the toggle had no way to say "actually, light". The theme is
     now an explicit choice: light unless the reader picks dark, remembered per browser. */
  /* Palette aligned to idea-layer/design-system/design-tokens.yaml (2026-09-25). This page used
     indigo #4f46e5 while the product, the docs site and the dashboard all use violet-700 #6d28d9,
     so the API host read as a different product. The neutrals carry a slight violet bias for the
     same reason a pure mid-grey looks unconsidered beside violet.
     On the dark ground the accent shifts to violet-400: 700 does not hold contrast there.
     FONTS STAY SYSTEM. The header comment above commits this page to being self-contained, and a
     webfont would mean a landing page that cannot render when a CDN is slow. Colour alignment is
     free; a font request is not. */
  :root {
    --bg:#ffffff; --fg:#1c1a25; --muted:#635d78; --line:#e9e6f2; --soft:#faf9fd;
    --accent:#6d28d9; --accent-soft:#f5f3ff; --warn:#b25e00; --warn-soft:#fdf0e3;
    --code:#14121c; --code-fg:#e6e3ee;
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    --bg:#100e17; --fg:#e6e3ee; --muted:#a09ab5; --line:#262133; --soft:#17141f;
    --accent:#a78bfa; --accent-soft:#1e1733; --warn:#fbbf24; --warn-soft:#292018;
    --code:#0a0810; --code-fg:#e6e3ee;
    color-scheme: dark;
  }
  /* The toggle, top-right. Fixed so it stays reachable on a long page. */
  .theme {
    position:fixed; top:18px; right:18px; z-index:50;
    display:inline-flex; align-items:center; gap:6px;
    background:var(--bg); border:1px solid var(--line); border-radius:99px;
    padding:5px 11px 5px 9px; cursor:pointer; color:var(--muted);
    font:600 12px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.01em;
    box-shadow:0 1px 3px rgba(15,23,42,.06);
  }
  .theme:hover { color:var(--fg); border-color:var(--accent); }
  .theme svg { width:14px; height:14px; }
  .theme .lbl { display:none; }
  @media (min-width:560px) { .theme .lbl { display:inline; } }
  :root[data-theme="dark"] .theme { box-shadow:none; }
  /* Shows the CURRENT mode, because the control carries a text label: "Light" beside a sun reads as
     a statement of where you are. An icon-only toggle would show the target instead, but pairing a
     target icon with a current-state label is the combination that confuses. */
  :root:not([data-theme="dark"]) .i-moon { display:none; }
  :root[data-theme="dark"] .i-sun { display:none; }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:980px; margin:0 auto; padding:0 24px; }
  header { border-bottom:1px solid var(--line); padding:64px 0 48px; }
  .eyebrow {
    display:inline-block; font-size:11px; font-weight:700; letter-spacing:.09em;
    text-transform:uppercase; color:var(--accent); background:var(--accent-soft);
    padding:5px 10px; border-radius:99px; margin-bottom:18px;
  }
  h1 { font-size:clamp(30px,5vw,44px); line-height:1.12; margin:0 0 14px; letter-spacing:-0.025em; }
  .lede { font-size:17px; color:var(--muted); max-width:62ch; margin:0 0 26px; }
  .cta { display:flex; gap:10px; flex-wrap:wrap; }
  .btn {
    display:inline-block; padding:10px 18px; border-radius:10px; font-weight:600; font-size:14px;
    text-decoration:none; border:1px solid var(--line); color:var(--fg); background:var(--bg);
  }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn:hover { border-color:var(--accent); }
  section { padding:44px 0; border-bottom:1px solid var(--line); }
  h2 { font-size:19px; margin:0 0 6px; letter-spacing:-0.01em; }
  .sub { color:var(--muted); font-size:14px; margin:0 0 20px; max-width:64ch; }
  pre {
    background:var(--code); color:var(--code-fg); padding:16px 18px; border-radius:12px;
    overflow-x:auto; font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace; margin:0 0 12px;
  }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding:0 10px 8px 0; font-weight:600; }
  td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
  code { font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace; }
  .m { font:11px/1 ui-monospace,monospace; font-weight:700; padding:4px 7px; border-radius:5px; }
  .m-get { background:var(--accent-soft); color:var(--accent); }
  .m-post { background:var(--warn-soft); color:var(--warn); }
  .scope { font:11px ui-monospace,monospace; color:var(--muted); }
  .scope.w { color:var(--warn); font-weight:700; }
  .d { color:var(--muted); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px; background:var(--soft); }
  .card h3 { margin:0 0 6px; font-size:14px; }
  .card p { margin:0; font-size:13px; color:var(--muted); }
  .note { border-left:3px solid var(--warn); background:var(--warn-soft); padding:12px 14px; border-radius:0 10px 10px 0; font-size:13.5px; }
  footer { padding:32px 0 56px; color:var(--muted); font-size:13px; display:flex; gap:16px; flex-wrap:wrap; }
  footer a { color:var(--accent); text-decoration:none; }
  .scroll { overflow-x:auto; }
</style>
</head>
<body>
<button class="theme" id="t" type="button" aria-label="Switch colour theme">
  <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
  <span class="lbl i-moon">Dark</span><span class="lbl i-sun">Light</span>
</button>
<header><div class="wrap">
  <span class="eyebrow">PayCraft · API v1</span>
  <h1>Automate billing setup<br />without a browser session.</h1>
  <p class="lede">
    Check whether every payment provider can actually transact — live and in test — and reconcile
    your catalogue with Stripe, Razorpay, Google Play and the App Store. Built for CI, deploy
    pipelines and agents.
  </p>
  <div class="cta">
    <a class="btn primary" href="https://docs.paycraft.mobilebytesensei.com/API_OVERVIEW/">Documentation</a>
    <a class="btn" href="/v1/docs">Interactive reference</a>
    <a class="btn" href="/v1/openapi.json">openapi.json</a>
    <a class="btn" href="https://paycraft.mobilebytesensei.com/settings/developer-api">Create an API key</a>
  </div>
</div></header>

<section><div class="wrap">
  <h2>Quick start</h2>
  <p class="sub">Create a key under Settings → Developer API. It is shown once — PayCraft stores a hash, not the key.</p>
<pre>export PAYCRAFT_KEY="pcsk_..."

# Can every provider transact yet?
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \\
  https://api.paycraft.mobilebytesensei.com/v1/readiness | jq '.summary'

# { "total": 4, "needs_manual_action": 2, "live_ready": 4, "test_ready": 2 }

# What would a sync change? Then do it, echoing the count back.
N=$(curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \\
  https://api.paycraft.mobilebytesensei.com/v1/sync | jq .confirm_count)

curl -s -X POST -H "Authorization: Bearer $PAYCRAFT_KEY" \\
  -H "content-type: application/json" -d "{\\"confirm_count\\": $N}" \\
  https://api.paycraft.mobilebytesensei.com/v1/sync</pre>
</div></section>

<section><div class="wrap">
  <h2>Endpoints</h2>
  <p class="sub">Every endpoint requires exactly one scope. The tenant is derived from the key — no endpoint accepts a tenant id.</p>
  <div class="scroll">
  <table>
    <thead><tr><th></th><th>Path</th><th>Scope</th><th>Returns</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
</div></section>

<section><div class="wrap">
  <h2>How it behaves</h2>
  <div class="grid">
    <div class="card">
      <h3>The key names the tenant</h3>
      <p>No endpoint takes a tenant id — in a body, a query or a header. A bearer credential that could name the tenant would be a key to every tenant.</p>
    </div>
    <div class="card">
      <h3>Scoped, not all-or-nothing</h3>
      <p>A read key cannot bulk-write to live payment providers, even though both sit behind the same authentication.</p>
    </div>
    <div class="card">
      <h3>Writes ask twice</h3>
      <p><code>POST /v1/sync</code> requires the count from <code>GET /v1/sync</code>. A mismatch returns 409 — the set changed between looking and acting.</p>
    </div>
    <div class="card">
      <h3>200 is not "all fine"</h3>
      <p>A sync reports per-provider verdicts. Read <code>failed</code> and <code>skipped</code>; a provider can fail while the call succeeds.</p>
    </div>
    <div class="card">
      <h3>Hashed at rest</h3>
      <p>Only a SHA-256 of each key is stored. A database dump yields nothing usable, and a lost key is replaced, never recovered.</p>
    </div>
    <div class="card">
      <h3>Rate limited per tenant</h3>
      <p>120 requests, refilling at 1/second. Over the limit returns 429 — sized for a runaway script, not a human.</p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>What the API cannot do</h2>
  <p class="sub">Worth knowing before you automate against it.</p>
  <div class="note">
    <strong>Google Play and App Store test mode cannot be enabled through any API.</strong>
    Neither store exposes a way to turn it on or to assert that it is on. Those rows carry
    <code>manual_steps</code> — ordered instructions for a person with a device — and turn green only
    when a real sandbox purchase reaches PayCraft. Every other provider reaches test readiness
    through a test credential plus a sync.
  </div>
</div></section>

<footer><div class="wrap" style="display:flex;gap:18px;flex-wrap:wrap">
  <a href="/v1/docs">Reference</a>
  <a href="/v1/openapi.json">OpenAPI 3.1</a>
  <a href="https://paycraft.mobilebytesensei.com">Dashboard</a>
  <span style="margin-left:auto">PayCraft · MobileByteSensei</span>
</div></footer>
<script>
  document.getElementById("t").addEventListener("click", function () {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    if (dark) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "dark");
    try { localStorage.setItem("pc-theme", dark ? "light" : "dark"); } catch (e) {}
  });
</script>
</body>
</html>`

export async function GET() {
  return new Response(HTML, {
    headers: {
      ...DOCS_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  })
}
