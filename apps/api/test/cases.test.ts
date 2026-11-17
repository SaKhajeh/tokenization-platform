import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FINANCIAL_FIELDS } from "@tp/domain";
import { makeApp, TestApp, idem, staff, approvedOrg, addMember, stepUp, Session, uploadDoc, nationalCode } from "./helpers.js";

let t: TestApp;
let co: Session; // compliance
let an: Session; // analyst
let an2: Session;
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09356660001", "compliance_officer");
  an = await staff(t, "09356660002", "analyst");
  an2 = await staff(t, "09356660003", "analyst");
});
afterAll(async () => t.close());

const V = "/api/v1";
const BOARD_NC = nationalCode("071234567");

async function su(s: Session, method: string, path: string, body: unknown, org: Record<string, string>) {
  const token = await stepUp(t, s, method, `${V}${path}`, body);
  return { ...org, "x-step-up-token": token };
}

/** A complete year: assets = liabilities + equity, in million rials. */
const year = (sales: number) => {
  const f: Record<string, string> = Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, "0"]));
  Object.assign(f, { cash: "116000", tangibleFixed: "141500", payables: "60000", longLoans: "62500", capital: "135000", sales: String(sales), cogs: String(Math.round(sales * 0.85)) });
  return f;
};

function sectionData(ceo: string) {
  return {
    knowledge_based: { is_knowledge_based: true, type: "فناور", approval_date: "2025-05-01", validity_date: "2027-05-01", products: "حسگر صنعتی", field: "electronics" },
    locations: { rows: [
      { id: "L1", usage: "head_office", area_m2: 120, staff_count: 8, ownership: "leased", address: "تهران، خیابان آزمایش", postcode: "1234567890" },
      { usage: "factory", area_m2: 900, staff_count: 30, ownership: "owned", address: "شهرک صنعتی پرند", postcode: "3761234567" },
    ] },
    board: { gazette_no: "23456", gazette_date: "2026-02-10", people: [
      { national_id: ceo, name: "مدیر نمونه", kind: "person", roles: ["ceo", "board", "shareholder"], share_pct: 70, signing_right: true },
      { national_id: BOARD_NC, name: "رضا کریمی", kind: "person", roles: ["board", "shareholder"], share_pct: 30, signing_right: false },
    ] },
    cvs: { entries: [
      { national_id: ceo, position: "مدیرعامل", field_degree: "دکتری مهندسی مواد", university: "شریف", experience_years: 15 },
      { national_id: BOARD_NC, position: "عضو هیئت‌مدیره", field_degree: "کارشناسی ارشد مدیریت", experience_years: 9 },
    ] },
    workforce: { full_time: 38, part_time: 4, insured: 40, key_staff: [] },
    company_products: { history: "تأسیس ۱۳۹۶؛ تولید حسگر برای صنایع فولاد", process: "مونتاژ و کالیبراسیون", products: [{ name: "حسگر دما", main_customers: "فولاد مبارکه" }] },
    banks_facilities: { banks: [{ name: "ملت", branch: "مرکزی", account_no: "IR123" }], facilities: [{ amount: 5000, outstanding: 2000 }], guarantees: [], declaration: { returned_cheques: false, overdue_debts: false } },
    licences_contracts_assets: { licences: [], contracts: [], assets: [] },
  };
}

describe("credit case (plan/07)", () => {
  it("opens only for organisations that want financing, pre-filled from registration (§2a, D-C9)", async () => {
    // investor-only org: no case; choosing financing later opens it at once
    const inv = await approvedOrg(t, 81, { compliance: co });
    expect((await t.http.get(`${V}/case`).set(inv.admin.auth).set(inv.org)).body.error.code).toBe("NO_CASE");
    const p = await t.http.put(`${V}/org/purposes`).set(inv.admin.auth).set(inv.org).send({ invest: true, financing: true }).expect(200);
    expect(p.body.case_id).toBeTruthy();

    // applicant: case opened when KYB is submitted; articles and gazette carried from KYB, accepted on KYB approval
    const a = await approvedOrg(t, 82, { compliance: co, financing: true, kybDocs: true, approve: false, extraPeople: [{ nationalCode: BOARD_NC, name: "رضا کریمی", roles: ["board"] }] });
    let c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(c.state).toBe("opened");
    expect(c.case_no).toMatch(/^CR-14\d\d-\d{5}$/);
    expect(c.items.find((i: any) => i.code === "2-1")).toMatchObject({ state: "uploaded", from_kyb: true });
    await t.http.post(`${V}/admin/kyb/${a.caseId}/decision`).set(co.auth).send({ decision: "approve" }).expect(200);
    c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(c.items.filter((i: any) => i.from_kyb).map((i: any) => [i.code, i.state])).toEqual([["2-1", "accepted"], ["2-2", "accepted"]]);
    const general = c.sections.find((s: any) => s.section === "general");
    expect(general.prefill).toMatchObject({ legal_name: "شرکت نمونه 82", national_id: a.nationalId, activity_subject: "پژوهش و توسعه فناوری باتری", landline: "02112345678" });
    const board = c.sections.find((s: any) => s.section === "board");
    expect(board.data.people.map((x: any) => [x.national_id, x.roles, x.signing_right])).toEqual([[a.ceoNationalCode, ["ceo"], true], [BOARD_NC, ["board"], false]]);
    // slots for the company, the CEO and the board member; the signature certificate only for the signatory
    const slots = (code: string) => c.items.filter((i: any) => i.code === code).map((i: any) => i.slot_key).sort();
    expect(slots("1-2")).toEqual(["company", `person:${a.ceoNationalCode}`, `person:${BOARD_NC}`].sort());
    expect(slots("1-6")).toEqual([`person:${a.ceoNationalCode}`]);
    expect(slots("3-1")).toHaveLength(4);
    expect(c.blockers.map((b: any) => b.code)).toContain("letter_missing");
  });

  it("runs the whole procedure: prepare → submit → review → return → fix → resubmit → complete → verify figures", async () => {
    const a = await approvedOrg(t, 83, { compliance: co, financing: true, kybDocs: true, extraPeople: [{ nationalCode: BOARD_NC, name: "رضا کریمی", roles: ["board"] }] });
    const prep = await addMember(t, a.admin, a.orgId, "09124440083", "preparer");
    const o = a.org;
    let c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(o).expect(200)).body;
    const general = { ...c.sections.find((s: any) => s.section === "general").data };

    // national ID is fixed; changing the legal name flags re-KYB
    const fixed = await t.http.put(`${V}/case/sections/general`).set(prep.auth).set(o).send({ data: { ...general, national_id: "10000000000" } });
    expect(fixed.body.error.code).toBe("FIELD_FIXED");
    const fullGeneral = {
      ...general, legal_form: "سهامی خاص", registration_place: "تهران", economic_code: "411111111111", registration_no: "123456", establishment_date: "2017-04-01",
      capital_initial: 1000, capital_current: 50000, representative: { name: "مدیر نمونه", role: "مدیرعامل", mobile: "09120000000" }, company_email: "info@example.ir",
      ceo: { name: "مدیر نمونه", mobile: "09120000000" }, heard_from: { channel: "website" },
    };
    c = (await t.http.put(`${V}/case/sections/general`).set(prep.auth).set(o).send({ data: fullGeneral }).expect(200)).body;
    expect(c.state).toBe("in_preparation");
    expect(c.kyb_update_needed).toBe(false);
    const sd = sectionData(a.ceoNationalCode);
    for (const [k, v] of Object.entries(sd)) c = (await t.http.put(`${V}/case/sections/${k}`).set(prep.auth).set(o).send({ data: v }).expect(200)).body;
    expect(c.sections.filter((s: any) => s.problems.length).map((s: any) => [s.section, s.problems])).toEqual([]);
    // the factory got an id and a lease slot; the bank account got a turnover slot
    expect(c.items.filter((i: any) => i.code === "2-4")).toHaveLength(2);
    expect(c.items.filter((i: any) => i.code === "3-3")).toHaveLength(1);
    // board member gave up signing rights → still no 1-6 slot for them; renaming the company asks for re-KYB
    const renamed = (await t.http.put(`${V}/case/sections/general`).set(prep.auth).set(o).send({ data: { ...fullGeneral, legal_name: "شرکت نمونه ۸۳ (جدید)" } }).expect(200)).body;
    expect(renamed.kyb_update_needed).toBe(true);
    await t.http.put(`${V}/case/sections/general`).set(prep.auth).set(o).send({ data: fullGeneral }).expect(200);

    // financials: an unbalanced year blocks submission
    const y0 = c.latest_fiscal_year;
    const bad = { ...year(310000), cash: "116001" };
    const r = await t.http.put(`${V}/case/financials/${y0}`).set(prep.auth).set(o).send({ statement_type: "audited", figures: bad }).expect(200);
    expect(r.body.problems).toEqual(["rule:not_balanced:1"]);
    expect((await t.http.put(`${V}/case/financials/${y0}`).set(prep.auth).set(o).send({ statement_type: "audited", figures: { ...bad, cash: "1.5" } })).body.error.code).toBe("INVALID_FIGURES");
    expect((await t.http.put(`${V}/case/financials/${y0 - 3}`).set(prep.auth).set(o).send({ statement_type: "audited", figures: year(1) })).body.error.code).toBe("FISCAL_YEAR_OUT_OF_RANGE");
    for (const [i, s] of [[0, 310000], [1, 205000], [2, 138000]] as const) {
      await t.http.put(`${V}/case/financials/${y0 - i}`).set(prep.auth).set(o).send({ statement_type: i === 0 ? "audited" : "tax_return", figures: year(s) }).expect(200);
    }

    // letter: free text, signed by an approver/admin with step-up
    await t.http.put(`${V}/case/letter`).set(prep.auth).set(o).send({ text: "درخواست تأمین مالی حدود ۲۰ میلیارد ریال برای خرید تجهیزات خط تولید حسگر." }).expect(200);
    expect((await t.http.post(`${V}/case/letter/sign`).set(prep.auth).set(o)).status).toBe(403);
    const sg = await t.http.post(`${V}/case/letter/sign`).set(a.admin.auth).set(await su(a.admin, "POST", "/case/letter/sign", {}, o)).send({}).expect(200);
    expect(sg.body.rendered).toContain("به: صندوق پژوهش و فناوری");

    // documents: one button per slot; credit reports need their SMS link; optional items can be «not available»
    c = (await t.http.get(`${V}/case`).set(prep.auth).set(o).expect(200)).body;
    expect(c.blockers.filter((b: any) => b.code === "document_missing").length).toBeGreaterThan(15);
    for (const i of c.items.filter((x: any) => x.state === "empty")) {
      if (i.required === "if_available" && i.code !== "4-1") {
        await t.http.post(`${V}/case/items/${i.id}/not-available`).set(prep.auth).set(o).expect(200);
        continue;
      }
      const doc = await uploadDoc(t, prep, a.orgId);
      const path = `${V}/case/items/${i.id}/files`;
      if (i.with_link) expect((await t.http.post(path).set(prep.auth).set(o).set(idem()).send({ document_id: doc })).body.error.code).toBe("LINK_REQUIRED");
      await t.http.post(path).set(prep.auth).set(o).set(idem()).send({ document_id: doc, link_url: i.with_link ? "https://ics24.ir/r/abc" : undefined }).expect(201);
    }
    const required = c.items.find((x: any) => x.code === "3-2");
    expect((await t.http.post(`${V}/case/items/${required.id}/not-available`).set(prep.auth).set(o)).body.error.code).toBe("ITEM_REQUIRED");
    // a new version replaces the old file on a single-file slot
    const trial = await uploadDoc(t, prep, a.orgId);
    await t.http.post(`${V}/case/items/${required.id}/files`).set(prep.auth).set(o).set(idem()).send({ document_id: trial }).expect(201);
    c = (await t.http.get(`${V}/case`).set(prep.auth).set(o).expect(200)).body;
    expect(c.items.find((x: any) => x.id === required.id).files.map((f: any) => f.version)).toEqual([2]);
    expect(c.blockers).toEqual([]);

    // submit: approver/admin with step-up; preparer cannot
    const body = { commitment_accepted: true };
    expect((await t.http.post(`${V}/case/submit`).set(prep.auth).set(o).set(idem()).send(body)).status).toBe(403);
    const s1 = await t.http.post(`${V}/case/submit`).set(a.admin.auth).set(await su(a.admin, "POST", "/case/submit", body, o)).set(idem()).send(body).expect(200);
    expect(s1.body.state).toBe("submitted");
    // locked for the applicant now
    expect((await t.http.put(`${V}/case/sections/workforce`).set(prep.auth).set(o).send({ data: sd.workforce })).body.error.code).toBe("CASE_LOCKED");

    // fund: review queue → start → per-item decisions
    const q = await t.http.get(`${V}/admin/cases?state=submitted`).set(an.auth).expect(200);
    const caseId = q.body.find((x: any) => x.org_id === a.orgId).id;
    await t.http.post(`${V}/admin/cases/${caseId}/start-review`).set(an.auth).expect(200);
    let fc = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
    expect(fc.assigned_analyst).toBe(an.userId);
    const trialItem = fc.items.find((x: any) => x.id === required.id);
    expect(trialItem.files.map((f: any) => [f.version, !!f.removed_at])).toEqual([[1, true], [2, false]]); // staff see history

    const noMsg = await t.http.post(`${V}/admin/cases/${caseId}/items/${trialItem.id}/review`).set(an.auth).send({ decision: "needs_fix", reason_code: "no_stamp_or_signature" });
    expect(noMsg.body.error.code).toBe("REVIEW_NOT_ALLOWED");
    // cannot return or complete with unreviewed items
    expect((await t.http.post(`${V}/admin/cases/${caseId}/return`).set(an.auth)).body.error.code).toBe("CASE_REVIEW_INCOMPLETE");
    for (const i of fc.items.filter((x: any) => x.state === "in_review")) {
      const decision = i.id === trialItem.id ? { decision: "needs_fix", reason_code: "no_stamp_or_signature", message: "تراز آزمایشی مهر شرکت ندارد." } : { decision: "accept" };
      await t.http.post(`${V}/admin/cases/${caseId}/items/${i.id}/review`).set(an.auth).send(decision).expect(200);
    }
    for (const s of fc.sections) await t.http.post(`${V}/admin/cases/${caseId}/sections/${s.section}/review`).set(an.auth).send({ decision: "accept" }).expect(200);
    const extra = await t.http.post(`${V}/admin/cases/${caseId}/requests`).set(an.auth).send({ title: "گواهی ارزش افزوده", message: "آخرین گواهی ثبت‌نام در نظام مالیات بر ارزش افزوده را بارگذاری کنید." }).expect(201);
    expect((await t.http.post(`${V}/admin/cases/${caseId}/documents-complete`).set(an.auth)).body.error.code).toBe("CASE_REVIEW_INCOMPLETE");
    const ret = await t.http.post(`${V}/admin/cases/${caseId}/return`).set(an.auth).expect(200);
    expect(ret.body).toMatchObject({ state: "returned", items: 2, sections: 0 });

    // applicant: sees the message, a task per item; accepted items are locked; fixes and resubmits
    c = (await t.http.get(`${V}/case`).set(prep.auth).set(o).expect(200)).body;
    expect(c.items.find((x: any) => x.id === trialItem.id).review).toMatchObject({ decision: "needs_fix", message: "تراز آزمایشی مهر شرکت ندارد." });
    const tasks = await t.db.query(`select title from tasks where org_id = $1 and workflow_key = 'case.fix_item' and status = 'open'`, [a.orgId]);
    expect(tasks.rows).toHaveLength(2);
    const accepted = c.items.find((x: any) => x.state === "accepted" && !x.from_kyb);
    expect((await t.http.post(`${V}/case/items/${accepted.id}/files`).set(prep.auth).set(o).set(idem()).send({ document_id: await uploadDoc(t, prep, a.orgId) })).body.error.code).toBe("ITEM_LOCKED");
    expect((await t.http.put(`${V}/case/sections/workforce`).set(prep.auth).set(o).send({ data: sd.workforce })).body.error.code).toBe("SECTION_LOCKED");
    const blocked = await t.http.post(`${V}/case/submit`).set(a.admin.auth).set(await su(a.admin, "POST", "/case/submit", body, o)).set(idem()).send(body);
    expect(blocked.body.error.details.blockers.map((b: any) => b.code)).toEqual(["item_not_fixed", "item_not_fixed"]);
    for (const id of [trialItem.id, extra.body.item_id]) {
      await t.http.post(`${V}/case/items/${id}/files`).set(prep.auth).set(o).set(idem()).send({ document_id: await uploadDoc(t, prep, a.orgId) }).expect(201);
    }
    const s2 = await t.http.post(`${V}/case/submit`).set(a.admin.auth).set(await su(a.admin, "POST", "/case/submit", body, o)).set(idem()).send(body).expect(200);
    expect(s2.body.state).toBe("resubmitted");
    expect((await t.db.query(`select count(*)::int n from tasks where org_id = $1 and workflow_key = 'case.fix_item' and status = 'open'`, [a.orgId])).rows[0].n).toBe(0);

    // re-check only the fixed items, then complete
    await t.http.post(`${V}/admin/cases/${caseId}/start-review`).set(an.auth).expect(200);
    fc = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
    const open = fc.items.filter((x: any) => x.state === "in_review").map((x: any) => x.id).sort();
    expect(open).toEqual([trialItem.id, extra.body.item_id].sort());
    for (const id of open) await t.http.post(`${V}/admin/cases/${caseId}/items/${id}/review`).set(an.auth).send({ decision: "accept" }).expect(200);
    const done = await t.http.post(`${V}/admin/cases/${caseId}/documents-complete`).set(an.auth).expect(200);
    expect(done.body.state).toBe("documents_complete");

    // financial verification: cell by cell with a reason; lock refuses unbalanced figures
    const vpath = `${V}/admin/cases/${caseId}/financials/${y0}/cash`;
    expect((await t.http.put(vpath).set(an.auth).send({ value: "117000" })).status).toBe(400); // reason required
    await t.http.put(vpath).set(an.auth).send({ value: "117000", reason: "طبق صورت مالی حسابرسی‌شده صفحه ۳" }).expect(200);
    const lockBad = await t.http.post(`${V}/admin/cases/${caseId}/financials/lock`).set(an.auth);
    expect(lockBad.body.error.code).toBe("FINANCIALS_NOT_BALANCED");
    await t.http.put(`${V}/admin/cases/${caseId}/financials/${y0}/capital`).set(an.auth).send({ value: "136000", reason: "افزایش سرمایه‌ی ثبت‌شده" }).expect(200);
    await t.http.post(`${V}/admin/cases/${caseId}/financials/lock`).set(an.auth).expect(200);
    fc = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
    const fy = fc.financials.find((f: any) => f.fiscal_year === y0);
    expect(fy.declared.cash).toBe("116000"); // declared value kept
    expect(fy.verified.cash).toBe("117000");
    expect(fy.adjustments.map((x: any) => [x.field, x.declared, x.verified])).toEqual([["cash", "116000", "117000"], ["capital", "135000", "136000"]]);
    expect((await t.http.put(vpath).set(an.auth).send({ value: "1", reason: "تست قفل" })).body.error.code).toBe("FINANCIALS_LOCKED");
    // the applicant never sees verified figures or staff-only history
    c = (await t.http.get(`${V}/case`).set(prep.auth).set(o).expect(200)).body;
    expect(c.financials[0].verified).toBeUndefined();
    expect(c.state).toBe("documents_complete");
    const audit = await t.db.query(`select action from audit_log where entity_id = $1 and action like 'case.%'`, [caseId]);
    expect(audit.rows.map((x: any) => x.action)).toEqual(expect.arrayContaining(["case.submitted", "case.returned", "case.resubmitted", "case.documents_complete", "case.financials_locked"]));
  });

  it("keeps each organisation to its own case and documents; staff endpoints are staff-only", async () => {
    const a = await approvedOrg(t, 84, { compliance: co, financing: true });
    const b = await approvedOrg(t, 85, { compliance: co, financing: true });
    const ca = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    const cb = (await t.http.get(`${V}/case`).set(b.admin.auth).set(b.org).expect(200)).body;
    expect(ca.id).not.toBe(cb.id);
    // b cannot touch a's item, nor attach a's document to its own item
    const aItem = ca.items.find((i: any) => i.code === "3-2");
    expect((await t.http.post(`${V}/case/items/${aItem.id}/files`).set(b.admin.auth).set(b.org).set(idem()).send({ document_id: await uploadDoc(t, b.admin, b.orgId) })).status).toBe(404);
    const bItem = cb.items.find((i: any) => i.code === "3-2");
    expect((await t.http.post(`${V}/case/items/${bItem.id}/files`).set(b.admin.auth).set(b.org).set(idem()).send({ document_id: await uploadDoc(t, a.admin, a.orgId) })).body.error.code).toBe("BAD_DOCUMENT");
    // a's admin using b's org header is refused
    expect((await t.http.get(`${V}/case`).set(a.admin.auth).set(b.org)).status).toBe(404); // not a member: the org is invisible
    expect((await t.http.get(`${V}/admin/cases`).set(a.admin.auth)).status).toBe(403);
    expect((await t.http.post(`${V}/admin/cases/${ca.id}/start-review`).set(co.auth)).status).toBe(403);
    // withdrawal is final
    const w = { reason: "فعلاً منصرف شدیم" };
    await t.http.post(`${V}/case/withdraw`).set(a.admin.auth).set(await su(a.admin, "POST", "/case/withdraw", w, a.org)).send(w).expect(200);
    expect((await t.http.put(`${V}/case/letter`).set(a.admin.auth).set(a.org).send({ text: "متن آزمایشی برای پرونده‌ی منصرف‌شده‌ی این شرکت" })).body.error.code).toBe("CASE_LOCKED");
    expect(an2).toBeTruthy();
  });
});
