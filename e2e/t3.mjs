import { WEB, browser, page, login, shot, stepUp, nationalCode, iban, DIR } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const run = JSON.parse(readFileSync(`${DIR}/run.json`, "utf8"));
const { M, R } = run;
const CEO = nationalCode(`00${R}456`.slice(0, 9)), BOARD = nationalCode("071234567");
const b = await browser();
const p = await page(b, { width: 1280, height: 900 });
await login(p, WEB, M);
const save = async () => {
  await p.getByRole("button", { name: "ذخیره", exact: true }).click();
  await p.getByText("ذخیره شد").waitFor({ timeout: 10000 }).catch(async (e) => { await shot(p, "zz-save"); console.log("SAVE FAIL", p.url(), (await p.locator("main").innerText()).slice(-700)); throw e; });
  if (!(await p.getByText("این بخش کامل است.").count()) && !p.url().includes("licences")) { await shot(p, "zz-incomplete"); console.log("INCOMPLETE", p.url(), (await p.locator(".banner-warning").allInnerTexts()).join(" | ")); }
};
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const field = (label, n = 0) => p.getByLabel(new RegExp(`^${esc(label)}( \\(اختیاری\\))?$`)).nth(n);
const clearRows = async () => { await p.waitForTimeout(800); while ((await p.locator(".repeat-row").count()) > 0) await p.locator(".repeat-row").last().getByRole("button", { name: "حذف" }).click(); };
const pick = async (label, value, n = 0) => field(label, n).selectOption(value);

// ---- bank account (step-up)
await p.goto(`${WEB}/bank`);
await p.getByText("حساب‌های بانکی").first().waitFor(); await p.waitForTimeout(1500);
if (!(await p.locator(".chip", { hasText: "تأیید شده" }).count())) {
await p.getByLabel("شماره‌ی شبا").fill(iban(`017000000000000000${R}`.slice(0, 22)));
await stepUp(p, M, () => p.getByRole("button", { name: "بررسی و افزودن" }).click());
await p.locator(".chip", { hasText: "تأیید شده" }).first().waitFor();
}

// ---- home
await p.goto(`${WEB}/`);
await p.getByText("پرونده‌ی اعتباری خود را تکمیل و ارسال کنید.").waitFor();
await shot(p, "20-home");

// ---- §1 general (pre-filled from registration)
await p.goto(`${WEB}/case/form/general`);
await field("محل ثبت").waitFor();
await field("محل ثبت").fill("تهران");
await field("کد اقتصادی").fill("411122223333");
await field("سرمایه‌ی اولیه (میلیون ریال)").fill("1000");
await field("سرمایه‌ی فعلی (میلیون ریال)").fill("50000");
await field("نام مدیرعامل").fill("سارا احمدی");
await field("همراه مدیرعامل").fill("09121234567");
await field("نام نماینده در پرونده").fill("سارا احمدی");
await field("سمت نماینده").fill("مدیرعامل");
await pick("آشنایی با صندوق از طریق", "website");
if (!(await field("تلفن ثابت").inputValue())) await field("تلفن ثابت").fill("02188776655");
await shot(p, "21-section-general");
await save();
await p.getByText("این بخش کامل است.").waitFor();

// ---- §2 knowledge-based
await p.goto(`${WEB}/case/form/knowledge_based`);
await p.getByRole("button", { name: "بله" }).click();
await pick("نوع", "فناور");
await field("تاریخ تأیید").fill("1404/02/11");
await field("اعتبار تا").fill("1406/02/11");
await field("حوزه").fill("الکترونیک صنعتی");
await field("محصولات دانش‌بنیان").fill("حسگر دمای صنعتی");
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §3 locations
await p.goto(`${WEB}/case/form/locations`);
await p.getByRole("button", { name: "افزودن محل" }).waitFor();
// delete leftover rows beyond the first, then make sure there is exactly one to fill
while ((await p.locator(".repeat-row").count()) > 1) await p.locator(".repeat-row").last().getByRole("button", { name: "حذف" }).click();
if (!(await p.locator(".repeat-row").count())) await p.getByRole("button", { name: "افزودن محل" }).click();
await pick("کاربری", "head_office"); await pick("وضعیت مالکیت", "leased");
await field("متراژ (متر مربع)").fill("120"); await pick("استان", "تهران");
await field("کد پستی").fill("1234567890"); await field("نشانی").fill("تهران، خیابان آزادی، پلاک ۱۰");
await p.getByRole("button", { name: "افزودن محل" }).click();
await pick("کاربری", "factory", 1); await pick("وضعیت مالکیت", "owned", 1);
await field("متراژ (متر مربع)", 1).fill("900"); await pick("استان", "البرز", 1);
await field("کد پستی", 1).fill("3761234567"); await field("نشانی", 1).fill("شهرک صنعتی سیمین‌دشت");
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §4 board
await p.goto(`${WEB}/case/form/board`);
await p.getByRole("button", { name: /^افزودن/ }).first().waitFor(); await clearRows();
await field("شماره‌ی آخرین روزنامه‌ی رسمی").fill("23456");
await field("تاریخ روزنامه").fill("1404/11/21");
for (const [i, nc, name, roles, share, sign] of [[0, CEO, "سارا احمدی", ["مدیرعامل", "عضو هیئت‌مدیره", "سهامدار"], "70", true], [1, BOARD, "رضا کریمی", ["عضو هیئت‌مدیره", "سهامدار"], "30", false]]) {
  await p.getByRole("button", { name: "افزودن شخص" }).click();
  await field("نام", i).fill(name); await field("کد ملی / شناسه‌ی ملی", i).fill(nc); await pick("نوع", "person", i);
  const row = p.locator(".repeat-row").nth(i);
  for (const r of roles) await row.getByLabel(r).check();
  await field("درصد سهام", i).fill(share);
  if (sign) await row.getByRole("button", { name: "بله" }).click(); else await row.getByRole("button", { name: "خیر" }).click();
}
await shot(p, "22-section-board");
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §4b CVs (one per director)
await p.goto(`${WEB}/case/form/cvs`);
for (const i of [0, 1]) {
  await field("سمت", i).fill(i ? "عضو هیئت‌مدیره" : "مدیرعامل");
  await field("رشته و آخرین مدرک", i).fill(i ? "کارشناسی ارشد مدیریت" : "دکتری مهندسی برق");
  await field("سال‌های سابقه", i).fill(i ? "9" : "15");
}
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §5 workforce
await p.goto(`${WEB}/case/form/workforce`);
await field("تمام‌وقت").fill("38"); await field("پاره‌وقت").fill("4"); await field("بیمه‌شده").fill("40");
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §6 company and products
await p.goto(`${WEB}/case/form/company_products`);
await p.getByRole("button", { name: /^افزودن/ }).first().waitFor(); await clearRows();
await field("تاریخچه‌ی شرکت").fill("تأسیس ۱۳۹۸؛ تولید حسگر برای صنایع فولاد");
await field("فرایند تولید یا ارائه‌ی خدمت").fill("طراحی، مونتاژ و کالیبراسیون");
await p.getByRole("button", { name: "افزودن محصول" }).click();
await field("نام محصول یا خدمت").fill("حسگر دما"); await field("مشتریان اصلی").fill("فولاد مبارکه");
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §7 banks
await p.goto(`${WEB}/case/form/banks_facilities`);
await p.getByRole("button", { name: /^افزودن/ }).first().waitFor(); await clearRows();
await p.getByRole("button", { name: "افزودن حساب" }).click();
await field("بانک").fill("ملت"); await field("شعبه").fill("مرکزی"); await field("شماره‌ی حساب یا شبا").fill("1234567890");
const decl = p.locator(".field", { hasText: "چک برگشتی رفع‌نشده دارد" }); await decl.getByRole("button", { name: "خیر" }).click();
const debt = p.locator(".field", { hasText: "بدهی سررسیدگذشته‌ی بانکی دارد" }); await debt.getByRole("button", { name: "خیر" }).click();
await save(); await p.getByText("این بخش کامل است.").waitFor();

// ---- §8 optional
await p.goto(`${WEB}/case/form/licences_contracts_assets`);
await save();

// ---- financials: three balanced years (million rials)
await p.goto(`${WEB}/case/financials`);
await p.locator("select.select").first().waitFor();
const years = await p.locator("thead th").allInnerTexts();
for (const [col, sales] of [[0, 310000], [1, 205000], [2, 138000]]) {
  await p.locator("thead select").nth(col).selectOption("audited");
  const set = async (label, v) => p.getByLabel(new RegExp(`^${label} \\d{4}$`)).nth(col).fill(String(v));
  for (const [l, v] of [["موجودی نقد", 116000], ["دارایی‌های ثابت مشهود", 141500], ["حساب‌ها و اسناد پرداختنی تجاری", 60000], ["تسهیلات بلندمدت", 62500], ["سرمایه", 135000], ["فروش خالص", sales], ["بهای تمام‌شده‌ی فروش", Math.round(sales * 0.85)]]) await set(l, v);
}
await shot(p, "23-financials");
await p.getByRole("button", { name: "ذخیره" }).click(); await p.getByText("ذخیره شد").waitFor();

// ---- documents: upload a file to every slot; "ندارم" for optional ones
await p.goto(`${WEB}/case/documents`);
await p.getByRole("button", { name: "فقط موارد باز" }).click();
for (let guard = 0; guard < 60; guard++) {
  const na = p.getByRole("button", { name: "ندارم" });
  const linkInput = p.getByLabel("پیوند پیامکی گزارش");
  const up = p.getByRole("button", { name: "بارگذاری", exact: true });
  if (await na.count()) { await na.first().click(); await p.waitForTimeout(400); continue; }
  if (!(await up.count())) break;
  if (await linkInput.count()) await linkInput.first().fill("https://ics24.ir/r/abc");
  const slot = up.first().locator("xpath=ancestor::div[contains(@class,'slot')]");
  const before = await p.locator(".slot").count();
  await slot.locator("input[type=file]").setInputFiles({ name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") });
  await p.waitForFunction((n) => document.querySelectorAll(".slot").length < n, before, { timeout: 15000 });
}
await shot(p, "24-documents");

// ---- letter, sign, submit
await p.goto(`${WEB}/case`);
await p.getByLabel("متن درخواست (خطاب به صندوق)").fill("درخواست تأمین مالی حدود ۲۰ میلیارد ریال برای خرید تجهیزات خط تولید حسگر.");
await p.getByRole("button", { name: "ذخیره‌ی متن" }).click();
await stepUp(p, M, () => p.getByRole("button", { name: "امضا با رمز یکبارمصرف" }).click());
await p.getByText("امضا شد").waitFor();
await shot(p, "25-case-ready");
const blockers = await p.locator(".banner-warning li").allInnerTexts();
if (blockers.length) console.log("BLOCKERS", blockers);
await p.getByText("تعهد می‌کنم").click();
await stepUp(p, M, () => p.getByRole("button", { name: "ارسال پرونده" }).click());
await p.locator(".chip", { hasText: "ارسال شده" }).first().waitFor({ timeout: 10000 });
await shot(p, "26-case-submitted");
console.log("T3 OK");
await b.close();
