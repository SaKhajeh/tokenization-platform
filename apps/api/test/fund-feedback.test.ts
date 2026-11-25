/**
 * Fund feedback, 2026-11-25 (master plan §6 item 25): balance-sheet latest year, credit manager (assignment and limit
 * approval), the fund manager's limit adjustment, fee exemptions, checklist templates, a letter instead of a tax
 * return, and the visit instructions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, TestApp, staff, approvedOrg, uploadDoc, idem, Session } from "./helpers.js";
import { prepareCase, submitCase, acceptAll, su, year, BOARD_NC } from "./case-flow.js";

let t: TestApp;
let co: Session, an: Session, an2: Session, cm: Session, fm: Session, tech: Session;
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09357770001", "compliance_officer");
  an = await staff(t, "09357770002", "analyst");
  an2 = await staff(t, "09357770003", "analyst");
  cm = await staff(t, "09357770004", "credit_manager");
  fm = await staff(t, "09357770005", "fund_manager");
  tech = await staff(t, "09357770006", "technical_expert");
});
afterAll(async () => t.close());
const V = "/api/v1";
const tomorrow = () => new Date(Date.now() + 3.5 * 3600_000 + 86400_000).toISOString().slice(0, 10);

/** A prepared, submitted, reviewed case with the visit done and originals received, ready to score. */
async function readyToScore(n: number, latestType: "audited" | "balance_sheet") {
  const a = await approvedOrg(t, n, { compliance: co, financing: true, extraPeople: [{ nationalCode: BOARD_NC, name: "رضا کریمی", roles: ["board"] }] });
  const { caseId, y0 } = await prepareCase(t, a);
  if (latestType === "balance_sheet") {
    await t.http.put(`${V}/case/financials/${y0}`).set(a.admin.auth).set(a.org).send({ statement_type: "balance_sheet", figures: year(310000) }).expect(200);
  }
  await submitCase(t, a);
  await acceptAll(t, an, caseId);
  await t.http.post(`${V}/admin/cases/${caseId}/financials/lock`).set(an.auth).expect(200);
  await t.http.post(`${V}/admin/cases/${caseId}/visit`).set(an.auth).send({ visit_date: tomorrow(), visit_time: "10:00", visitor_id: tech.userId }).expect(201);
  await t.http.post(`${V}/case/visit/confirm`).set(a.admin.auth).set(a.org).expect(200);
  await t.http.post(`${V}/admin/cases/${caseId}/visit/report`).set(tech.auth).send({ findings: "خط تولید فعال، ۳۰ نفر نیرو." }).expect(200);
  const fc = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
  for (const i of fc.items.filter((x: any) => x.original_required && x.state === "accepted")) await t.http.post(`${V}/admin/cases/${caseId}/items/${i.id}/original-received`).set(tech.auth).expect(200);
  return { a, caseId, y0 };
}
const scoreBody = { activity_type: "production_line", guarantee: { rc: 0.9, ra: 0.8, re: 0.7 }, reasons: { rc: "سابقه‌ی پرداخت منظم", ra: "خط تولید فعال", re: "بازار پایدار" } };

describe("fund feedback 2026-11-25", () => {
  it("the visit proposal tells the company who comes and who must be present", async () => {
    const a = await approvedOrg(t, 401, { compliance: co, financing: true });
    const { caseId } = await prepareCase(t, a);
    await submitCase(t, a);
    await acceptAll(t, an, caseId);
    await t.http.post(`${V}/admin/cases/${caseId}/visit`).set(an.auth).send({ visit_date: tomorrow(), visit_time: "10:00", visitor_id: tech.userId }).expect(201);
    const note = (await t.http.get(`${V}/notifications`).set(a.admin.auth).expect(200)).body.items.find((x: any) => x.title === "زمان بازدید پیشنهاد شد");
    expect(note.body).toContain("دو نفر ارزیاب");
    expect(note.body).toContain("حضور مدیرعامل");
    expect(note.body).not.toMatch(/\d{4}-\d{2}-\d{2}/); // the date is Jalali
  });

  it("with a balance-sheet-only latest year, scoring uses the three years before it", async () => {
    const full = await readyToScore(402, "audited");
    const bs = await readyToScore(403, "balance_sheet");
    const g1 = (await t.http.post(`${V}/admin/cases/${full.caseId}/scoring`).set(an.auth).send(scoreBody).expect(200)).body.result.avg_growth;
    const g2 = (await t.http.post(`${V}/admin/cases/${bs.caseId}/scoring`).set(an.auth).send(scoreBody).expect(200)).body.result.avg_growth;
    // sales: Y0 310,000 · Y1 205,000 · Y2 138,000 · Y3 90,000
    expect(g1).toBeCloseTo(((310000 - 205000) / 205000 + (205000 - 138000) / 138000) / 2, 6);
    expect(g2).toBeCloseTo(((205000 - 138000) / 138000 + (138000 - 90000) / 90000) / 2, 6);
  });

  it("the credit manager assigns cases and approves limits (never their own); the fund manager adjusts the limit", async () => {
    const { a, caseId } = await readyToScore(404, "audited");
    // assignment: only the credit manager, only to an analyst
    expect((await t.http.post(`${V}/admin/cases/${caseId}/assign`).set(an.auth).send({ analyst_id: an2.userId })).status).toBe(403);
    expect((await t.http.post(`${V}/admin/cases/${caseId}/assign`).set(cm.auth).send({ analyst_id: tech.userId })).body.error.code).toBe("NOT_AN_ANALYST");
    await t.http.post(`${V}/admin/cases/${caseId}/assign`).set(cm.auth).send({ analyst_id: an2.userId }).expect(200);
    expect((await t.http.get(`${V}/admin/cases/${caseId}`).set(cm.auth).expect(200)).body.assigned_analyst).toBe(an2.userId);

    // the credit manager can work as an analyst, but cannot approve a round they prepared
    await t.http.post(`${V}/admin/cases/${caseId}/scoring`).set(cm.auth).send(scoreBody).expect(200);
    await t.http.post(`${V}/admin/cases/${caseId}/scoring/submit`).set(cm.auth).send({ summary: "پیشنهاد حد با چک و سفته." }).expect(200);
    const ok = { decision: "approve" };
    expect((await t.http.post(`${V}/admin/cases/${caseId}/decision`).set(cm.auth).set(await su(t, cm, "POST", `/admin/cases/${caseId}/decision`, ok, {})).send(ok)).body.error.code).toBe("SELF_APPROVAL");
    // …so the analyst prepares it and the credit manager approves
    await t.db.query(`update assessment_rounds set prepared_by = $2 where case_id = $1`, [caseId, an2.userId]);
    await t.http.post(`${V}/admin/cases/${caseId}/decision`).set(cm.auth).set(await su(t, cm, "POST", `/admin/cases/${caseId}/decision`, ok, {})).send(ok).expect(200);
    const before = (await t.http.get(`${V}/case/limit`).set(a.admin.auth).set(a.org).expect(200)).body.limit;

    // the fund manager lowers Ra and takes a first-degree mortgage instead of cheques
    const adj = { ra: 0.6, collateral: "mortgage_1", reason: "سند ملکی درجه یک ارائه شد؛ توان اجرایی محتاطانه‌تر دیده شد." };
    expect((await t.http.post(`${V}/admin/orgs/${a.orgId}/credit-limit/adjust`).set(cm.auth).send(adj)).status).toBe(403);
    const rr = await t.http.post(`${V}/admin/orgs/${a.orgId}/credit-limit/adjust`).set(fm.auth).set(await su(t, fm, "POST", `/admin/orgs/${a.orgId}/credit-limit/adjust`, adj, {})).send(adj);
    expect(rr.status).toBe(201);
    const r = rr.body;
    expect(r.previous_limit).toBe(before.limit);
    expect(r).toMatchObject({ collateral: "mortgage_1", judgement: { rc: 0.9, ra: 0.6, re: 0.7 } });
    // mortgage_1 coefficient 1.0 vs cheque 0.4, Ra 0.8 → 0.6: limit × (1.0 / 0.4) × (0.6 / 0.8)
    expect(Number(r.limit)).toBeCloseTo(Number(before.limit) * 2.5 * 0.75, -3);
    const after = (await t.http.get(`${V}/case/limit`).set(a.admin.auth).set(a.org).expect(200)).body.limit;
    expect(after.limit).toBe(r.limit);
    expect(after.valid_to).toBe(before.valid_to);
    // nothing used yet: everything is available, on the new collateral basis too
    expect(after.available).toBe(after.limit);
    expect(after.collateral).toBe("mortgage_1");
    const rows = (await t.db.query(`select status from credit_limits where org_id = $1 order by created_at`, [a.orgId])).rows.map((x: any) => x.status);
    expect(rows).toEqual(["superseded", "active"]);
    expect((await t.http.get(`${V}/notifications`).set(a.admin.auth).expect(200)).body.items.some((x: any) => x.title === "حد اعتباری شما به‌روز شد")).toBe(true);
  });

  it("the fund manager exempts a company from the assessment fee in advance; unpaid invoices are waived", async () => {
    const tariff = { effective_from: "2026-01-01", assessment_fee_tehran: "200000000", assessment_fee_outside: "150000000", application_fee: "0", servicing_fee_bps: 0, investor_fee_bps: 0, platform_share_bps: 1000 };
    await t.http.put(`${V}/admin/tariffs`).set(fm.auth).set(await su(t, fm, "PUT", "/admin/tariffs", tariff, {})).send(tariff).expect(200);
    const a = await approvedOrg(t, 405, { compliance: co, financing: true, extraPeople: [{ nationalCode: BOARD_NC, name: "رضا کریمی", roles: ["board"] }] });
    await prepareCase(t, a);
    const inv = (await t.http.post(`${V}/case/fee`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(inv.status).toBe("issued");
    const ex = { charge_point: "case_submission", reason: "شرکت هم‌گروه صندوق؛ ارزیابی رایگان." };
    expect((await t.http.post(`${V}/admin/orgs/${a.orgId}/fee-exemptions`).set(an.auth).send(ex)).status).toBe(403);
    const g = (await t.http.post(`${V}/admin/orgs/${a.orgId}/fee-exemptions`).set(fm.auth).set(await su(t, fm, "POST", `/admin/orgs/${a.orgId}/fee-exemptions`, ex, {})).send(ex).expect(201)).body;
    expect(g.waived_invoices).toEqual([inv.invoice_id]);
    const c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(c.blockers.map((b: any) => b.code)).not.toContain("assessment_fee_unpaid");
    expect((await t.http.post(`${V}/admin/orgs/${a.orgId}/fee-exemptions`).set(fm.auth).set(await su(t, fm, "POST", `/admin/orgs/${a.orgId}/fee-exemptions`, ex, {})).send(ex)).body.error.code).toBe("EXEMPTION_EXISTS");
    expect((await t.http.get(`${V}/admin/orgs/${a.orgId}/fee-exemptions`).set(an.auth).expect(200)).body).toHaveLength(1);
    await t.http.delete(`${V}/admin/orgs/${a.orgId}/fee-exemptions/${g.id}`).set(fm.auth).expect(200);
  });

  it("staff upload the lease template; applicants download it; a letter can replace a tax return, not other documents", async () => {
    // template for 2-4 (lease)
    const body = Buffer.from("%PDF-1.4 lease template");
    const up = (await t.http.post(`${V}/admin/checklist-templates/2-4/upload-url`).set(fm.auth).send({ filename: "lease.pdf", mime: "application/pdf", size: body.length }).expect(201)).body;
    (t.storage as any).put(up.upload_url.replace("memory://upload/", ""), body.length);
    const sha = createHash("sha256").update(body).digest("hex");
    await t.http.post(`${V}/admin/checklist-templates/2-4/complete`).set(fm.auth).send({ document_id: up.document_id, sha256: sha }).expect(200);
    expect((await t.http.post(`${V}/admin/checklist-templates/3-1/upload-url`).set(fm.auth).send({ filename: "x.pdf", mime: "application/pdf", size: 10 })).body.error.code).toBe("NO_TEMPLATE_FOR_ITEM");
    const a = await approvedOrg(t, 406, { compliance: co, financing: true });
    const list = (await t.http.get(`${V}/case/templates`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ code: "2-4", filename: "lease.pdf", url: expect.any(String) })]);

    // tax return slot: a letter with a reason; not allowed on other items
    const c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    const tax = c.items.find((i: any) => i.code === "3-5");
    const other = c.items.find((i: any) => i.code === "3-4");
    const doc = await uploadDoc(t, a.admin, a.orgId);
    expect((await t.http.post(`${V}/case/items/${other.id}/files`).set(a.admin.auth).set(a.org).set(idem()).send({ document_id: doc, alt_reason: "inactive" })).body.error.code).toBe("ALT_LETTER_NOT_ALLOWED");
    await t.http.post(`${V}/case/items/${tax.id}/files`).set(a.admin.auth).set(a.org).set(idem()).send({ document_id: doc, alt_reason: "newly_established" }).expect(201);
    const after = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body.items.find((i: any) => i.id === tax.id);
    expect(after.state).toBe("uploaded");
    expect(after.files[0].alt_reason).toBe("newly_established");
  });
});
