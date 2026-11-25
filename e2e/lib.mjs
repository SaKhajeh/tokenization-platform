import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
export const WEB = process.env.WEB_URL ?? "http://localhost:3001", ADMIN = process.env.ADMIN_URL ?? "http://localhost:3002";
/** Where screenshots, saved sessions and the run's identities go, and the API log the mock SMS writes OTPs to. */
export const DIR = process.env.E2E_DIR ?? "/tmp/tp-e2e";
export const API_LOG = process.env.API_LOG ?? "/tmp/tp-api.log";
mkdirSync(`${DIR}/shots`, { recursive: true });
export function nationalCode(p) { const d = p.split("").map(Number); const r = d.reduce((a, v, i) => a + v * (10 - i), 0) % 11; return p + String(r < 2 ? r : 11 - r); }
export function legalId(p) { const d = p.split("").map(Number); const off = d[9] + 2; const w = [29, 27, 23, 19, 17]; let s = 0; for (let i = 0; i < 10; i++) s += (d[i] + off) * w[i % 5]; let r = s % 11; if (r === 10) r = 0; return p + String(r); }
export function iban(b) { let rem = 0; for (const ch of b + "182700") rem = (rem * 10 + Number(ch)) % 97; return `IR${String(98 - rem).padStart(2, "0")}${b}`; }
export async function otp(mobile, after = 0) {
  for (let i = 0; i < 40; i++) {
    const lines = readFileSync(API_LOG, "utf8").split("\n").filter((l) => l.includes(`OTP for ${mobile}:`));
    if (lines.length > after) return lines[lines.length - 1].split(": ").pop().trim();
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no OTP for " + mobile);
}
export const otpCount = (mobile) => readFileSync(API_LOG, "utf8").split("\n").filter((l) => l.includes(`OTP for ${mobile}:`)).length;
export async function browser() { const b = await chromium.launch(); return b; }
export async function page(b, viewport = { width: 1280, height: 900 }) {
  const ctx = await b.newContext({ viewport, locale: "fa-IR" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 200)); });
  return p;
}
export async function typeOtp(p, mobile, before) {
  const code = await otp(mobile, before);
  await p.locator(".otp input").first().waitFor();
  await p.locator(".otp input").first().fill(code);
}
/** Runs an OTP-confirmed action: click, then type the code into the step-up sheet. */
export async function stepUp(p, mobile, click) {
  const n = otpCount(mobile);
  await click();
  await p.locator(".sheet .otp input").first().waitFor({ timeout: 10000 }).catch(async (e) => { await shot(p, "zz-fail"); console.log("PAGE:", (await p.locator("body").innerText()).slice(-800)); throw e; });
  const code = await otp(mobile, n);
  await p.locator(".sheet .otp input").first().fill(code);
  await p.locator(".sheet").waitFor({ state: "detached", timeout: 15000 }).catch(async () => { console.log("SHEET still open:", (await p.locator(".sheet").innerText()).slice(0, 300)); });
}
import { existsSync } from "node:fs";
/** Logs in once per user and reuses the saved browser storage afterwards (the API throttles login codes). */
export async function login(p, base, mobile) {
  const state = `${DIR}/state-${mobile}-${base.slice(-4)}.json`;
  if (existsSync(state)) {
    const st = JSON.parse(readFileSync(state, "utf8"));
    await p.goto(`${base}/login`);
    await p.evaluate((items) => { for (const [k, v] of items) localStorage.setItem(k, v); }, st);
    await p.goto(`${base}/`);
    await p.waitForTimeout(800);
    if (!p.url().includes("/login")) return;
  }
  await p.goto(`${base}/login`);
  await p.getByLabel("شماره‌ی همراه یا ایمیل").fill(mobile);
  const n = otpCount(mobile);
  await p.getByRole("button", { name: "دریافت کد" }).click();
  await typeOtp(p, mobile, n);
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  const items = await p.evaluate(() => Object.entries(localStorage));
  writeFileSync(state, JSON.stringify(items));
}
export const shot = (p, name) => p.screenshot({ path: `${DIR}/shots/${name}.png`, fullPage: true });
