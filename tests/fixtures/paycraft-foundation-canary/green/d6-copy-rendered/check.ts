import { chromium } from "playwright";
import { readFileSync } from "fs";

// T8 / AC-9 affordance — the D6 guarantee must be VISIBLE beside the active toggle.
// Grepping the source proves the string was typed; only rendering it proves a merchant sees it
// before deciding to disable a product they have already sold.
async function main() {
  // Derived, never hardcoded: a `supabase db reset` + re-seed changes the product's UUID, and a
  // stale literal turns this canary into a 404 that reads like a genuine render failure.
  const PID = process.env.PC_TEST_PRODUCT_ID;
  if (!PID) { console.log("SKIP — PC_TEST_PRODUCT_ID not set (run seed.sh)"); process.exit(2); }
  const cookieStr = readFileSync("/tmp/pc-cookie.txt", "utf8").trim();
  const cookies = cookieStr.split("; ").map((kv) => {
    const i = kv.indexOf("=");
    return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: "127.0.0.1", path: "/" };
  });
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:3999/products/" + PID + "/edit",
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-testid=product-active-d6-copy]", { timeout: 20000 })
    .catch(() => {});
  const el = await page.$("[data-testid=product-active-d6-copy]");
  const copy = el ? (await el.innerText()).replace(/\s+/g, " ").trim() : "";
  const visible = el ? await el.isVisible() : false;
  const checks = {
    present:        !!el,
    visible,
    saysNeverRevoke: /disabling never revokes access/i.test(copy),
    saysLifetime:    /lifetime purchases are honoured indefinitely/i.test(copy),
  };
  console.log("D6 copy checks:", JSON.stringify(checks, null, 2));
  console.log("rendered:", copy.slice(0, 200));
  await browser.close();
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) { console.log("FAIL:", failed.join(", ")); process.exit(1); }
  console.log("PASS — D6 guarantee rendered beside the active toggle");
}
main();
