import { ADMIN, WEB, browser, page, login, shot, stepUp, DIR } from "./lib.mjs";
import { readFileSync } from "node:fs";
const { M } = JSON.parse(readFileSync(`${DIR}/run.json`, "utf8"));
const AN = "09350000001", FM = "09350000002";
const b = await browser();
const an = await page(b, { width: 1440, height: 900 });
await login(an, ADMIN, AN);
await an.getByRole("link", { name: "پرونده‌های اعتباری" }).click();
await an.locator("tbody tr a").first().click();
await an.getByRole("button", { name: "شروع بررسی (به نام من)" }).click();
await an.getByText("مورد در انتظار بررسی").waitFor();
// documents: accept every slot (the list advances to the next one)
await an.getByRole("tab", { name: "مدارک" }).click();
await an.locator(".review .item").first().click();
await an.locator(".item", { hasText: "در حال بررسی" }).first().click();
await an.getByRole("button", { name: "نمایش" }).first().click();
await an.locator(".viewer iframe, .viewer img").first().waitFor({ timeout: 10000 });
await shot(an, "30-admin-documents");
for (let i = 0; i < 40; i++) {
  const next = an.locator(".item", { hasText: "در حال بررسی" });
  if (!(await next.count())) break;
  await next.first().click();
  await an.getByRole("button", { name: "پذیرفتن", exact: true }).click();
  await an.waitForTimeout(350);
}
// form sections
await an.getByRole("tab", { name: "فرم اطلاعات" }).click();
for (let i = 0; i < 12; i++) {
  const btn = an.getByRole("button", { name: "پذیرفتن", exact: true });
  if (!(await btn.count())) break;
  await btn.first().click(); await an.waitForTimeout(500);
}
await an.getByRole("button", { name: "مدارک کامل است" }).click();
await an.locator(".chip", { hasText: "مدارک کامل" }).first().waitFor();
// figures: correct one cell with a reason, then lock
await an.getByRole("tab", { name: "ارقام مالی" }).click();
await an.locator("td.num button").first().click();
await an.getByLabel("دلیل (مثلاً مطابق یادداشت ۱۲ صورت مالی)").fill("مطابق ترازنامه‌ی حسابرسی‌شده");
await an.getByRole("button", { name: "ثبت", exact: true }).click();
await an.waitForTimeout(800);
await shot(an, "31-admin-figures");
await an.getByRole("button", { name: "قفل ارقام تأییدشده" }).click();
await an.getByText("قفل شد").waitFor();
// visit: tomorrow, visitor = the technical expert
await an.getByRole("tab", { name: "بازدید" }).click();
const t = new Date(Date.now() + 3.5 * 3600e3 + 86400e3);
const { toJalaali } = await import("jalaali-js").then((m) => m.default ?? m);
const j = toJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
await an.getByLabel("تاریخ").fill(`${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`);
await an.getByLabel("بازدیدکننده").selectOption({ index: 1 });
await an.getByRole("button", { name: "ارسال به متقاضی" }).click();
await an.locator(".chip", { hasText: "پیشنهاد صندوق" }).waitFor();

// applicant confirms the visit
const ap = await page(b, { width: 390, height: 844 });
await login(ap, WEB, M);
await ap.goto(`${WEB}/case`);
await ap.getByRole("button", { name: "تأیید زمان بازدید" }).click();
await ap.locator(".chip", { hasText: "تأیید شد" }).first().waitFor();
await shot(ap, "32-applicant-visit");

// technical expert / fund manager account files the report and records originals
const fm = await page(b, { width: 1440, height: 900 });
await login(fm, ADMIN, FM);
await fm.goto(an.url());
await fm.getByRole("tab", { name: "بازدید" }).click();
await fm.getByLabel("یافته‌ها").fill("خط تولید فعال، ۳۰ نفر نیرو، انبار مطابق اظهار.");
await fm.getByRole("button", { name: "ثبت گزارش" }).click();
await fm.locator(".chip", { hasText: "انجام شد" }).waitFor();
await fm.getByRole("tab", { name: "مدارک" }).click();
for (const item of await fm.locator(".item").all()) {
  await item.click();
  const btn = fm.getByRole("button", { name: "اصل مدرک تحویل گرفته شد" });
  if (await btn.count()) { await btn.click(); await fm.waitForTimeout(400); }
}

// analyst: scoring with live preview, then send for approval
await an.reload();
await an.getByRole("tab", { name: "محاسبه و تأیید حد" }).click();
await an.getByLabel("نوع فعالیت").selectOption("production_line");
await an.getByLabel("Rc (سابقه‌ی اعتباری)").fill("0.9");
await an.getByLabel("Ra (توان اجرایی)").fill("0.8");
await an.getByLabel("Re (ریسک محیطی)").fill("0.7");
await an.getByLabel("دلیل RC").fill("سابقه‌ی پرداخت منظم و بدون چک برگشتی");
await an.getByLabel("دلیل RA").fill("خط تولید فعال و تیم فنی باتجربه");
await an.getByLabel("دلیل RE").fill("بازار فولاد پایدار، ریسک ارزی متوسط");
await shot(an, "33-admin-scoring-live");
await an.getByRole("button", { name: "ثبت دور محاسبه" }).click();
await an.getByLabel("خلاصه برای مدیر صندوق").fill("شرکت تولیدی با رشد فروش مناسب؛ پیشنهاد حد با چک و سفته.");
await an.getByRole("button", { name: "ارسال برای تأیید مدیر صندوق" }).click();
await an.locator(".chip", { hasText: "در انتظار تأیید" }).first().waitFor();

// fund manager approves with OTP
await fm.reload();
await fm.getByRole("tab", { name: "محاسبه و تأیید حد" }).click();
await fm.getByLabel("یادداشت برای متقاضی (اختیاری)").fill("برای افزایش حد، وثیقه‌ی ملکی پیشنهاد دهید.");
await shot(fm, "34-admin-approval");
await stepUp(fm, FM, () => fm.getByRole("button", { name: "تأیید و صدور حد" }).click());
await fm.locator(".chip", { hasText: "حد اعتباری صادر شد" }).first().waitFor({ timeout: 10000 });

// applicant sees the limit
await ap.goto(`${WEB}/limit`);
await ap.getByText("حد اعتباری با ضمانت چک و سفته").waitFor();
await shot(ap, "35-applicant-limit");
console.log("T4 OK");
await b.close();
