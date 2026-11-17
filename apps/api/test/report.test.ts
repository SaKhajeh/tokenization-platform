import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, staff, approvedOrg, Session, uploadDoc, verifiedAccount, stepUp, idem, KYB_FIELDS } from "./helpers.js";
import { prepareCase, BOARD_NC } from "./case-flow.js";

let t: TestApp;
let co: Session, an: Session, fm: Session, inv: Session;
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09357770001", "compliance_officer");
  an = await staff(t, "09357770002", "analyst");
  fm = await staff(t, "09357770003", "fund_manager");
  inv = await staff(t, "09357770004", "finance_officer");
});
afterAll(async () => t.close());

const V = "/api/v1";

describe("fund report: inquiries and red flags (§7.6)", () => {
  it("records inquiries per subject and assembles the report with red flags", async () => {
    const a = await approvedOrg(t, 131, { compliance: co, financing: true, extraPeople: [{ nationalCode: BOARD_NC, name: "رضا کریمی", roles: ["board"] }] });
    const { caseId, y0 } = await prepareCase(t, a);
    // before any inquiry: every subject is listed as missing; the CEO is the only signatory
    let r = (await t.http.get(`${V}/admin/cases/${caseId}/report`).set(fm.auth).expect(200)).body;
    expect(r.inquiries.map((x: any) => x.subject_type)).toEqual(["company", "person", "person"]);
    const companyId = r.company.national_id;
    expect(r.missing_inquiries.length).toBe(3);
    expect(r.red_flags.map((f: any) => f.code)).toEqual(["sole_signatory"]);
    expect(r.statements.map((s: any) => [s.fiscal_year, s.source])).toEqual([[y0, "declared"], [y0 - 1, "declared"], [y0 - 2, "declared"]]);
    expect(r.ratios).toHaveLength(3);
    expect(r.analysis).toBeTruthy();
    expect(r.products[0]).toEqual({ name: "حسگر دما", main_customers: "فولاد مبارکه" });
    expect(r.signatories).toEqual([{ name: "مدیر نمونه", national_id: a.ceoNationalCode }]);

    // only the analyst records; unknown subjects are refused
    const body = { subject_type: "person", subject_national_id: BOARD_NC, bureau: "مرکز اعتبارسنجی ایرانیان", inquiry_date: "2026-11-01", result: "fail", sana_registered: false, description: "بدهی معوق در بانک ملت" };
    expect((await t.http.post(`${V}/admin/cases/${caseId}/inquiries`).set(fm.auth).send(body)).status).toBe(403);
    const bad = await t.http.post(`${V}/admin/cases/${caseId}/inquiries`).set(an.auth).send({ ...body, subject_national_id: "1234567890" });
    expect(bad.body.error.code).toBe("INQUIRY_SUBJECT_UNKNOWN");
    const doc = await uploadDoc(t, a.admin, a.orgId);
    expect((await t.http.post(`${V}/admin/cases/${caseId}/inquiries`).set(an.auth).send({ ...body, document_id: doc }).expect(201)).body.subject_name).toBe("رضا کریمی");
    await t.http.post(`${V}/admin/cases/${caseId}/inquiries`).set(an.auth).send({ ...body, subject_type: "company", subject_national_id: companyId, result: "pass", sana_registered: true, description: null }).expect(201);
    await t.http.post(`${V}/admin/cases/${caseId}/inquiries`).set(an.auth).send({ ...body, subject_national_id: a.ceoNationalCode, result: "pass", sana_registered: true }).expect(201);

    r = (await t.http.get(`${V}/admin/cases/${caseId}/report`).set(an.auth).expect(200)).body;
    expect(r.missing_inquiries).toEqual([]);
    expect(r.red_flags.map((f: any) => f.code)).toEqual(["inquiry_failed", "not_in_sana", "sole_signatory"]);
    expect(r.red_flags[0].detail).toEqual({ name: "رضا کریمی", bureau: "مرکز اعتبارسنجی ایرانیان" });

    // a later inquiry for the same person replaces the earlier one in the report
    await t.http.post(`${V}/admin/cases/${caseId}/inquiries`).set(an.auth).send({ ...body, inquiry_date: "2026-11-10", result: "pass", sana_registered: true }).expect(201);
    r = (await t.http.get(`${V}/admin/cases/${caseId}/report`).set(an.auth).expect(200)).body;
    expect(r.red_flags.map((f: any) => f.code)).toEqual(["sole_signatory"]);

    // a declared returned cheque raises a flag
    const prep = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    const bf = prep.sections.find((s: any) => s.section === "banks_facilities").data;
    await t.db.query(`update case_sections set data = $2 where case_id = $1 and section = 'banks_facilities'`, [caseId, { ...bf, declaration: { returned_cheques: true, overdue_debts: true } }]);
    r = (await t.http.get(`${V}/admin/cases/${caseId}/report`).set(an.auth).expect(200)).body;
    expect(r.red_flags.map((f: any) => f.code)).toEqual(["returned_cheques", "overdue_debts", "sole_signatory"]);

    // staff without a case role cannot read it
    expect((await t.http.get(`${V}/admin/cases/${caseId}/report`).set(inv.auth)).status).toBe(403);
  });
});

describe("registration changes flow into unedited case fields (§2a)", () => {
  it("updates untouched fields on re-KYB and bank verification, and leaves edited ones alone", async () => {
    const a = await approvedOrg(t, 132, { compliance: co, financing: true });
    const o = a.org;
    const sec = async (name: string) => (await t.http.get(`${V}/case`).set(a.admin.auth).set(o).expect(200)).body.sections.find((s: any) => s.section === name);

    // the applicant edits the website but leaves the landline as registration gave it
    const g = await sec("general");
    expect(g.data.landline).toBe("02112345678");
    await t.http.put(`${V}/case/sections/general`).set(a.admin.auth).set(o).send({ data: { ...g.data, website: "https://own.example.ir" } }).expect(200);

    // re-KYB (allowed in the last 30 days before expiry) with a new phone, website and activity
    await t.db.query(`update orgs set kyb_expires_at = now() + interval '10 days' where id = $1`, [a.orgId]);
    const reg = await t.http.post(`${V}/kyb/registry`).set(a.admin.auth).set(o).expect(200);
    const body = { snapshot_id: reg.body.snapshot.id, fields: { ...KYB_FIELDS, phone: "02199998888", website: "https://kyb.example.ir", activity: "تولید باتری لیتیومی" } };
    const tok = await stepUp(t, a.admin, "POST", `${V}/kyb/submit`, body);
    await t.http.post(`${V}/kyb/submit`).set(a.admin.auth).set({ ...o, "x-step-up-token": tok }).set(idem()).send(body).expect(201);
    let g2 = await sec("general");
    expect(g2.data.landline).toBe("02199998888");                 // untouched → follows registration
    expect(g2.data.activity_subject).toBe("تولید باتری لیتیومی");
    expect(g2.data.website).toBe("https://own.example.ir");      // edited → kept
    expect(g2.prefill.website).toBe("https://kyb.example.ir");    // the new registration value is still shown beside it
    expect(g2.changed_from_registration).toContain("website");

    // a verified bank account joins the banks list while it is untouched
    const acc = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000001234567890");
    let bf = await sec("banks_facilities");
    expect(bf.data.banks.map((b: any) => b.id)).toEqual([acc.id]);

    // once the applicant edits the list, a second account updates only the pre-fill
    await t.http.put(`${V}/case/sections/banks_facilities`).set(a.admin.auth).set(o).send({ data: { ...bf.data, banks: [...bf.data.banks, { name: "ملت", branch: "مرکزی", account_no: "123" }] } }).expect(200);
    const acc2 = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000001234567891");
    bf = await sec("banks_facilities");
    expect(bf.data.banks.length).toBe(2);
    expect(bf.data.banks.some((b: any) => b.id === acc2.id)).toBe(false);
    expect(bf.prefill.banks.map((b: any) => b.id)).toEqual([acc.id, acc2.id]);
  });
});
