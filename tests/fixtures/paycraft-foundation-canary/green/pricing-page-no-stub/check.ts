import { chromium } from "playwright";
import { readFileSync } from "fs";

// AC-30 — the pricing page must render the REAL product, never the retired "Product"/999 stub.
// A browser is required rather than curl: the page is a client component that fetches in
// useEffect, so server-rendered HTML only ever contains the loading state.
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
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto("http://127.0.0.1:3999/products/" + PID + "/pricing", { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for the client-side fetch to resolve into EITHER the real row or the error state,
  // rather than a fixed sleep that could capture the loading frame and read as a stub-free pass.
  await page.waitForFunction(
    () => /pro_real/.test(document.body.innerText) ||
          !!document.querySelector("[data-testid=pricing-load-error]"),
    null, { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(500);
  const text = await page.innerText("body");
  const html = await page.content();

  const checks = {
    // The page renders `product.sku || product.display_name` (page.tsx:155), so the sku is the
    // visible identity. That is exactly why the old stub showed "Product": it set sku:"" and
    // display_name:"Product", falling through to the placeholder name.
    rendersRealSku:   /pro_real/.test(text),
    rendersRealPrice: /14\.99|1499/.test(text),
    noStubName:       !/>Product</.test(html),
    noStubPrice:      !/\b9\.99\b|\b999\b/.test(text),
    noErrorState:     !/pricing-load-error/.test(html),
  };
  console.log("AC-30 checks:", JSON.stringify(checks, null, 2));
  if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 5));
  console.log("--- body excerpt ---");
  console.log(text.slice(0, 400));
  await browser.close();
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) { console.log("AC-30 FAIL:", failed.join(", ")); process.exit(1); }
  console.log("AC-30 PASS — real name and price rendered, stub literals absent");
}
main();
