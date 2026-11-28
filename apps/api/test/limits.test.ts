import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addJalaliMonths, scoreCase, toFinancialYear, toRials, DEFAULT_SCORING_METHOD, SCORING_METHOD_V2_CHANGES } from "@tp/domain";
import { makeApp, TestApp, staff, approvedOrg, Session } from "./helpers.js";
import { prepareCase, submitCase, acceptAll, su, year, BOARD_NC } from "./case-flow.js";

let t: TestApp;
let co: Session, an: Session, anfm: Session, fm: Session, tech: Session, ops: Session;
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09358880001", "compliance_officer");
  an = await staff(t, "09358880002", "analyst");
  anfm = await staff(t, "09358880003", "analyst", "fund_manager");
  fm = await staff(t, "09358880004", "fund_manager");
  tech = await staff(t, "09358880005", "technical_expert");
  ops = await staff(t, "09358880006", "super_admin");
});
afterAll(async () => t.close());

const V = "/api/v1";

describe("credit case part 4a: tariff, visit, scoring, approval, credit limit", () => {
  it("runs from fee to an approved credit limit with its usage ledger", async () => {
    // ---- tariff (fund manager, step-up, versioned)
    const tariff = { effective_from: "2026-01-01", assessment_fee_tehran: "200000000", assessment_fee_outside: "150000000", application_fee: "0", servicing_fee_bps: 0, investor_fee_bps: 0, platform_share_bps: 1000 };
    expect((await t.http.put(`${V}/admin/tariffs`).set(an.auth).send(tariff)).status).toBe(403);
    const tok = await su(t, fm, "PUT", "/admin/tariffs", tariff, {});
    const tv = await t.http.put(`${V}/admin/tariffs`).set(fm.auth).set(tok).send(tariff).expect(200);
    expect(tv.body).toMatchObject({ version: 1, assessment_fee_outside: "150000000" });

    // ---- prepared case; the factory is outside Tehran → 15,000,000 toman, unpaid blocks submission
    const a = await approvedOrg(t, 101, { compliance: co, financing: true, extraPeople: [{ nationalCode: BOARD_NC, name: "رضا کریمی", roles: ["board"] }] });
    const { caseId, y0 } = await prepareCase(t, a, { province: "البرز" });
    const blocked = await submitCase(t, a);
    expect(blocked.body.error.details.blockers).toEqual([{ code: "assessment_fee_unpaid", amount: "150000000", region: "outside", invoice_id: null }]);
    const inv = await t.http.post(`${V}/case/fee`).set(a.admin.auth).set(a.org).expect(200);
    expect(inv.body).toMatchObject({ status: "issued", total: "150000000", region: "outside" });
    expect((await t.http.post(`${V}/case/fee`).set(a.admin.auth).set(a.org).expect(200)).body.invoice_id).toBe(inv.body.invoice_id); // same invoice
    const full = (await t.http.get(`${V}/admin/invoices/${inv.body.invoice_id}`).set(fm.auth).expect(200)).body;
    expect(full).toMatchObject({ linked_type: "case", fund_share: "135000000", platform_share: "15000000", policy_version: 1 }); // the tariff version it was charged under
    // the fund manager waives it here (paying from the balance is covered by the invoice tests)
    await t.http.post(`${V}/admin/invoices/${inv.body.invoice_id}/waive`).set(fm.auth).set(await su(t, fm, "POST", `/admin/invoices/${inv.body.invoice_id}/waive`, { reason: "پایلوت صندوق" }, {})).send({ reason: "پایلوت صندوق" }).expect(200);
    expect((await submitCase(t, a)).status).toBe(200);
    await acceptAll(t, an, caseId);

    // ---- staff directory for the visitor picker: staff only, filtered by role, mobiles masked
    const dir = (await t.http.get(`${V}/admin/staff?role=technical_expert`).set(an.auth).expect(200)).body;
    expect(dir.map((x: any) => x.id)).toEqual([tech.userId]);
    expect(dir[0]).toMatchObject({ roles: ["technical_expert"], mobile: "0935***0005" });
    expect((await t.http.get(`${V}/admin/staff`).set(a.admin.auth)).status).toBe(403);

    // ---- scoring needs the visit, the originals and locked figures
    const scoreBody = {
      activity_type: "production_line", guarantee: { rc: 0.9, ra: 0.8, re: 0.7 },
      reasons: { rc: "سابقه‌ی پرداخت منظم و بدون چک برگشتی", ra: "خط تولید فعال و تیم فنی باتجربه", re: "بازار فولاد پایدار، ریسک ارزی متوسط" },
    };
    const notReady = await t.http.post(`${V}/admin/cases/${caseId}/scoring`).set(anfm.auth).send(scoreBody);
    expect(notReady.body.error.code).toBe("SCORING_NOT_READY");
    expect(notReady.body.error.details.missing.slice(0, 2)).toEqual(["financials_not_locked", "visit_not_done"]);
    expect(notReady.body.error.details.missing.filter((m: string) => m.startsWith("original_not_received")).length).toBe(3); // 1-2 × 3 (the signature certificate is gone)
    await t.http.post(`${V}/admin/cases/${caseId}/financials/lock`).set(an.auth).expect(200);

    // ---- visit: propose → applicant asks for another date (ticket) → new proposal → confirm → reminder → report
    const tomorrow = new Date(Date.now() + 3.5 * 3600_000 + 86400_000).toISOString().slice(0, 10);
    expect((await t.http.post(`${V}/admin/cases/${caseId}/visit`).set(an.auth).send({ visit_date: "2020-01-01", visit_time: "10:00", visitor_id: tech.userId })).body.error.code).toBe("VISIT_DATE_PAST");
    expect((await t.http.post(`${V}/admin/cases/${caseId}/visit`).set(an.auth).send({ visit_date: tomorrow, visit_time: "10:00", visitor_id: a.admin.userId })).body.error.code).toBe("VISITOR_NOT_STAFF");
    await t.http.post(`${V}/admin/cases/${caseId}/visit`).set(an.auth).send({ visit_date: tomorrow, visit_time: "10:00", visitor_id: tech.userId }).expect(201);
    const ch = await t.http.post(`${V}/case/visit/change-request`).set(a.admin.auth).set(a.org).send({ message: "فردا تعطیلی کارخانه است؛ پس‌فردا ساعت ۱۱ ممکن است؟" }).expect(200);
    expect(ch.body.visit.state).toBe("change_requested");
    const ticket = (await t.http.get(`${V}/tickets/${ch.body.ticket_id}`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(ticket).toMatchObject({ link_type: "case", link_id: caseId, status: "waiting_fund" });
    await t.http.post(`${V}/admin/cases/${caseId}/visit`).set(an.auth).send({ visit_date: tomorrow, visit_time: "11:00", visitor_id: tech.userId }).expect(201);
    const visits = (await t.db.query(`select state from case_visits where case_id = $1 order by proposed_at`, [caseId])).rows.map((x: any) => x.state);
    expect(visits).toEqual(["cancelled", "proposed"]);
    await t.http.post(`${V}/case/visit/confirm`).set(a.admin.auth).set(a.org).expect(200);
    expect((await t.http.post(`${V}/admin/jobs/visit-reminders/run`).set(ops.auth).expect(200)).body).toEqual({ reminded: 1 });
    expect((await t.http.post(`${V}/admin/jobs/visit-reminders/run`).set(ops.auth).expect(200)).body).toEqual({ reminded: 0 });
    await t.http.post(`${V}/admin/cases/${caseId}/visit/report`).set(tech.auth).send({ findings: "خط تولید فعال، ۳۰ نفر نیرو، انبار مطابق اظهار." }).expect(200);
    expect((await t.http.get(`${V}/case/visit`).set(a.admin.auth).set(a.org).expect(200)).body.state).toBe("done");
    expect((await t.http.get(`${V}/admin/cases/${caseId}/visit`).set(an.auth).expect(200)).body).toMatchObject({ state: "done", visit_time: "11:00" });
    const fc = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
    for (const i of fc.items.filter((x: any) => x.original_required && x.state === "accepted")) {
      await t.http.post(`${V}/admin/cases/${caseId}/items/${i.id}/original-received`).set(tech.auth).expect(200);
    }
    const after = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
    expect(after.items.filter((x: any) => x.original_required && x.state === "accepted").every((x: any) => !!x.original_received_at)).toBe(true);
    const noOrig = fc.items.find((x: any) => x.code === "3-2");
    expect((await t.http.post(`${V}/admin/cases/${caseId}/items/${noOrig.id}/original-received`).set(tech.auth)).body.error.code).toBe("NO_ORIGINAL_NEEDED");

    // ---- scoring: reasons are mandatory; the result matches the method on the verified figures
    expect((await t.http.post(`${V}/admin/cases/${caseId}/scoring`).set(anfm.auth).send({ ...scoreBody, reasons: { rc: "ok" } })).status).toBe(400);
    // Rc/Ra/Re are kept with three decimals: finer values are refused instead of being rounded after the limit is computed
    expect((await t.http.post(`${V}/admin/cases/${caseId}/scoring`).set(anfm.auth).send({ ...scoreBody, guarantee: { rc: 0.9, ra: 0.8125, re: 0.7 } })).status).toBe(400);
    const sc = await t.http.post(`${V}/admin/cases/${caseId}/scoring`).set(anfm.auth).send(scoreBody).expect(200);
    // the fund's four-period method (v2): calculation A on the four years of statements
    const expected = scoreCase({ activityType: "production_line", years: [year(310000), year(205000), year(138000), year(90000)].map(toFinancialYear), guarantee: scoreBody.guarantee },
      { ...DEFAULT_SCORING_METHOD, ...SCORING_METHOD_V2_CHANGES, version: 2 });
    expect(sc.body.result.credit_limit).toBe(toRials(expected.creditLimit).toString());
    expect(sc.body).toMatchObject({ round_no: 1, method_version: 2 }); // the fund's four-period method

    // ---- the analyst's round goes to the compliance officer (no separate credit approval, fund rules 2026-11-27):
    //      send back with a reason → re-score → send to the fund manager (the CEO) → accept → release to the company
    await t.http.post(`${V}/admin/cases/${caseId}/scoring/submit`).set(anfm.auth).send({ summary: "شرکت تولیدی با رشد فروش مناسب؛ پیشنهاد حد با چک و سفته." }).expect(200);
    expect((await t.http.post(`${V}/admin/cases/${caseId}/to-ceo`).set(an.auth).send({ comment: "برای تصمیم" })).status).toBe(403); // compliance only
    await t.http.post(`${V}/admin/cases/${caseId}/send-back`).set(co.auth).send({ reason: "Re را با توجه به ریسک ارزی بازبینی کنید." }).expect(200);
    expect((await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body.state).toBe("sent_back_to_analyst");
    await t.http.post(`${V}/admin/cases/${caseId}/scoring`).set(anfm.auth).send({ ...scoreBody, guarantee: { rc: 0.9, ra: 0.8, re: 0.6 } }).expect(200);
    await t.http.post(`${V}/admin/cases/${caseId}/scoring/submit`).set(anfm.auth).send({ summary: "Re به ۰٫۶ کاهش یافت." }).expect(200);
    await t.http.post(`${V}/admin/cases/${caseId}/to-ceo`).set(co.auth).send({ comment: "نتیجه‌ی کمیته‌ی اعتباری برای تصمیم مدیر صندوق." }).expect(200);
    // the fund manager who prepared the round cannot decide on it
    const self = { meeting_held: true, meeting_date: "2026-11-20", decision: "accept", comment: "تأیید" };
    expect((await t.http.post(`${V}/admin/cases/${caseId}/ceo-decision`).set(anfm.auth).set(await su(t, anfm, "POST", `/admin/cases/${caseId}/ceo-decision`, self, {})).send(self)).body.error.code).toBe("SELF_APPROVAL");
    const acc = { meeting_held: true, meeting_date: "2026-11-20", decision: "accept", comment: "جلسه‌ی کمیته برگزار شد؛ تأیید می‌شود." };
    await t.http.post(`${V}/admin/cases/${caseId}/ceo-decision`).set(fm.auth).set(await su(t, fm, "POST", `/admin/cases/${caseId}/ceo-decision`, acc, {})).send(acc).expect(200);
    expect((await t.http.get(`${V}/case/limit`).set(a.admin.auth).set(a.org).expect(200)).body.limit).toBeNull(); // not before the release
    const released = (await t.http.post(`${V}/admin/cases/${caseId}/release`).set(co.auth).send({ note_to_applicant: "حد اعتباری با چک و سفته؛ برای افزایش، وثیقه‌ی ملکی پیشنهاد دهید." }).expect(200)).body;
    const v2 = { ...DEFAULT_SCORING_METHOD, ...SCORING_METHOD_V2_CHANGES, version: 2 };
    const exp2 = scoreCase({ activityType: "production_line", years: [year(310000), year(205000), year(138000), year(90000)].map(toFinancialYear), guarantee: { rc: 0.9, ra: 0.8, re: 0.6 } }, v2);
    expect(released.round_state).toBe("approved");
    expect(released.credit_limit.limit_rials).toBe(toRials(exp2.creditLimit).toString());
    expect((await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body.state).toBe("limit_issued");
    const rounds = (await t.http.get(`${V}/admin/cases/${caseId}/rounds`).set(fm.auth).expect(200)).body;
    expect(rounds.map((r: any) => r.state)).toEqual(["approved"]); // the sent-back round was re-prepared, not duplicated
    expect(rounds[0]).toMatchObject({ ceo_decision: "accept", committee_meeting_on: "2026-11-20", compliance_comment: expect.any(String) });
    expect(rounds[0].judgement.reasons.re).toBeTruthy();

    // ---- what the applicant sees: limit, validity, usage, note — no coefficients
    const mine = (await t.http.get(`${V}/case/limit`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(mine.limit).toMatchObject({ limit: toRials(exp2.creditLimit).toString(), used: "0", available: toRials(exp2.creditLimit).toString() });
    expect(mine.limit.valid_to).toBe(addJalaliMonths(mine.limit.valid_from, 12));
    expect(mine.limit.ceilings.guarantee.mortgage_1).toBe(toRials(exp2.guarantee.ceiling.mortgage_1).toString());
    expect(mine.note).toContain("وثیقه‌ی ملکی");
    expect(JSON.stringify(mine)).not.toMatch(/"(ra|re|rc|norm_ceiling)"/);

    // ---- usage ledger: an existing guarantee draws on the norm (÷ Ra × Re); releasing gives it back
    const limit0 = BigInt(mine.limit.limit);
    const u = await t.http.post(`${V}/admin/orgs/${a.orgId}/limit-usages`).set(an.auth).send({ source_type: "existing_guarantee", description: "ضمانت‌نامه‌ی حسن انجام کار ۱۴۰۴", amount: "60000000000", ra: 0.8, re: 0.6 }).expect(201);
    expect(BigInt(u.body.available)).toBe(limit0 - 60_000_000_000n);
    expect(u.body.usages[0].deduction).toBe(toRials(60_000 / (0.8 * 0.6)).toString());
    const app = (await t.http.get(`${V}/case/limit`).set(a.admin.auth).set(a.org).expect(200)).body.limit;
    expect(app).toMatchObject({ used: "60000000000" });
    const rel = await t.http.post(`${V}/admin/limit-usages/${u.body.usages[0].id}/release`).set(fm.auth).send({ reason: "ضمانت‌نامه آزاد شد" }).expect(200);
    expect(BigInt(rel.body.available)).toBe(limit0);
  });

  it("lets the fund manager version the scoring method, with validation", async () => {
    const cur = (await t.http.get(`${V}/admin/scoring-method`).set(fm.auth).expect(200)).body;
    const { version, ...cfg } = cur;
    const bad = { ...cfg, marginWeights: [0.5, 0.3, 0.3] };
    expect((await t.http.put(`${V}/admin/scoring-method`).set(fm.auth).set(await su(t, fm, "PUT", "/admin/scoring-method", bad, {})).send(bad)).body.error.code).toBe("INVALID_SCORING_METHOD");
    const next = { ...cfg, collateral: { ...cfg.collateral, cheque: 0.5 }, note: "ضریب چک به ۰٫۵ افزایش یافت" };
    const r = await t.http.put(`${V}/admin/scoring-method`).set(fm.auth).set(await su(t, fm, "PUT", "/admin/scoring-method", next, {})).send(next).expect(200);
    expect(r.body).toMatchObject({ version: version + 1, collateral: { cheque: 0.5 } });
    expect((await t.http.put(`${V}/admin/scoring-method`).set(an.auth).send(next)).status).toBe(403);
  });
});
