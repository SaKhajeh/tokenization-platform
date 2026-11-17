import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, staff, approvedOrg, addMember, stepUp, Session, uploadDoc, grantCreditLimit } from "./helpers.js";

let t: TestApp;
let co: Session, an: Session, ops: Session;
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09359990001", "compliance_officer");
  an = await staff(t, "09359990002", "analyst");
  ops = await staff(t, "09359990003", "super_admin");
});
afterAll(async () => t.close());

const V = "/api/v1";

/** An application from `a`, submitted and passed through screening (no price list → credit assessment). */
async function screened(a: any, prep: Session, appr: Session, amount: string) {
  const ini = await t.http.post(`${V}/initiatives`).set(prep.auth).set(a.org).set(idem()).send({
    title: "خط تولید حسگرهای صنعتی", description: "راه‌اندازی خط تولید حسگرهای صنعتی؛ فاز اول نصب تجهیزات انجام شده است.",
    sector: "فناوری صنعتی", location: "تهران", started_on: new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10),
    progress_summary: "نصب ۴۰٪ تجهیزات انجام شده و قرارداد فروش منعقد شده است.", evidence_doc_ids: [await uploadDoc(t, prep, a.orgId, "evidence")],
  }).expect(201);
  const app = await t.http.post(`${V}/applications`).set(prep.auth).set(a.org).set(idem()).send({
    initiative_id: ini.body.id, investment_type: "project_finance", requested_amount: amount, min_amount: null,
    proposed_rate: "0.056", proposed_rate_basis: "monthly", proposed_duration_days: 365, proposed_rule: "keep_raised",
    use_of_funds: "خرید تجهیزات باقی‌مانده و سرمایه در گردش.", repayment_source: "قرارداد فروش با مشتری صنعتی.", proposed_guarantees: [], document_ids: [],
  }).expect(201);
  const id = app.body.id as string;
  await t.http.post(`${V}/applications/${id}/request-approval`).set(prep.auth).set(a.org).expect(200);
  const sp = `${V}/applications/${id}/submit`;
  const su = await stepUp(t, appr, "POST", sp, {});
  await t.http.post(sp).set(appr.auth).set({ ...a.org, "x-step-up-token": su }).set(idem()).send({}).expect(200);
  await t.http.post(`${V}/admin/applications/${id}/start-screening`).set(an.auth).expect(200);
  const pass = await t.http.post(`${V}/admin/applications/${id}/screening`).set(an.auth).send({ checklist: [{ item: "کامل", ok: true }], outcome: "pass" }).expect(200);
  expect(pass.body.status).toBe("credit_assessment");
  return id;
}

describe("limit check for applications (plan/07 §9, S-11)", () => {
  it("checks the amount against the remaining limit without holding anything until approval", async () => {
    const a = await approvedOrg(t, 111, { compliance: co });
    await grantCreditLimit(t, a.orgId, a.admin.userId); // limit 200 billion rials at Ra 0.8 × Re 0.7
    const prep = await addMember(t, a.admin, a.orgId, "09124440111", "preparer");
    const appr = await addMember(t, a.admin, a.orgId, "09125550111", "approver");
    const first = await screened(a, prep, appr, "20000000000");
    const second = await screened(a, prep, appr, "210000000000");

    const reason = "ریسک فنی پروژه متوسط؛ بازار فروش تضمین‌شده";
    expect((await t.http.post(`${V}/admin/applications/${first}/limit-check`).set(an.auth).send({ ra: 0.8, re: 0.7 })).status).toBe(400); // reason required
    const c1 = await t.http.post(`${V}/admin/applications/${first}/limit-check`).set(an.auth).send({ ra: 0.8, re: 0.7, reason }).expect(200);
    expect(c1.body).toMatchObject({ fits: true, application_status: "due_diligence", shortfall: "0" });
    expect(Number(c1.body.project_ceiling)).toBeCloseTo(200e9, -3);
    // nothing is held: the limit is untouched
    let lim = (await t.http.get(`${V}/admin/orgs/${a.orgId}/credit-limit`).set(an.auth).expect(200)).body;
    expect(lim.usages).toEqual([]);
    expect(Number(lim.available)).toBeCloseTo(200e9, -3);

    // too large: does not fit, stays in credit assessment
    const c2 = await t.http.post(`${V}/admin/applications/${second}/limit-check`).set(an.auth).send({ ra: 0.8, re: 0.7, reason }).expect(200);
    expect(c2.body).toMatchObject({ fits: false, application_status: "credit_assessment" });
    expect(Number(c2.body.shortfall)).toBeCloseTo(10e9, -3);
    // a riskier view of the same project gives less room
    const c3 = await t.http.post(`${V}/admin/applications/${second}/limit-check`).set(an.auth).send({ ra: 0.5, re: 0.5, reason }).expect(200);
    expect(Number(c3.body.project_ceiling)).toBeLessThan(Number(c2.body.project_ceiling));
    // an existing guarantee with the fund does use the limit
    lim = (await t.http.post(`${V}/admin/orgs/${a.orgId}/limit-usages`).set(an.auth).send({ source_type: "existing_guarantee", description: "ضمانت‌نامه‌ی فعال", amount: "60000000000", ra: 0.8, re: 0.7 }).expect(201)).body;
    const c4 = await t.http.post(`${V}/admin/applications/${second}/limit-check`).set(an.auth).send({ ra: 0.8, re: 0.7, reason }).expect(200);
    expect(Number(c4.body.project_ceiling)).toBeCloseTo(140e9, -3);
    expect((await t.db.query(`select count(*)::int n, bool_and(usage_id is null) none from application_limit_checks where application_id = $1`, [second])).rows[0]).toEqual({ n: 3, none: true });
    // a limit check only in credit assessment
    expect((await t.http.post(`${V}/admin/applications/${first}/limit-check`).set(an.auth).send({ ra: 0.8, re: 0.7, reason })).body.error.code).toBe("WRONG_STATE");
  });

  it("expires limits and closes idle cases every day; an expired limit blocks new applications", async () => {
    const a = await approvedOrg(t, 112, { compliance: co });
    const { caseId, limitId } = await grantCreditLimit(t, a.orgId, a.admin.userId);
    const b = await approvedOrg(t, 113, { compliance: co, financing: true });
    const idle = (await t.http.get(`${V}/case`).set(b.admin.auth).set(b.org).expect(200)).body;
    await t.db.query(`update credit_limits set valid_to = current_date - 1 where id = $1`, [limitId]);
    await t.db.query(`update cases set last_activity_at = now() - interval '91 days' where id = $1`, [idle.id]);
    const r = await t.http.post(`${V}/admin/jobs/case-housekeeping/run`).set(ops.auth).expect(200);
    expect(r.body).toEqual({ limits_expired: 1, cases_closed: 1 });
    expect((await t.db.query(`select state from cases where id = $1`, [caseId])).rows[0].state).toBe("expired");
    expect((await t.http.get(`${V}/case`).set(b.admin.auth).set(b.org).expect(200)).body.state).toBe("closed_inactive");
    expect((await t.http.post(`${V}/admin/jobs/case-housekeeping/run`).set(ops.auth).expect(200)).body).toEqual({ limits_expired: 0, cases_closed: 0 });
    const n = (await t.db.query(`select event_key from notifications where org_id = $1`, [a.orgId])).rows.map((x: any) => x.event_key);
    expect(n).toContain("case.limit_expired");
    // new applications need a valid limit
    const ini = await t.http.post(`${V}/initiatives`).set(a.admin.auth).set(a.org).set(idem()).send({
      title: "طرح آزمایشی", description: "شرح کافی برای طرح آزمایشی جهت بررسی محدودیت حد اعتباری.", sector: "فناوری", location: "تهران",
      started_on: "2026-01-01", progress_summary: "در حال اجرا با پیشرفت مناسب و قرارداد فروش.", evidence_doc_ids: [await uploadDoc(t, a.admin, a.orgId, "evidence")],
    }).expect(201);
    const app = await t.http.post(`${V}/applications`).set(a.admin.auth).set(a.org).set(idem()).send({
      initiative_id: ini.body.id, investment_type: "project_finance", requested_amount: "1000000000", min_amount: null, proposed_rate: "0.23",
      proposed_duration_days: 365, proposed_rule: "keep_raised", use_of_funds: "خرید تجهیزات و سرمایه در گردش.", repayment_source: "فروش محصولات.", proposed_guarantees: [], document_ids: [],
    }).expect(201);
    expect((await t.http.post(`${V}/applications/${app.body.id}/request-approval`).set(a.admin.auth).set(a.org)).body.error.code).toBe("CREDIT_LIMIT_REQUIRED");
  });
});
