/** Test helpers: drive a credit case through preparation, submission and document review. */
import { FINANCIAL_FIELDS } from "@tp/domain";
import { TestApp, idem, approvedOrg, addMember, stepUp, Session, uploadDoc, nationalCode } from "./helpers.js";

const V = "/api/v1";
export const BOARD_NC = nationalCode("071234567");

/** A balanced year in million rials (assets = liabilities + equity), profit 15% of sales. */
export function year(sales: number) {
  const f: Record<string, string> = Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, "0"]));
  Object.assign(f, { cash: "116000", tangibleFixed: "141500", payables: "60000", longLoans: "62500", capital: "135000", sales: String(sales), cogs: String(Math.round(sales * 0.85)) });
  return f;
}

export function sectionData(ceo: string, province = "البرز") {
  return {
    knowledge_based: { is_knowledge_based: true, type: "فناور", approval_date: "2025-05-01", validity_date: "2027-05-01", products: "حسگر صنعتی", field: "electronics" },
    locations: { rows: [
      { id: "L1", usage: "head_office", area_m2: 120, staff_count: 8, ownership: "leased", province: "تهران", address: "تهران، خیابان آزمایش", postcode: "1234567890" },
      { usage: "factory", area_m2: 900, staff_count: 30, ownership: "owned", province, address: "شهرک صنعتی", postcode: "3761234567" },
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

export function fullGeneral(prefill: Record<string, unknown>) {
  return {
    ...prefill, legal_form: "سهامی خاص", registration_place: "تهران", economic_code: "411111111111", registration_no: "123456", establishment_date: "2017-04-01",
    capital_initial: 1000, capital_current: 50000, representative: { name: "مدیر نمونه", role: "مدیرعامل", mobile: "09120000000" }, company_email: "info@example.ir",
    ceo: { name: "مدیر نمونه", mobile: "09120000000" }, heard_from: { channel: "website" },
  };
}

export async function su(t: TestApp, s: Session, method: string, path: string, body: unknown, org: Record<string, string>) {
  return { ...org, "x-step-up-token": await stepUp(t, s, method, `${V}${path}`, body) };
}

/** Fills everything (form, figures, letter, documents). Pays the fee first if `payFee` is given. */
export async function prepareCase(t: TestApp, a: Awaited<ReturnType<typeof approvedOrg>>, opts: { province?: string } = {}) {
  const prep = await addMember(t, a.admin, a.orgId, `0912444${String(Math.floor(Math.random() * 9000) + 1000)}`, "preparer");
  const o = a.org;
  let c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(o).expect(200)).body;
  await t.http.put(`${V}/case/sections/general`).set(prep.auth).set(o).send({ data: fullGeneral(c.sections.find((s: any) => s.section === "general").data) }).expect(200);
  for (const [k, v] of Object.entries(sectionData(a.ceoNationalCode, opts.province))) await t.http.put(`${V}/case/sections/${k}`).set(prep.auth).set(o).send({ data: v }).expect(200);
  const y0 = c.latest_fiscal_year;
  for (const [i, s] of [[0, 310000], [1, 205000], [2, 138000]] as const) {
    await t.http.put(`${V}/case/financials/${y0 - i}`).set(prep.auth).set(o).send({ statement_type: "audited", figures: year(s) }).expect(200);
  }
  await t.http.put(`${V}/case/letter`).set(prep.auth).set(o).send({ text: "درخواست تأمین مالی حدود ۲۰ میلیارد ریال برای خرید تجهیزات خط تولید حسگر." }).expect(200);
  await t.http.post(`${V}/case/letter/sign`).set(a.admin.auth).set(await su(t, a.admin, "POST", "/case/letter/sign", {}, o)).send({}).expect(200);
  c = (await t.http.get(`${V}/case`).set(prep.auth).set(o).expect(200)).body;
  for (const i of c.items.filter((x: any) => x.state === "empty")) {
    if (i.required === "if_available") {
      await t.http.post(`${V}/case/items/${i.id}/not-available`).set(prep.auth).set(o).expect(200);
      continue;
    }
    const doc = await uploadDoc(t, prep, a.orgId);
    await t.http.post(`${V}/case/items/${i.id}/files`).set(prep.auth).set(o).set(idem()).send({ document_id: doc, link_url: i.with_link ? "https://ics24.ir/r/abc" : undefined }).expect(201);
  }
  return { prep, caseId: c.id as string, y0 };
}

export async function submitCase(t: TestApp, a: Awaited<ReturnType<typeof approvedOrg>>) {
  const body = { commitment_accepted: true };
  return t.http.post(`${V}/case/submit`).set(a.admin.auth).set(await su(t, a.admin, "POST", "/case/submit", body, a.org)).set(idem()).send(body);
}

/** Analyst accepts everything and marks the documents complete. */
export async function acceptAll(t: TestApp, an: Session, caseId: string) {
  await t.http.post(`${V}/admin/cases/${caseId}/start-review`).set(an.auth).expect(200);
  const fc = (await t.http.get(`${V}/admin/cases/${caseId}`).set(an.auth).expect(200)).body;
  for (const i of fc.items.filter((x: any) => x.state === "in_review")) await t.http.post(`${V}/admin/cases/${caseId}/items/${i.id}/review`).set(an.auth).send({ decision: "accept" }).expect(200);
  for (const s of fc.sections) await t.http.post(`${V}/admin/cases/${caseId}/sections/${s.section}/review`).set(an.auth).send({ decision: "accept" }).expect(200);
  await t.http.post(`${V}/admin/cases/${caseId}/documents-complete`).set(an.auth).expect(200);
  return fc;
}
