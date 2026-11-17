import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, staff, approvedOrg, verifiedAccount, addMember, stepUp, Session } from "./helpers.js";

let t: TestApp;
let fin: Session; // finance officer
let fin2: Session; // second finance officer
let fm: Session; // fund manager
let finFm: Session; // holds finance + fund manager (maker–checker test)
let co: Session; // compliance
beforeAll(async () => {
  t = await makeApp();
  fin = await staff(t, "09355550001", "finance_officer", "auditor");
  fin2 = await staff(t, "09355550002", "finance_officer");
  fm = await staff(t, "09355550003", "fund_manager");
  finFm = await staff(t, "09355550004", "finance_officer", "fund_manager");
  co = await staff(t, "09355550005", "compliance_officer", "super_admin");
});
afterAll(async () => t.close());

const V = "/api/v1";
const B = 1_000_000_000n; // 1 billion rials

/** Approved company with a verified account past its cooling-off, and `amount` credited from a real deposit. */
async function funded(n: number, amount: bigint, bban = `01700000000000000000${String(n).padStart(2, "0")}`) {
  const a = await approvedOrg(t, n, { compliance: co });
  const acct = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, bban);
  await t.db.query(`update bank_accounts set withdraw_enabled_at = now() - interval '1 minute' where id = $1`, [acct.id]);
  const ins = await t.http.get(`${V}/deposit-instructions`).set(a.admin.auth).set(a.org).expect(200);
  t.cobank.deposit({ payId: ins.body.payment_id, amount, sourceIban: acct.iban });
  await t.http.post(`${V}/admin/deposits/poll`).set(fin.auth).expect(200);
  return { ...a, acct };
}
const bal = async (s: Session, org: any) => (await t.http.get(`${V}/balances`).set(s.auth).set(org).expect(200)).body;
const request = (s: Session, org: any, accountId: string, amount: bigint) =>
  t.http.post(`${V}/withdrawals`).set(s.auth).set(org).set(idem()).send({ bank_account_id: accountId, amount: amount.toString() });
async function orgApprove(s: Session, orgId: string, id: string) {
  const path = `${V}/withdrawals/${id}/approve`;
  const su = await stepUp(t, s, "POST", path, {});
  return t.http.post(path).set(s.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send({});
}
async function staffStepUp(s: Session, action: string, id: string) {
  const path = `${V}/admin/withdrawals/${id}/${action}`;
  const su = await stepUp(t, s, "POST", path, {});
  return t.http.post(path).set(s.auth).set({ "x-step-up-token": su }).send({});
}
const poll = () => t.http.post(`${V}/admin/withdrawals/poll`).set(fin.auth).expect(200);

describe("withdrawals", () => {
  it("runs request → org approval → finance → sent → completed, with the ledger following every step", async () => {
    const a = await funded(71, 5n * B);
    const prep = await addMember(t, a.admin, a.orgId, "09125550071", "preparer");
    const appr = await addMember(t, a.admin, a.orgId, "09125550171", "approver");

    const r = await request(prep, a.org, a.acct.id, 2n * B);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("requested");
    expect(await bal(a.admin, a.org)).toMatchObject({ available: String(3n * B), withdrawal_hold: String(2n * B) });

    // the requester cannot approve; the approver can
    expect((await t.http.post(`${V}/withdrawals/${r.body.id}/approve`).set(prep.auth).set(a.org).set(idem()).send({})).status).toBe(403);
    expect((await orgApprove(appr, a.orgId, r.body.id)).body.status).toBe("org_approved");

    const tasks = await t.http.get(`${V}/admin/tasks`).set(fin.auth).expect(200);
    expect(tasks.body.some((x: any) => x.linked_id === r.body.id && x.workflow_key === "withdrawal.finance")).toBe(true);
    const q = await t.http.post(`${V}/admin/withdrawals/${r.body.id}/queue`).set(fin.auth).expect(200);
    expect(q.body.needs_fund_approval).toBe(false);
    const sent = await staffStepUp(fin, "send", r.body.id);
    expect(sent.body).toMatchObject({ status: "sent", transfer_type: "RTGS" }); // other bank, ≥ Satna threshold
    const settlement = t.cobank.settlements.get(r.body.id)!;
    expect(settlement.req).toMatchObject({ destinationIban: a.acct.iban, amount: 2n * B, transferReason: "MODIRIAT_NAGHDINEGI" });

    await poll(); // still RECEIVED at Jibit
    expect((await t.http.get(`${V}/withdrawals/${r.body.id}`).set(a.admin.auth).set(a.org).expect(200)).body.status).toBe("sent");
    t.cobank.setSettlement(r.body.id, "TRANSFERRED");
    const p = await poll();
    expect(p.body.completed).toBe(1);
    const done = await t.http.get(`${V}/withdrawals/${r.body.id}`).set(a.admin.auth).set(a.org).expect(200);
    expect(done.body.status).toBe("completed");
    expect(done.body.bank_reference).toMatch(/^BR/);
    expect(await bal(a.admin, a.org)).toMatchObject({ available: String(3n * B), withdrawal_hold: "0", total: String(3n * B) });
    const n = await t.http.get(`${V}/notifications`).set(a.admin.auth).expect(200);
    expect(n.body.items.some((x: any) => x.event_key === "withdrawal.completed")).toBe(true);
    const tb = await t.http.get(`${V}/admin/ledger/trial-balance`).set(fin.auth).expect(200);
    expect(tb.body.balanced).toBe(true);
  });

  it("refuses unsafe requests: cooling-off, overdraw, self-approval, wrong account", async () => {
    const a = await funded(72, 1n * B);
    await addMember(t, a.admin, a.orgId, "09125550072", "viewer"); // two members → no single-user mode
    expect((await request(a.admin, a.org, a.acct.id, 2n * B)).body.error.code).toBe("INSUFFICIENT_BALANCE");
    const r = await request(a.admin, a.org, a.acct.id, 1n * B);
    expect((await orgApprove(a.admin, a.orgId, r.body.id)).body.error.code).toBe("MAKER_CHECKER");
    expect((await request(a.admin, a.org, a.acct.id, 1n)).body.error.code).toBe("INSUFFICIENT_BALANCE"); // all of it is on hold

    const b = await funded(73, 1n * B);
    expect((await request(b.admin, b.org, a.acct.id, 1000n)).body.error.code).toBe("ACCOUNT_NOT_ELIGIBLE"); // someone else's account
    await t.db.query(`update bank_accounts set withdraw_enabled_at = now() + interval '5 hours' where id = $1`, [b.acct.id]);
    expect((await request(b.admin, b.org, b.acct.id, 1000n)).body.error.code).toBe("ACCOUNT_COOLING_OFF");
  });

  it("needs the fund manager at or above the threshold, and a different person from finance", async () => {
    const a = await funded(74, 20n * B, "0000000000000000000074"); // same bank as the collection account
    const r = await request(a.admin, a.org, a.acct.id, 12n * B);
    expect((await orgApprove(a.admin, a.orgId, r.body.id)).body.single_user).toBe(true); // single-user org
    await t.http.post(`${V}/admin/withdrawals/${r.body.id}/queue`).set(finFm.auth).expect(200);
    expect((await staffStepUp(fin, "send", r.body.id)).body.error.code).toBe("FUND_APPROVAL_REQUIRED");
    expect((await staffStepUp(finFm, "fund-approve", r.body.id)).body.error.code).toBe("MAKER_CHECKER");
    expect((await staffStepUp(fm, "fund-approve", r.body.id)).body.status).toBe("internal_approved");
    const s = await staffStepUp(fin2, "send", r.body.id);
    expect(s.body).toMatchObject({ status: "sent", transfer_type: "NORMAL" });
  });

  it("returns the money when Jibit fails it, finance rejects it, or the org cancels in time", async () => {
    const a = await funded(75, 9n * B);
    const w1 = await request(a.admin, a.org, a.acct.id, 1n * B);
    await orgApprove(a.admin, a.orgId, w1.body.id);
    await t.http.post(`${V}/admin/withdrawals/${w1.body.id}/queue`).set(fin.auth).expect(200);
    await staffStepUp(fin, "send", w1.body.id);
    t.cobank.setSettlement(w1.body.id, "FAILED", "BANK_DESTINATION_ACCOUNT_DORMANT");
    expect((await poll()).body.failed).toBe(1);
    const f = await t.http.get(`${V}/withdrawals/${w1.body.id}`).set(a.admin.auth).set(a.org).expect(200);
    expect(f.body).toMatchObject({ status: "failed", fail_reason: "BANK_DESTINATION_ACCOUNT_DORMANT" });

    const w2 = await request(a.admin, a.org, a.acct.id, 2n * B);
    await orgApprove(a.admin, a.orgId, w2.body.id);
    const rej = await t.http.post(`${V}/admin/withdrawals/${w2.body.id}/reject`).set(fin.auth).send({ reason: "مغایرت در مدارک" }).expect(200);
    expect(rej.body).toMatchObject({ status: "cancelled", closed_reason: "مغایرت در مدارک" });

    const w3 = await request(a.admin, a.org, a.acct.id, 3n * B);
    await t.http.post(`${V}/withdrawals/${w3.body.id}/cancel`).set(a.admin.auth).set(a.org).send({ reason: "اشتباه در مبلغ" }).expect(200);

    const w4 = await request(a.admin, a.org, a.acct.id, 1n * B);
    await orgApprove(a.admin, a.orgId, w4.body.id);
    await t.http.post(`${V}/admin/withdrawals/${w4.body.id}/queue`).set(fin.auth).expect(200);
    const late = await t.http.post(`${V}/withdrawals/${w4.body.id}/cancel`).set(a.admin.auth).set(a.org).send({ reason: "دیر" });
    expect(late.body.error.code).toBe("ILLEGAL_TRANSITION");

    expect(await bal(a.admin, a.org)).toMatchObject({ available: String(8n * B), withdrawal_hold: String(1n * B) });
  });

  it("respects the transfer limit and never sends twice when Jibit's response is lost", async () => {
    const a = await funded(76, 9n * B);
    const w = await request(a.admin, a.org, a.acct.id, 2n * B);
    await orgApprove(a.admin, a.orgId, w.body.id);
    await t.http.post(`${V}/admin/withdrawals/${w.body.id}/queue`).set(fin.auth).expect(200);

    const saved = { ...t.cobank.limits };
    t.cobank.limits.dailyRemaining = 1n * B;
    const lim = await staffStepUp(fin, "send", w.body.id);
    expect(lim.body.error.code).toBe("TRANSFER_LIMIT");
    expect(t.cobank.settlements.has(w.body.id)).toBe(false);
    t.cobank.limits = saved;

    t.cobank.loseNextSettlementResponse = true; // Jibit creates it, but the answer never reaches us
    const s = await staffStepUp(fin, "send", w.body.id);
    expect(s.body.status).toBe("sent");
    expect([...t.cobank.settlements.keys()].filter((k) => k === w.body.id)).toHaveLength(1);
  });

  it("credits the org back when the bank reverts a completed transfer", async () => {
    const a = await funded(77, 3n * B);
    const w = await request(a.admin, a.org, a.acct.id, 1n * B);
    await orgApprove(a.admin, a.orgId, w.body.id);
    await t.http.post(`${V}/admin/withdrawals/${w.body.id}/queue`).set(fin.auth).expect(200);
    await staffStepUp(fin, "send", w.body.id);
    t.cobank.setSettlement(w.body.id, "TRANSFERRED");
    await poll();
    expect((await bal(a.admin, a.org)).available).toBe(String(2n * B));
    t.cobank.setSettlement(w.body.id, "TRANSFERRED_REVERTED");
    expect((await poll()).body.reverted).toBe(1);
    expect((await bal(a.admin, a.org)).available).toBe(String(3n * B));
    const tasks = await t.http.get(`${V}/admin/tasks`).set(co.auth).expect(200);
    expect(tasks.body.some((x: any) => x.linked_id === w.body.id && x.workflow_key === "withdrawal.reverted")).toBe(true);
    expect((await t.http.get(`${V}/admin/ledger/trial-balance`).set(fin.auth).expect(200)).body.balanced).toBe(true);
  });

  it("keeps staff away from their own org and stays off when the switch is off", async () => {
    const a = await funded(78, 2n * B);
    const w = await request(a.admin, a.org, a.acct.id, 1n * B);
    await orgApprove(a.admin, a.orgId, w.body.id);
    const insider = await staff(t, "09125550078", "finance_officer");
    await addMember(t, a.admin, a.orgId, "09125550078", "viewer");
    expect((await t.http.post(`${V}/admin/withdrawals/${w.body.id}/queue`).set(insider.auth)).body.error.code).toBe("CONFLICT_OF_INTEREST");

    const off = await makeApp({ withdrawals: { ...t.config.withdrawals, enabled: false } });
    try {
      const { orgWithAdmin } = await import("./helpers.js");
      const o = await orgWithAdmin(off, "09125550079", "055500079", "5550000079");
      const r = await off.http.post(`${V}/withdrawals`).set(o.admin.auth).set(o.org).set(idem()).send({ bank_account_id: a.acct.id, amount: "1000" });
      expect(r.body.error.code).toBe("FEATURE_DISABLED");
    } finally {
      await off.close();
    }
  });
});
