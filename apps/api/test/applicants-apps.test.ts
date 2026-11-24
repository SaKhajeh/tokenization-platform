import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import { makeApp, TestApp, idem, staff, approvedOrg, addMember, stepUp, Session, KYB_FIELDS, orgWithAdmin, grantCreditLimit } from "./helpers.js";

let t: TestApp;
let co: Session; // compliance officer
let an: Session; // analyst
let both: Session; // holds analyst + compliance (maker-checker test)
let ops: Session; // super admin (jobs) + tokenisation officer
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09353330001", "compliance_officer");
  an = await staff(t, "09353330002", "analyst");
  both = await staff(t, "09353330003", "analyst", "compliance_officer");
  ops = await staff(t, "09353330004", "super_admin", "tokenisation_officer");
});
afterAll(async () => t.close());

const V = "/api/v1";
const processChain = async () => {
  await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200);
  return (await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200)).body;
};

async function doc(s: Session, orgId: string, category = "financial_statement") {
  const o = { "x-org-id": orgId };
  const up = await t.http.post(`${V}/documents/upload-url`).set(s.auth).set(o).set(idem()).send({ category, filename: "f.pdf", mime: "application/pdf", size: 1000 }).expect(201);
  t.storage.put(`orgs/${orgId}/${up.body.document_id}`, 1000);
  await t.http.post(`${V}/documents/${up.body.document_id}/complete`).set(s.auth).set(o).send({ sha256: "d".repeat(64) }).expect(200);
  return up.body.document_id as string;
}

/** KYB-approved company with a credit limit (plan/07: the credit case replaces applicant onboarding), digital ID registered. */
async function approvedApplicant(n: number) {
  const a = await approvedOrg(t, n, { compliance: co });
  await processChain();
  await grantCreditLimit(t, a.orgId, a.admin.userId);
  return a;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

async function initiative(s: Session, orgId: string, startedOn = daysAgo(90)) {
  const evidence = await doc(s, orgId, "evidence");
  const r = await t.http.post(`${V}/initiatives`).set(s.auth).set({ "x-org-id": orgId }).set(idem()).send({
    title: "خط تولید باتری لیتیومی",
    description: "راه‌اندازی خط تولید سلول‌های باتری لیتیوم‌یون برای ذخیره‌سازی صنعتی؛ فاز اول نصب تجهیزات.",
    sector: "انرژی", location: "اصفهان", started_on: startedOn,
    progress_summary: "نصب ۴۰٪ تجهیزات انجام شده و قرارداد خرید مواد اولیه منعقد شده است.",
    evidence_doc_ids: [evidence],
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

const APP = (initiativeId: string) => ({
  initiative_id: initiativeId,
  investment_type: "project_finance",
  requested_amount: "50000000000",
  min_amount: "30000000000",
  proposed_rate: "0.235",
  proposed_duration_days: 365,
  proposed_rule: "keep_raised",
  use_of_funds: "خرید و نصب تجهیزات باقی‌مانده خط تولید و سرمایه در گردش سه ماه اول.",
  repayment_source: "فروش محصولات به قرارداد پیش‌خرید شرکت توزیع برق منطقه‌ای.",
  proposed_guarantees: [{ type: "bank_guarantee", description: "ضمانت‌نامه بانکی به مبلغ اصل و سود", amount: "61750000000" }],
  document_ids: [],
});

async function submitAs(s: Session, orgId: string, appId: string) {
  const path = `${V}/applications/${appId}/submit`;
  const su = await stepUp(t, s, "POST", path, {});
  return t.http.post(path).set(s.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send({});
}

describe("companies apply; the fund issues (D14)", () => {
  it("a company with a credit limit stays investor-only on-chain and is never an issuer", async () => {
    const a = await approvedApplicant(51);
    await processChain();
    const w = await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200);
    expect(t.chain.identities.get(getAddress(w.body.address))!.flags).toBe(1);
    expect((await t.db.query(`select is_issuer, is_applicant from orgs where id = $1`, [a.orgId])).rows[0]).toEqual({ is_issuer: false, is_applicant: true });
    // the old onboarding endpoints are gone
    expect((await t.http.get(`${V}/applicant-profile`).set(a.admin.auth).set(a.org)).status).toBe(404);
  });
});

describe("applications", () => {
  it("runs preparer → approver → fund screening → returned → fixed → resubmitted → passed", async () => {
    const a = await approvedApplicant(52);
    const prep = await addMember(t, a.admin, a.orgId, "09123330052", "preparer");
    const appr = await addMember(t, a.admin, a.orgId, "09123330152", "approver");
    const o = { "x-org-id": a.orgId };

    const ini = await initiative(prep, a.orgId);
    const created = await t.http.post(`${V}/applications`).set(prep.auth).set(o).set(idem()).send(APP(ini)).expect(201);
    const id = created.body.id;
    expect(created.body.application_no).toMatch(/^APP-14\d\d-\d{4}$/);
    expect(created.body.status).toBe("draft");

    // drafts are private to the applicant
    expect((await t.http.get(`${V}/admin/applications/${id}`).set(an.auth)).status).toBe(404);
    // the approver cannot submit what nobody prepared; the preparer cannot submit at all
    expect((await submitAs(appr, a.orgId, id)).body.error.code).toBe("NOT_PREPARED");
    expect((await t.http.post(`${V}/applications/${id}/submit`).set(prep.auth).set(o).set(idem()).send({})).status).toBe(403);

    await t.http.post(`${V}/applications/${id}/request-approval`).set(prep.auth).set(o).expect(200);
    const apprNotes = await t.http.get(`${V}/notifications?unread=true`).set(appr.auth).expect(200);
    expect(apprNotes.body.items[0].event_key).toBe("application.approval_needed");
    const sub = await submitAs(appr, a.orgId, id);
    expect(sub.body).toEqual({ id, status: "submitted" });

    // fund: analyst queue, screening
    const q = await t.http.get(`${V}/admin/tasks`).set(an.auth).expect(200);
    expect(q.body.some((x: any) => x.linked_id === id && x.workflow_key === "application.screen")).toBe(true);
    await t.http.post(`${V}/admin/applications/${id}/start-screening`).set(an.auth).expect(200);
    const ret = await t.http.post(`${V}/admin/applications/${id}/screening`).set(an.auth).send({
      checklist: [{ item: "آغاز طرح", ok: true }, { item: "صورت‌های مالی حسابرسی‌شده", ok: false, note: "سال ۱۴۰۳ ندارد" }],
      outcome: "return", comment: "صورت مالی سال ۱۴۰۳ لازم است.",
      return_items: [{ title: "بارگذاری صورت مالی حسابرسی‌شده ۱۴۰۳" }, { title: "اصلاح منبع بازپرداخت", description: "قرارداد پیش‌خرید پیوست شود" }],
    });
    expect(ret.body.status).toBe("returned");

    // the applicant sees what to fix, but not the fund's internal checklist
    const view = await t.http.get(`${V}/applications/${id}`).set(prep.auth).set(o).expect(200);
    expect(view.body.status).toBe("returned");
    expect(view.body.screening.comment).toContain("۱۴۰۳");
    expect(view.body.screening.checklist).toBeUndefined();
    expect(view.body.applicant_tasks).toHaveLength(2);
    expect(view.body.events.map((e: any) => e.to_status)).toEqual(["draft", "submitted", "screening", "returned"]);
    const internal = await t.http.get(`${V}/admin/applications/${id}`).set(an.auth).expect(200);
    expect(internal.body.screening.checklist).toHaveLength(2);

    // resubmission waits until every returned item is done
    await t.http.patch(`${V}/applications/${id}`).set(prep.auth).set(o).send({ repayment_source: "فروش به شرکت توزیع برق طبق قرارداد پیش‌خرید پیوست." }).expect(200);
    await t.http.post(`${V}/applications/${id}/request-approval`).set(prep.auth).set(o).expect(200);
    expect((await submitAs(appr, a.orgId, id)).body.error.code).toBe("RETURN_ITEMS_OPEN");
    for (const task of view.body.applicant_tasks) {
      await t.http.patch(`${V}/tasks/${task.id}`).set(prep.auth).set(o).send({ status: "in_progress" }).expect(200);
      await t.http.patch(`${V}/tasks/${task.id}`).set(prep.auth).set(o).send({ status: "done" }).expect(200);
    }
    expect((await submitAs(appr, a.orgId, id)).body.status).toBe("resubmitted");

    await t.http.post(`${V}/admin/applications/${id}/start-screening`).set(an.auth).expect(200);
    const pass = await t.http.post(`${V}/admin/applications/${id}/screening`).set(an.auth).send({ checklist: [{ item: "کامل", ok: true }], outcome: "pass" });
    expect(pass.body.status).toBe("credit_assessment");
    const illegal = await t.http.post(`${V}/admin/applications/${id}/start-screening`).set(an.auth);
    expect(illegal.body.error.code).toBe("ILLEGAL_TRANSITION");
    const notes = await t.http.get(`${V}/notifications`).set(prep.auth).expect(200);
    expect(notes.body.items.map((x: any) => x.event_key)).toEqual(expect.arrayContaining(["application.returned", "application.passed_screening"]));
  });

  it("needs a valid credit limit, a started initiative and maker–checker", async () => {
    // KYB approved but no credit limit
    const plain = await approvedOrg(t, 53, { compliance: co });
    const ini0 = await initiative(plain.admin, plain.orgId);
    const app0 = await t.http.post(`${V}/applications`).set(plain.admin.auth).set(plain.org).set(idem()).send(APP(ini0)).expect(201);
    expect((await t.http.post(`${V}/applications/${app0.body.id}/request-approval`).set(plain.admin.auth).set(plain.org)).body.error.code).toBe("CREDIT_LIMIT_REQUIRED");

    const a = await approvedApplicant(54);
    const future = await initiative(a.admin, a.orgId, new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10));
    const app1 = await t.http.post(`${V}/applications`).set(a.admin.auth).set(a.org).set(idem()).send(APP(future)).expect(201);
    expect((await t.http.post(`${V}/applications/${app1.body.id}/request-approval`).set(a.admin.auth).set(a.org)).body.error.code).toBe("INITIATIVE_NOT_STARTED");

    // two members → the admin who prepared cannot also submit
    await addMember(t, a.admin, a.orgId, "09123330054", "viewer");
    const ini = await initiative(a.admin, a.orgId);
    const app2 = await t.http.post(`${V}/applications`).set(a.admin.auth).set(a.org).set(idem()).send(APP(ini)).expect(201);
    await t.http.post(`${V}/applications/${app2.body.id}/request-approval`).set(a.admin.auth).set(a.org).expect(200);
    expect((await submitAs(a.admin, a.orgId, app2.body.id)).body.error.code).toBe("MAKER_CHECKER");
  });

  it("lets a single-user org prepare and submit alone, with step-up", async () => {
    const a = await approvedApplicant(55);
    const ini = await initiative(a.admin, a.orgId);
    const app = await t.http.post(`${V}/applications`).set(a.admin.auth).set(a.org).set(idem()).send(APP(ini)).expect(201);
    await t.http.post(`${V}/applications/${app.body.id}/request-approval`).set(a.admin.auth).set(a.org).expect(200);
    expect((await submitAs(a.admin, a.orgId, app.body.id)).body.status).toBe("submitted");
    const got = await t.http.get(`${V}/applications/${app.body.id}`).set(a.admin.auth).set(a.org).expect(200);
    expect(got.body.single_user).toBe(true);
  });

  it("blocks reviewers from their own org, supports withdraw and inactivity expiry", async () => {
    const a = await approvedApplicant(56);
    const ini = await initiative(a.admin, a.orgId);
    const app = await t.http.post(`${V}/applications`).set(a.admin.auth).set(a.org).set(idem()).send(APP(ini)).expect(201);
    await t.http.post(`${V}/applications/${app.body.id}/request-approval`).set(a.admin.auth).set(a.org).expect(200);
    await submitAs(a.admin, a.orgId, app.body.id);
    const insider = await staff(t, "09123330056", "analyst");
    await addMember(t, a.admin, a.orgId, "09123330056", "viewer");
    expect((await t.http.post(`${V}/admin/applications/${app.body.id}/start-screening`).set(insider.auth)).body.error.code).toBe("CONFLICT_OF_INTEREST");
    await t.http.post(`${V}/applications/${app.body.id}/withdraw`).set(a.admin.auth).set(a.org).send({ reason: "تغییر برنامه" }).expect(200);
    expect((await t.http.post(`${V}/admin/applications/${app.body.id}/start-screening`).set(an.auth)).body.error.code).toBe("ILLEGAL_TRANSITION");

    const stale = await t.http.post(`${V}/applications`).set(a.admin.auth).set(a.org).set(idem()).send(APP(ini)).expect(201);
    await t.db.query(`update applications set last_activity_at = now() - interval '61 days' where id = $1`, [stale.body.id]);
    const job = await t.http.post(`${V}/admin/jobs/application-expiry/run`).set(ops.auth).expect(200);
    expect(job.body.expired).toBe(1);
    expect((await t.http.get(`${V}/applications/${stale.body.id}`).set(a.admin.auth).set(a.org).expect(200)).body.status).toBe("expired");
  });
});

describe("the fund as the single issuer (D14)", () => {
  it("seeds one fund org whose digital ID carries the issuer and fund flags", async () => {
    const { seedFund } = await import("../src/orgs/fund.js");
    const { ChainService } = await import("../src/chain/chain.service.js");
    const { AuditService } = await import("../src/audit/audit.service.js");
    const deps = { audit: t.app.get(AuditService), chain: t.app.get(ChainService), validateChecksum: true };
    const a = await approvedOrg(t, 59, { compliance: co }); // the fund registers and passes KYB like anyone
    await processChain();
    const r = await seedFund(t.db, deps, { nationalId: a.nationalId, legalName: "صندوق پژوهش و فناوری", adminMobile: a.admin.mobile });
    expect(r.created).toBe(false);
    await processChain();
    const w = await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200);
    expect(t.chain.identities.get(getAddress(w.body.address))!.flags).toBe(7); // investor | issuer | fund
    const o = await t.http.get(`${V}/orgs/current`).set(a.admin.auth).set(a.org).expect(200);
    expect(o.body).toMatchObject({ org_kind: "fund", is_issuer: true });

    // there is only one fund, and no other org can be marked as issuer
    const b = await approvedOrg(t, 60, { compliance: co });
    await expect(seedFund(t.db, deps, { nationalId: b.nationalId, legalName: "صندوق دوم", adminMobile: b.admin.mobile })).rejects.toThrow(/already the fund/);
    await expect(t.db.query(`update orgs set is_issuer = true where id = $1`, [b.orgId])).rejects.toThrow(/orgs_issuer_is_fund/);
  });
});

describe("notifications", () => {
  it("lists, counts and marks as read; never shows other users' notifications", async () => {
    const a = await approvedOrg(t, 57, { compliance: co });
    const n = await t.http.get(`${V}/notifications`).set(a.admin.auth).expect(200);
    expect(n.body.unread).toBeGreaterThan(0);
    await t.http.post(`${V}/notifications/${n.body.items[0].id}/read`).set(a.admin.auth).expect(200);
    expect((await t.http.post(`${V}/notifications/${n.body.items[0].id}/read`).set(co.auth)).status).toBe(404);
    await t.http.post(`${V}/notifications/read-all`).set(a.admin.auth).expect(200);
    expect((await t.http.get(`${V}/notifications`).set(a.admin.auth).expect(200)).body.unread).toBe(0);
  });
});

describe("KYB expiry", () => {
  it("reminds, expires, revokes the digital ID, and re-KYB reinstates and updates it", async () => {
    const a = await approvedOrg(t, 58, { compliance: co });
    await processChain();
    const w = (await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200)).body;

    await t.db.query(`update orgs set kyb_expires_at = now() + interval '5 days' where id = $1`, [a.orgId]);
    const r1 = await t.http.post(`${V}/admin/jobs/kyb-expiry/run`).set(ops.auth).expect(200);
    expect(r1.body.reminded).toBeGreaterThanOrEqual(1);
    const again = await t.http.post(`${V}/admin/jobs/kyb-expiry/run`).set(ops.auth).expect(200);
    expect(again.body.reminded).toBe(0); // reminders are not repeated

    await t.db.query(`update orgs set kyb_expires_at = now() - interval '1 minute' where id = $1`, [a.orgId]);
    const r2 = await t.http.post(`${V}/admin/jobs/kyb-expiry/run`).set(ops.auth).expect(200);
    expect(r2.body.expired).toBe(1);
    expect((await t.http.get(`${V}/kyb`).set(a.admin.auth).set(a.org).expect(200)).body.kyb_status).toBe("expired");
    expect((await t.http.get(`${V}/deposit-instructions`).set(a.admin.auth).set(a.org)).body.error.code).toBe("KYB_REQUIRED");
    await processChain();
    expect(t.chain.identities.get(getAddress(w.address))!.revoked).toBe(true);
    expect((await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200)).body.registry_status).toBe("revoked");

    // re-KYB
    const reg = await t.http.post(`${V}/kyb/registry`).set(a.admin.auth).set(a.org).expect(200);
    const body = { snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS };
    const su = await stepUp(t, a.admin, "POST", `${V}/kyb/submit`, body);
    const sub = await t.http.post(`${V}/kyb/submit`).set(a.admin.auth).set({ ...a.org, "x-step-up-token": su }).set(idem()).send(body).expect(201);
    expect(sub.body.version).toBe(2);
    await t.http.post(`${V}/admin/kyb/${sub.body.id}/decision`).set(co.auth).send({ decision: "approve" }).expect(200);
    await processChain();
    const id = t.chain.identities.get(getAddress(w.address))!;
    expect(id.revoked).toBe(false);
    const expires = (await t.http.get(`${V}/kyb`).set(a.admin.auth).set(a.org).expect(200)).body.kyb_expires_at;
    expect(id.expiry).toBe(Math.floor(new Date(expires).getTime() / 1000));
    expect((await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200)).body.registry_status).toBe("registered");

    // A second expiry must revoke again. (Regression: the revoke call has the same payload every time, and keying
    // the outbox on the payload alone dropped this second revoke, leaving an expired org verified on-chain.)
    await t.db.query(`update orgs set kyb_expires_at = now() - interval '1 minute' where id = $1`, [a.orgId]);
    expect((await t.http.post(`${V}/admin/jobs/kyb-expiry/run`).set(ops.auth).expect(200)).body.expired).toBe(1);
    await processChain();
    expect(t.chain.identities.get(getAddress(w.address))!.revoked).toBe(true);
    expect((await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200)).body.registry_status).toBe("revoked");

    // …and a second re-KYB must reinstate again.
    const reg2 = await t.http.post(`${V}/kyb/registry`).set(a.admin.auth).set(a.org).expect(200);
    const body2 = { snapshot_id: reg2.body.snapshot.id, fields: KYB_FIELDS };
    const su2 = await stepUp(t, a.admin, "POST", `${V}/kyb/submit`, body2);
    const sub2 = await t.http.post(`${V}/kyb/submit`).set(a.admin.auth).set({ ...a.org, "x-step-up-token": su2 }).set(idem()).send(body2).expect(201);
    expect(sub2.body.version).toBe(3);
    await t.http.post(`${V}/admin/kyb/${sub2.body.id}/decision`).set(co.auth).send({ decision: "approve" }).expect(200);
    await processChain();
    expect(t.chain.identities.get(getAddress(w.address))!.revoked).toBe(false);
    expect((await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200)).body.registry_status).toBe("registered");
  });
});

describe("chain outbox", () => {
  it("re-queues a sent transaction that never gets a receipt, and does not apply it twice", async () => {
    t.chain.autoConfirm = false;
    try {
      const a = await approvedOrg(t, 61, { compliance: co });
      await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200);
      const tx = (await t.db.query(`select c.* from chain_txs c join wallets w on w.id::text = c.ref_id where w.org_id = $1`, [a.orgId])).rows[0];
      expect(tx.status).toBe("submitted");

      // Still no receipt, but not old yet: left alone.
      await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200);
      expect((await t.db.query(`select status from chain_txs where id = $1`, [tx.id])).rows[0].status).toBe("submitted");

      // Older than CHAIN_TX_STALE_SEC: back to the queue.
      await t.db.query(`update chain_txs set submitted_at = now() - interval '2 hours' where id = $1`, [tx.id]);
      await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200);
      const back = (await t.db.query(`select status, last_error from chain_txs where id = $1`, [tx.id])).rows[0];
      expect(back.status).toBe("queued");
      expect(back.last_error).toMatch(/no confirmed receipt/);

      // The first send landed after all: the pre-send check confirms it instead of sending again.
      const sends = t.chain.txs.size;
      await t.db.query(`update chain_txs set next_attempt_at = now() where id = $1`, [tx.id]);
      await t.http.post(`${V}/admin/chain/process`).set(ops.auth).expect(200);
      expect((await t.db.query(`select status from chain_txs where id = $1`, [tx.id])).rows[0].status).toBe("confirmed");
      expect(t.chain.txs.size).toBe(sends);
    } finally {
      t.chain.autoConfirm = true;
    }
  });
});
