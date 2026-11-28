import { ADMIN, browser, page, login, shot, DIR } from "./lib.mjs";
import { readFileSync } from "node:fs";
const { R } = JSON.parse(readFileSync(`${DIR}/run.json`, "utf8"));
const b = await browser();
const p = await page(b);
await login(p, ADMIN, "09350000003"); // compliance officer
await shot(p, "10-admin-dashboard");
await p.getByRole("link", { name: "احراز هویت سازمان‌ها" }).click();
await p.getByRole("link", { name: "شرکت فناوران حسگر" }).first().click();
await p.getByText("اظهار متقاضی").waitFor();
await shot(p, "11-admin-kyb-review");
await p.getByRole("button", { name: "تأیید و صدور شناسه‌ی دیجیتال" }).click();
await p.getByText("تصمیم").first().waitFor();
await p.locator(".chip", { hasText: "تأیید شده" }).first().waitFor({ timeout: 10000 });
await shot(p, "12-admin-kyb-approved");
console.log("T2 OK");
await b.close();
