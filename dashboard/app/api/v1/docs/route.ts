// @public-endpoint static Swagger UI shell — reads the public spec, holds no data
import { DOCS_HEADERS } from "@/lib/api-security"

export const dynamic = "force-static"

/**
 * GET /v1/docs — Swagger UI over the spec next door.
 *
 * Served as a route rather than a React page because it is a standalone document on an API-only
 * host: no dashboard chrome, no session, nothing that would make an `api.*` origin look like a
 * place to sign in.
 *
 * Swagger UI is loaded from a pinned jsDelivr version. Pinned, not `@latest` — a docs page that
 * silently adopts a new major is a docs page that breaks without a deploy.
 */
const SWAGGER_VERSION = "5.17.14"

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PayCraft Management API — Reference</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
<script>
  // Before first paint, so a reader who chose dark never sees a light flash. Default is light.
  (function () {
    try {
      if (localStorage.getItem("pc-theme") === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch (e) {}
  })();
</script>
<style>
  /* Light by default — an explicit choice, not the system preference. Matches the portal at /. */
  :root { color-scheme: light; --bg:#fff; --fg:#0f172a; --muted:#6b7280; --line:#e5e7eb; --accent:#4f46e5; }
  :root[data-theme="dark"] { color-scheme: dark; --bg:#0b0f17; --fg:#e2e8f0; --muted:#9ca3af; --line:#1f2937; --accent:#818cf8; }
  body { margin: 0; background: var(--bg); color: var(--fg); }
  .topbar { display: none; }
  .pc-head {
    font: 500 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 18px 24px; border-bottom: 1px solid var(--line); color: var(--fg);
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .pc-head strong { font-size: 16px; letter-spacing: -0.01em; }
  .pc-head span.sub { color: var(--muted); }
  .pc-head a { color: var(--accent); text-decoration: none; font-weight: 600; }
  .pc-head a:hover { text-decoration: underline; }
  .swagger-ui .info { margin: 24px 0; }

  /* Sits at the END of the header row, so it lands top-right on every width. */
  .theme {
    margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    background: var(--bg); border: 1px solid var(--line); border-radius: 99px;
    padding: 5px 11px 5px 9px; cursor: pointer; color: var(--muted);
    font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
  }
  .theme:hover { color: var(--fg); border-color: var(--accent); }
  .theme svg { width: 14px; height: 14px; }
  :root:not([data-theme="dark"]) .i-moon { display: none; }
  :root[data-theme="dark"] .i-sun { display: none; }

  /* Swagger UI ships light only. These are targeted overrides rather than a filter:invert, which
     would also invert the method badges and syntax highlighting into something unreadable. */
  :root[data-theme="dark"] .swagger-ui,
  :root[data-theme="dark"] .swagger-ui .info .title,
  :root[data-theme="dark"] .swagger-ui .info li,
  :root[data-theme="dark"] .swagger-ui .info p,
  :root[data-theme="dark"] .swagger-ui .info table,
  :root[data-theme="dark"] .swagger-ui .opblock-tag,
  :root[data-theme="dark"] .swagger-ui .opblock .opblock-summary-operation-id,
  :root[data-theme="dark"] .swagger-ui .opblock .opblock-summary-path,
  :root[data-theme="dark"] .swagger-ui .opblock .opblock-summary-description,
  :root[data-theme="dark"] .swagger-ui .opblock-description-wrapper p,
  :root[data-theme="dark"] .swagger-ui .parameter__name,
  :root[data-theme="dark"] .swagger-ui .parameter__type,
  :root[data-theme="dark"] .swagger-ui table thead tr th,
  :root[data-theme="dark"] .swagger-ui .response-col_status,
  :root[data-theme="dark"] .swagger-ui .response-col_description,
  :root[data-theme="dark"] .swagger-ui .model-title,
  :root[data-theme="dark"] .swagger-ui .model,
  :root[data-theme="dark"] .swagger-ui label,
  :root[data-theme="dark"] .swagger-ui .tab li button.tablinks,
  /* Swagger renders the description markdown into .info, and its headings carry their own dark
     colour. Without these they sit at roughly #3b4151 on a #0b0f17 background — present, and
     effectively unreadable. Caught on a real render, not by inspection. */
  :root[data-theme="dark"] .swagger-ui .info h1,
  :root[data-theme="dark"] .swagger-ui .info h2,
  :root[data-theme="dark"] .swagger-ui .info h3,
  :root[data-theme="dark"] .swagger-ui .info h4,
  :root[data-theme="dark"] .swagger-ui .info .markdown h1,
  :root[data-theme="dark"] .swagger-ui .info .markdown h2,
  :root[data-theme="dark"] .swagger-ui .info .markdown h3,
  :root[data-theme="dark"] .swagger-ui .info .title small pre,
  :root[data-theme="dark"] .swagger-ui .opblock-tag small,
  :root[data-theme="dark"] .swagger-ui .responses-inner h4,
  :root[data-theme="dark"] .swagger-ui .responses-inner h5 { color: var(--fg); }
  :root[data-theme="dark"] .swagger-ui .info .markdown code,
  :root[data-theme="dark"] .swagger-ui .info code { background: #1e293b; color: #c7d2fe; }
  :root[data-theme="dark"] .swagger-ui .info table td,
  :root[data-theme="dark"] .swagger-ui .info table th { border-color: var(--line); color: var(--fg); }
  :root[data-theme="dark"] .swagger-ui .opblock-tag,
  :root[data-theme="dark"] .swagger-ui section.models,
  :root[data-theme="dark"] .swagger-ui .opblock { border-color: var(--line); }
  :root[data-theme="dark"] .swagger-ui .opblock .opblock-section-header { background: #111827; }
  :root[data-theme="dark"] .swagger-ui section.models .model-container { background: #111827; }
  :root[data-theme="dark"] .swagger-ui input[type=text],
  :root[data-theme="dark"] .swagger-ui textarea,
  :root[data-theme="dark"] .swagger-ui select {
    background: #0f172a; color: var(--fg); border-color: var(--line);
  }
  :root[data-theme="dark"] .swagger-ui .scheme-container { background: transparent; box-shadow: none; }
  :root[data-theme="dark"] .swagger-ui svg.arrow { fill: var(--fg); }
</style>
</head>
<body>
<div class="pc-head">
  <strong>PayCraft Management API</strong>
  <span class="sub">v1 &middot; server-to-server</span>
  <a href="/v1/openapi.json">openapi.json</a>
  <a href="https://paycraft.mobilebytesensei.com/settings/developer-api">Create an API key &rarr;</a>
  <button class="theme" id="t" type="button" aria-label="Switch colour theme">
    <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    <span class="i-moon">Dark</span><span class="i-sun">Light</span>
  </button>
</div>
<div id="swagger"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.ui = SwaggerUIBundle({
    url: "/v1/openapi.json",
    dom_id: "#swagger",
    deepLinking: true,
    displayRequestDuration: true,
    defaultModelsExpandDepth: 0,
    docExpansion: "list",
    tryItOutEnabled: true,
    persistAuthorization: false,
    presets: [SwaggerUIBundle.presets.apis],
    // "Try it out" hits the real API with whatever key the reader pastes in. POST /v1/sync
    // bulk-writes to live payment providers, so the confirm_count gate matters here as much as it
    // does from a script — it is the thing standing between a curious click and a live write.
    supportedSubmitMethods: ["get", "post"],
  })
</script>
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
