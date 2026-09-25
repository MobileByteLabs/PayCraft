// @public-endpoint MCP server landing page — static connect instructions, holds no data
import { DOCS_HEADERS } from "@/lib/api-security"
import { MCP_TOOLS } from "@/lib/mcp-tools"

export const dynamic = "force-static"

/**
 * The page a person sees when they open the MCP host in a browser.
 *
 * An MCP endpoint is configured by URL, so its origin is what people paste — and what they visit
 * first when something is not working. Answering a browser with JSON-RPC boilerplate, or with the
 * 405 the transport specifies for GET, tells them nothing about what the server is or how to
 * connect. So: GET renders this, POST speaks the protocol.
 *
 * The tool table is generated from MCP_TOOLS, the same list the server advertises over tools/list.
 * Hand-writing it would let the documentation and the server disagree about what exists.
 */

const ENDPOINT = "https://mcp.paycraft.mobilebytesensei.com/"

const rows = MCP_TOOLS.map(
  (t) => `<tr>
    <td><code>${t.name}</code></td>
    <td>${
      t.destructive
        ? '<span class="tag w">writes live</span>'
        : '<span class="tag r">read-only</span>'
    }</td>
    <td class="d">${t.title}</td>
  </tr>`,
).join("")

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PayCraft MCP Server</title>
<meta name="description" content="Model Context Protocol server for PayCraft — give an AI agent scoped, auditable access to billing provider readiness and product sync." />
<script>
  (function () {
    try {
      if (localStorage.getItem("pc-theme") === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch (e) {}
  })();
</script>
<style>
  /* Light by default, matching the API portal. The theme is an explicit choice, not the system's. */
  /* Palette aligned to idea-layer/design-system/design-tokens.yaml (2026-09-25), matching the API
     landing exactly: these two hosts are siblings and must not read as different products.
     Violet-700 accent, violet-biased neutrals, violet-400 on the dark ground where 700 loses
     contrast. The warn token stays amber and is spent ONLY on the two write tools, the one
     distinction on this page worth colouring. Fonts stay system: this page is self-contained on
     purpose, and an MCP landing that cannot render when a CDN is slow is worse than a plain one. */
  :root {
    --bg:#ffffff; --fg:#1c1a25; --muted:#635d78; --line:#e9e6f2; --soft:#faf9fd;
    --accent:#6d28d9; --accent-soft:#f5f3ff; --warn:#b25e00; --warn-soft:#fdf0e3;
    --ok:#0f9d58; --ok-soft:#e6f4ea; --code:#14121c; --code-fg:#e6e3ee;
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    --bg:#100e17; --fg:#e6e3ee; --muted:#a09ab5; --line:#262133; --soft:#17141f;
    --accent:#a78bfa; --accent-soft:#1e1733; --warn:#fbbf24; --warn-soft:#292018;
    --ok:#6ee7b7; --ok-soft:#052e23; --code:#0a0810; --code-fg:#e6e3ee;
    color-scheme: dark;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:980px; margin:0 auto; padding:0 24px; }
  .theme {
    position:fixed; top:18px; right:18px; z-index:50;
    display:inline-flex; align-items:center; gap:6px;
    background:var(--bg); border:1px solid var(--line); border-radius:99px;
    padding:5px 11px 5px 9px; cursor:pointer; color:var(--muted);
    font:600 12px/1 ui-sans-serif,system-ui,sans-serif;
    box-shadow:0 1px 3px rgba(15,23,42,.06);
  }
  .theme:hover { color:var(--fg); border-color:var(--accent); }
  .theme svg { width:14px; height:14px; }
  .theme .lbl { display:none; }
  @media (min-width:560px) { .theme .lbl { display:inline; } }
  :root[data-theme="dark"] .theme { box-shadow:none; }
  :root:not([data-theme="dark"]) .i-moon { display:none; }
  :root[data-theme="dark"] .i-sun { display:none; }
  header { border-bottom:1px solid var(--line); padding:64px 0 48px; }
  .eyebrow {
    display:inline-block; font-size:11px; font-weight:700; letter-spacing:.09em;
    text-transform:uppercase; color:var(--accent); background:var(--accent-soft);
    padding:5px 10px; border-radius:99px; margin-bottom:18px;
  }
  h1 { font-size:clamp(30px,5vw,44px); line-height:1.12; margin:0 0 14px; letter-spacing:-0.025em; }
  .lede { font-size:17px; color:var(--muted); max-width:62ch; margin:0 0 22px; }
  .endpoint {
    display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap;
    background:var(--soft); border:1px solid var(--line); border-radius:12px;
    padding:10px 14px; font:13px ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  .endpoint b { font:11px ui-sans-serif,system-ui,sans-serif; color:var(--muted); letter-spacing:.06em; text-transform:uppercase; }
  section { padding:44px 0; border-bottom:1px solid var(--line); }
  h2 { font-size:19px; margin:0 0 6px; letter-spacing:-0.01em; }
  .sub { color:var(--muted); font-size:14px; margin:0 0 20px; max-width:66ch; }
  h3 { font-size:13px; margin:22px 0 8px; letter-spacing:.02em; }
  pre {
    background:var(--code); color:var(--code-fg); padding:16px 18px; border-radius:12px;
    overflow-x:auto; font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace; margin:0 0 12px;
  }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding:0 10px 8px 0; font-weight:600; }
  td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
  code { font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace; }
  .tag { font:11px ui-monospace,monospace; font-weight:700; padding:3px 7px; border-radius:5px; white-space:nowrap; }
  .tag.r { background:var(--ok-soft); color:var(--ok); }
  .tag.w { background:var(--warn-soft); color:var(--warn); }
  .d { color:var(--muted); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px; background:var(--soft); }
  .card h4 { margin:0 0 6px; font-size:14px; }
  .card p { margin:0; font-size:13px; color:var(--muted); }
  .note { border-left:3px solid var(--warn); background:var(--warn-soft); padding:12px 14px; border-radius:0 10px 10px 0; font-size:13.5px; }
  footer { padding:32px 0 56px; color:var(--muted); font-size:13px; }
  footer a { color:var(--accent); text-decoration:none; margin-right:18px; }
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
  <span class="eyebrow">PayCraft &middot; MCP Server</span>
  <h1>Let an agent read your billing<br />&mdash; and sync it, carefully.</h1>
  <p class="lede">
    A Model Context Protocol server over the PayCraft management API. Point any MCP client at it and
    an assistant can answer "can we test payments yet", explain what is blocking a provider, and run
    a product sync &mdash; with exactly the permissions the key you give it carries.
  </p>
  <div class="endpoint"><b>Endpoint</b> ${ENDPOINT}</div>
  <p style="margin-top:18px">
    <a class="btn" href="https://docs.paycraft.mobilebytesensei.com/MCP_SERVER/"
       style="display:inline-block;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px;text-decoration:none;border:1px solid var(--accent);color:#fff;background:var(--accent)">
      Full documentation &rarr;
    </a>
  </p>
</div></header>

<section><div class="wrap">
  <h2>Connect</h2>
  <p class="sub">
    Create a key under Settings &rarr; Developer API and grant it only the scopes the agent needs.
    Transport is Streamable HTTP; authentication is a bearer token.
  </p>

  <h3>Claude Code</h3>
<pre>claude mcp add --transport http paycraft ${ENDPOINT} \\
  --header "Authorization: Bearer $PAYCRAFT_KEY"</pre>

  <h3>Claude Desktop &mdash; claude_desktop_config.json</h3>
<pre>{
  "mcpServers": {
    "paycraft": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${ENDPOINT}",
        "--header", "Authorization: Bearer \${PAYCRAFT_KEY}"
      ],
      "env": { "PAYCRAFT_KEY": "pcsk_your_key_here" }
    }
  }
}</pre>

  <h3>Any client &mdash; raw JSON-RPC</h3>
<pre>curl -X POST ${ENDPOINT} \\
  -H "Authorization: Bearer $PAYCRAFT_KEY" \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</pre>
</div></section>

<section><div class="wrap">
  <h2>Tools</h2>
  <p class="sub">
    ${MCP_TOOLS.length} tools, mapped onto the REST API. Each one requires a scope; a key without it
    gets a clear refusal rather than silence.
  </p>
  <div class="scroll">
  <table>
    <thead><tr><th>Tool</th><th>Effect</th><th>What it answers</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
</div></section>

<section><div class="wrap">
  <h2>How it stays safe</h2>
  <div class="grid">
    <div class="card">
      <h4>The key decides everything</h4>
      <p>Tools call the same REST handlers as curl, so an agent has exactly the permissions its key carries. Connecting an assistant grants nothing extra.</p>
    </div>
    <div class="card">
      <h4>Writes ask twice</h4>
      <p>A sync needs the confirm count from the report tool. An agent cannot bulk-write to live providers on a set nobody looked at.</p>
    </div>
    <div class="card">
      <h4>Give it a read-only key</h4>
      <p>Grant only read scopes and the write tools refuse. The safest agent is one that cannot spend money.</p>
    </div>
    <div class="card">
      <h4>Everything is attributable</h4>
      <p>Actions land in the audit trail as <code>actor_type=api_key</code> with the key id, readable through the audit tool.</p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>What an agent cannot do here</h2>
  <div class="note">
    <strong>Google Play and App Store test mode cannot be enabled by any tool.</strong>
    Neither store exposes an API for it. Those readiness rows carry ordered <code>manual_steps</code>
    for a person with a device, and turn green only when a real sandbox purchase reaches PayCraft.
    A good assistant relays those steps; it should never claim to have completed them.
  </div>
</div></section>

<footer><div class="wrap">
  <a href="https://docs.paycraft.mobilebytesensei.com/MCP_SERVER/">Documentation</a>
  <a href="https://api.paycraft.mobilebytesensei.com/">API portal</a>
  <a href="https://api.paycraft.mobilebytesensei.com/v1/docs">REST reference</a>
  <a href="https://paycraft.mobilebytesensei.com/settings/developer-api">Create an API key</a>
  <span style="float:right">PayCraft &middot; MobileByteSensei</span>
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
