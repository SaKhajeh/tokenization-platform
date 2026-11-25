/**
 * Phone fit: every applicant page at 390 px must not be wider than the screen (a wider page makes phones zoom out).
 * Run after t1–t5 (it uses the applicant's saved session).
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { WEB, DIR } from "./lib.mjs";
const { M } = JSON.parse(readFileSync(`${DIR}/run.json`, "utf8"));
const st = JSON.parse(readFileSync(`${DIR}/state-${M}-${WEB.slice(-4)}.json`, "utf8"));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`${WEB}/login`);
await p.evaluate((items) => { for (const [k, v] of items) localStorage.setItem(k, v); }, st);
const sections = ["general", "knowledge_based", "locations", "board", "cvs", "workforce", "company_products", "banks_facilities", "licences_contracts_assets"];
const routes = ["/", "/kyb", "/bank", "/wallet", "/financing", "/case", ...sections.map((s) => `/case/form/${s}`), "/case/financials", "/case/documents",
  "/limit", "/applications/new", "/more", "/notifications", "/onboarding"];
const bad = [];
for (const r of routes) {
  await p.goto(`${WEB}${r}`);
  await p.waitForTimeout(1500);
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  if (w > 390) bad.push(`${r} (${w}px)`);
}
// the application tracker of the first application
await p.goto(`${WEB}/financing`); await p.waitForTimeout(1200);
const link = p.locator("ul.list a").first();
if (await link.count()) { await link.click(); await p.waitForTimeout(1500); const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 390) bad.push(`application tracker (${w}px)`); }
console.log(bad.length ? `TOO WIDE: ${bad.join(", ")}` : `PHONE FIT OK (${routes.length + 1} pages)`);
await b.close();
process.exit(bad.length ? 1 : 0);
