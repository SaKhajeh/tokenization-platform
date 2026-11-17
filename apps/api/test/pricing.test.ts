import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, staff, approvedOrg, addMember, stepUp, Session, verifiedAccount, grantCreditLimit } from "./helpers.js";

let t: TestApp;
let co: Session; // compliance officer
let an: Session; // analyst
let fm: Session; // fund manager
let fin: Session; // finance officer
let ops: Session; // super admin + tokenisation officer
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09354440001", "compliance_officer");
  an = await staff(t, "09354440002", "analyst");
  fm = await staff(t, "09354440003", "fund_manager");
  fin = await staff(t, "09354440004", "finance_officer", "auditor");
  ops = await staff(t, "09354440005", "super_admin", "tokenisation_officer");
});
afterAll(async () => t.close());

const V = "/api/v1";
const SERVICES = [
  ["credit_scoring", "اعتبارسنجی", "80000000", 10000],
  ["due_diligence", "بررسی دقیق (DD)", "90000000", 10000],
  ["guarantee_review", "کارشناسی و استعلام تضامین", "30000000", 7000],
] as const; // 20,000,000 toman in total

async function asFm(method: "put" | "post", path: string, body: unknown, s = fm) {
  const su = await stepUp(t, s, method.toUpperCase(), `${V}${path}`, body);
  return t.http[method](`${V}${path}`).set(s.auth).set({ "x-step-up-token": su }).send(body as object);
}

async function doc(s: Session, orgId: string, category = "financial_statement") {
  const o = { "x-org-id": orgId };
  const up = await t.http.post(`${V}/documents/upload-url`).set(s.auth).set(o).set(idem()).send({ category, filename: "f.pdf", mime: "application/pdf", size: 1000 }).expect(201);
  t.storage.put(`orgs/${orgId}/${up.body.document_id}`, 1000);
  await t.http.post(`${V}/documents/${up.body.document_id}/complete`).set(s.auth).set(o).send({ sha256: "e".repeat(64) }).expect(200);
  return up.body.document_id as string;
}

/** Company with a credit limit and a submitted, screening-passed application. Returns ids and the members. */
async function screenedApplication(n: number) {
  const a = await approvedOrg(t, n, { compliance: co });
  await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200);
  await grantCreditLimit(t, a.orgId, a.admin.userId);

  const prep = await addMember(t, a.admin, a.orgId, `0912444${String(n).padStart(4, "0")}`, "preparer");
  const appr = await addMember(t, a.admin, a.orgId, `0912555${String(n).padStart(4, "0")}`, "approver");
  const ini = await t.http.post(`${V}/initiatives`).set(prep.auth).set(a.org).set(idem()).send({
    title: "خط تولید حسگرهای صنعتی هوشمند", description: "راه‌اندازی خط تولید حسگرهای صنعتی؛ فاز اول نصب تجهیزات انجام شده است.",
    sector: "فناوری صنعتی", location: "تهران", started_on: new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10),
    progress_summary: "نصب ۴۰٪ تجهیزات انجام شده و قرارداد فروش منعقد شده است.", evidence_doc_ids: [await doc(prep, a.orgId, "evidence")],
  }).expect(201);
  const app = await t.http.post(`${V}/applications`).set(prep.auth).set(a.org).set(idem()).send({
    initiative_id: ini.body.id, investment_type: "project_finance", requested_amount: "20000000000", min_amount: "10000000000",
    proposed_rate: "0.056", proposed_rate_basis: "monthly", proposed_duration_days: 365, proposed_rule: "keep_raised",
    use_of_funds: "خرید تجهیزات باقی‌مانده و سرمایه در گردش.", repayment_source: "قرارداد فروش با مشتری صنعتی.",
    proposed_guarantees: [], document_ids: [],
  }).expect(201);
  const id = app.body.id as string;
  expect(app.body).toMatchObject({ proposed_rate: "0.056000", proposed_rate_basis: "monthly" });
  await t.http.post(`${V}/applications/${id}/request-approval`).set(prep.auth).set(a.org).expect(200);
  const sp = `${V}/applications/${id}/submit`;
  const su2 = await stepUp(t, appr, "POST", sp, {});
  await t.http.post(sp).set(appr.auth).set({ ...a.org, "x-step-up-token": su2 }).set(idem()).send({}).expect(200);
  await t.http.post(`${V}/admin/applications/${id}/start-screening`).set(an.auth).expect(200);
  const pass = await t.http.post(`${V}/admin/applications/${id}/screening`).set(an.auth).send({ checklist: [{ item: "کامل", ok: true }], outcome: "pass" }).expect(200);
  return { ...a, prep, appr, id, status: pass.body.status as string };
}

const invoiceFor = async (appId: string) => (await t.db.query(`select * from invoices where linked_id = $1 order by issued_at desc limit 1`, [appId])).rows[0];

describe("fund pricing settings (D25, D26)", () => {
  it("without a price list, screening goes straight to credit assessment", async () => {
    const a = await screenedApplication(71);
    expect(a.status).toBe("credit_assessment");
    expect(await invoiceFor(a.id)).toBeUndefined();
  });

  it("only the fund manager edits prices and rates, always with step-up, and every version is kept", async () => {
    const body = { title: "اعتبارسنجی", amount: "80000000", fund_share_bps: 10000, charge_point: "after_screening" };
    expect((await t.http.put(`${V}/admin/pricing/services/credit_scoring`).set(an.auth).send(body)).status).toBe(403);
    expect((await t.http.put(`${V}/admin/pricing/services/credit_scoring`).set(fm.auth).send(body)).body.error.code).toBe("STEP_UP_REQUIRED");
    for (const [code, title, amount, share] of SERVICES) {
      const r = await asFm("put", `/admin/pricing/services/${code}`, { title, amount, fund_share_bps: share, charge_point: "after_screening" });
      expect(r.status).toBe(200);
    }
    // price change → version 2; version 1 kept, retired
    const v2 = await asFm("put", `/admin/pricing/services/credit_scoring`, { title: "اعتبارسنجی", amount: "80000000", fund_share_bps: 10000, charge_point: "after_screening", description: "شامل استعلام بانکی" });
    expect(v2.body.version).toBe(2);
    const all = await t.http.get(`${V}/admin/pricing/services?include_retired=true`).set(fin.auth).expect(200);
    expect(all.body.filter((s: any) => s.code === "credit_scoring").map((s: any) => [s.version, s.active])).toEqual([[2, true], [1, false]]);
    const audit = await t.db.query(`select action from audit_log where action like 'pricing.%'`);
    expect(audit.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(["pricing.service_created", "pricing.service_updated"]));

    // rate policy: investor rate must stay below the applicant rate by the minimum spread
    const bad = await asFm("put", `/admin/pricing/policy`, { rate_basis: "monthly", default_applicant_rate: "0.04", default_investor_rate: "0.045", waterfall_order: "fund_first", vat_bps: 0 });
    expect(bad.body.error.code).toBe("SPREAD_TOO_SMALL");
    const tight = await asFm("put", `/admin/pricing/policy`, { rate_basis: "monthly", default_applicant_rate: "0.056", default_investor_rate: "0.05", min_spread: "0.01", waterfall_order: "fund_first", vat_bps: 0 });
    expect(tight.body.error.code).toBe("SPREAD_TOO_SMALL");
    const ok = await asFm("put", `/admin/pricing/policy`, { rate_basis: "monthly", default_applicant_rate: "0.056", default_investor_rate: "0.04", min_spread: "0.01", waterfall_order: "fund_first", vat_bps: 0, note: "سیاست پایلوت" });
    expect(ok.body).toMatchObject({ version: 1, rate_basis: "monthly", waterfall_order: "fund_first" });
  });

  it("quotes the applicant's due, the investors' payout and the fund's spread", async () => {
    // 2 billion toman, 12 months from 1405/10/01 (2025-12-22)
    const q = await t.http.post(`${V}/admin/pricing/quote`).set(an.auth).send({ amount: "20000000000", issue_date: "2025-12-22", months: 12 }).expect(200);
    expect(q.body.maturity_date).toBe("2026-12-22");
    expect(q.body.per_unit).toMatchObject({ applicantReturnPerUnit: "6720000", investorReturnPerUnit: "4800000", spreadPerUnit: "1920000" });
    expect(q.body.totals).toMatchObject({ applicantDue: "33440000000", investorsDue: "29600000000", fundSpread: "3840000000", spreadBps: 1920 });
    const notMultiple = await t.http.post(`${V}/admin/pricing/quote`).set(an.auth).send({ amount: "20000000001", issue_date: "2025-12-22", months: 12 });
    expect(notMultiple.body.error.code).toBe("AMOUNT_NOT_MULTIPLE");
  });

  it("applicants see the price list before applying, without the internal split", async () => {
    const a = await approvedOrg(t, 72, { compliance: co });
    const r = await t.http.get(`${V}/pricing/services`).set(a.admin.auth).set(a.org).expect(200);
    expect(r.body.services.map((s: any) => s.amount)).toEqual(["80000000", "90000000", "30000000"]);
    expect(r.body.services[0].fund_share_bps).toBeUndefined();
  });
});

describe("assessment invoice (D25)", () => {
  it("screening pass issues the invoice; assessment starts only after the applicant pays", async () => {
    const a = await screenedApplication(73);
    expect(a.status).toBe("awaiting_payment");
    const inv = (await t.http.get(`${V}/admin/invoices/${(await invoiceFor(a.id)).id}`).set(fin.auth).expect(200)).body;
    expect(inv).toMatchObject({ status: "issued", subtotal: "200000000", total: "200000000", fund_share: "191000000", platform_share: "9000000", policy_version: 1 });
    expect(inv.invoice_no).toMatch(/^INV-14\d\d-\d{5}$/);

    // the applicant sees the invoice with its lines, and was told how much to pay
    const mine = await t.http.get(`${V}/invoices/${inv.id}`).set(a.admin.auth).set(a.org).expect(200);
    expect(mine.body.lines.map((l: any) => l.code)).toEqual(["credit_scoring", "due_diligence", "guarantee_review"]);
    expect(mine.body.fund_share).toBeUndefined();
    const n = await t.http.get(`${V}/notifications`).set(a.admin.auth).expect(200);
    const note = n.body.items.find((x: any) => x.event_key === "application.payment_required");
    expect(note.body).toContain("۲۰٬۰۰۰٬۰۰۰ تومان");

    // no analyst task until it is paid; preparers cannot pay
    const tasks = await t.http.get(`${V}/admin/tasks`).set(an.auth).expect(200);
    expect(tasks.body.some((x: any) => x.linked_id === a.id && x.workflow_key === "application.credit")).toBe(false);
    const path = `${V}/invoices/${inv.id}/pay`;
    expect((await t.http.post(path).set(a.prep.auth).set(a.org).set(idem()).send({})).status).toBe(403);

    // not enough balance yet
    const su = await stepUp(t, a.appr, "POST", path, {});
    const poor = await t.http.post(path).set(a.appr.auth).set({ ...a.org, "x-step-up-token": su }).set(idem()).send({});
    expect(poor.body.error.code).toBe("INSUFFICIENT_BALANCE");

    // top up with the payment ID from a verified account, then pay
    const { iban } = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000073");
    const ins = await t.http.get(`${V}/deposit-instructions`).set(a.admin.auth).set(a.org).expect(200);
    t.cobank.deposit({ payId: ins.body.payment_id, amount: 250_000_000n, sourceIban: iban });
    await t.http.post(`${V}/admin/deposits/poll`).set(fin.auth).expect(200);
    const su3 = await stepUp(t, a.appr, "POST", path, {});
    const paid = await t.http.post(path).set(a.appr.auth).set({ ...a.org, "x-step-up-token": su3 }).set(idem()).send({}).expect(200);
    expect(paid.body.status).toBe("paid");

    const app = await t.http.get(`${V}/applications/${a.id}`).set(a.admin.auth).set(a.org).expect(200);
    expect(app.body.status).toBe("credit_assessment");
    expect(app.body.events.map((e: any) => e.to_status).slice(-2)).toEqual(["awaiting_payment", "credit_assessment"]);
    const tasks2 = await t.http.get(`${V}/admin/tasks`).set(an.auth).expect(200);
    expect(tasks2.body.some((x: any) => x.linked_id === a.id && x.workflow_key === "application.credit")).toBe(true);

    // ledger: 250m in, 200m to revenue (191m fund / 9m platform), 50m left available; books balance
    const bal = await t.http.get(`${V}/balances`).set(a.admin.auth).set(a.org).expect(200);
    expect(bal.body.available).toBe("50000000");
    const tb = await t.http.get(`${V}/admin/ledger/trial-balance`).set(fin.auth).expect(200);
    expect(tb.body.balanced).toBe(true);
    const rev = (k: string) => tb.body.accounts.find((x: any) => x.kind === k)?.balance;
    expect(rev("fund_revenue_services")).toBe("191000000");
    expect(rev("platform_revenue_services")).toBe("9000000");

    // paying twice is refused
    const su4 = await stepUp(t, a.appr, "POST", path, {});
    expect((await t.http.post(path).set(a.appr.auth).set({ ...a.org, "x-step-up-token": su4 }).set(idem()).send({})).body.error.code).toBe("INVOICE_NOT_OPEN");
  });

  it("the fund manager can waive an invoice with a reason; withdrawing cancels an open one", async () => {
    const a = await screenedApplication(74);
    const inv = await invoiceFor(a.id);
    expect((await t.http.post(`${V}/admin/invoices/${inv.id}/waive`).set(fin.auth).send({ reason: "طرح راهبردی صندوق" })).status).toBe(403);
    const w = await asFm("post", `/admin/invoices/${inv.id}/waive`, { reason: "طرح راهبردی صندوق؛ مصوبه‌ی هیئت‌مدیره" });
    expect(w.body.status).toBe("waived");
    const app = await t.http.get(`${V}/applications/${a.id}`).set(a.admin.auth).set(a.org).expect(200);
    expect(app.body.status).toBe("credit_assessment");

    const b = await screenedApplication(75);
    expect(b.status).toBe("awaiting_payment");
    await t.http.post(`${V}/applications/${b.id}/withdraw`).set(b.admin.auth).set(b.org).send({ reason: "منصرف شدیم" }).expect(200);
    expect((await invoiceFor(b.id)).status).toBe("cancelled");
  });
});
