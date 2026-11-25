import { ADMIN, WEB, browser, page, login, shot, stepUp, DIR } from "./lib.mjs";
import { readFileSync } from "node:fs";
const { M } = JSON.parse(readFileSync(`${DIR}/run.json`, "utf8"));
const CM = "09350000004", FM = "09350000002";
const b = await browser();

// credit manager: assigns the case to an analyst from the workspace
const cm = await page(b, { width: 1440, height: 900 });
await login(cm, ADMIN, CM);
await cm.goto(`${ADMIN}/cases`);
await cm.getByRole("tab", { name: /پایان‌یافته/ }).click();
await cm.locator("tbody tr a").first().click();
const sel = cm.getByLabel("کارشناس مسئول پرونده");
await sel.waitFor();
await sel.selectOption({ index: 1 });
await cm.waitForTimeout(800);
await shot(cm, "50-cm-assign");
const caseUrl = cm.url();

// fund manager: fee exemption (overview) and limit adjustment (scoring tab)
const fm = await page(b, { width: 1440, height: 900 });
await login(fm, ADMIN, FM);
await fm.goto(caseUrl);
await fm.getByLabel("دلیل").first().fill("ارزیابی رایگان برای شرکت‌های پارک فناوری");
await fm.getByLabel("کارمزد").selectOption("after_screening");
await stepUp(fm, FM, () => fm.getByRole("button", { name: "رایگان کردن برای این شرکت" }).click());
await fm.getByText("کارمزد درخواست تأمین مالی —").waitFor();
await fm.getByRole("tab", { name: "محاسبه و تأیید حد" }).click();
await fm.getByText("تغییر حد اعتباری (مدیر صندوق)").waitFor();
await fm.getByLabel("RA", { exact: true }).fill("0.6");
await fm.getByLabel("وثیقه‌ی مبنای حد").selectOption("mortgage_1");
await fm.getByLabel("دلیل تغییر").fill("سند ملکی درجه یک ارائه شد");
await fm.getByText("حد جدید:").first().waitFor();
await shot(fm, "51-fm-adjust-preview");
await stepUp(fm, FM, () => fm.getByRole("button", { name: "ثبت تغییر با رمز یکبارمصرف" }).click());
await fm.getByText("آخرین تغییر").waitFor({ timeout: 10000 });
await shot(fm, "52-fm-adjusted");

// applicant sees the new limit
const ap = await page(b, { width: 390, height: 844 });
await login(ap, WEB, M);
await ap.goto(`${WEB}/limit`);
await ap.getByText("حد اعتباری با وثیقه‌ی ملکی درجه ۱ (بازنگری‌شده)").waitFor();
await shot(ap, "53-applicant-new-limit");
console.log("T6 OK");
await b.close();
