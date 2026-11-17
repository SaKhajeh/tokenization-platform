import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, orgWithAdmin, stepUp, idem, staff, approvedOrg, verifiedAccount, iban, addMember, Session } from "./helpers.js";

let t: TestApp;
let co: Session; // compliance officer
let fin: Session; // finance officer
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09352220001", "compliance_officer");
  fin = await staff(t, "09352220002", "finance_officer", "auditor");
});
afterAll(async () => t.close());

const V = "/api/v1";

async function addIban(s: Session, orgId: string, value: string) {
  const body = { iban: value };
  const su = await stepUp(t, s, "POST", `${V}/bank-accounts`, body);
  return t.http.post(`${V}/bank-accounts`).set(s.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send(body);
}
const poll = () => t.http.post(`${V}/admin/deposits/poll`).set(fin.auth).expect(200);
const balances = async (s: Session, org: any) => (await t.http.get(`${V}/balances`).set(s.auth).set(org).expect(200)).body;

describe("bank accounts", () => {
  it("verifies a matching IBAN automatically, with a cooling-off before withdrawals", async () => {
    const a = await approvedOrg(t, 21, { compliance: co });
    const { id, iban: i } = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000021");
    const list = await t.http.get(`${V}/bank-accounts`).set(a.admin.auth).set(a.org).expect(200);
    const acct = list.body.find((x: any) => x.id === id);
    expect(acct.status).toBe("verified");
    expect(acct.is_default).toBe(true);
    expect(acct.iban).toBe(i);
    const wait = new Date(acct.withdraw_enabled_at).getTime() - Date.now();
    expect(wait).toBeGreaterThan(23 * 3600_000);
  });

  it("rejects bad, unknown, inactive and already-used IBANs", async () => {
    const a = await approvedOrg(t, 22, { compliance: co });
    expect((await addIban(a.admin, a.orgId, "IR000000000000000000000000")).body.error.code).toBe("IBAN_INVALID");
    expect((await addIban(a.admin, a.orgId, iban("0170000000000000000099"))).body.error.code).toBe("IBAN_NOT_FOUND");
    const blocked = iban("0170000000000000000098");
    t.registry.ibans.set(blocked, { legalId: a.nationalId, status: "BLOCK_WITH_DEPOSIT" });
    expect((await addIban(a.admin, a.orgId, blocked)).body.error.code).toBe("IBAN_NOT_ACTIVE");
    // Persian digits and spaces are accepted
    const { iban: used } = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000022");
    const b = await approvedOrg(t, 23, { compliance: co });
    const r = await addIban(b.admin, b.orgId, used);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("IBAN_IN_USE");
  });

  it("sends a non-matching IBAN to compliance review", async () => {
    const a = await approvedOrg(t, 24, { compliance: co });
    const other = iban("0170000000000000000024");
    t.registry.ibans.set(other, { legalId: "10000000000", owners: ["شخص دیگر"] });
    const r = await addIban(a.admin, a.orgId, other.replace(/(\d{4})/g, "$1 ").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("pending_review");
    expect(r.body.is_default).toBe(false);
    const pending = await t.http.get(`${V}/admin/bank-accounts/pending`).set(co.auth).expect(200);
    expect(pending.body.map((x: any) => x.id)).toContain(r.body.id);
    const tasks = await t.http.get(`${V}/admin/tasks`).set(co.auth).expect(200);
    expect(tasks.body.some((x: any) => x.linked_id === r.body.id)).toBe(true);
    const ok = await t.http.post(`${V}/admin/bank-accounts/${r.body.id}/review`).set(co.auth).send({ approved: true, reason: "نام تجاری قدیمی شرکت" }).expect(200);
    expect(ok.body.status).toBe("verified");
    expect(ok.body.is_default).toBe(true);
  });

  it("removing needs step-up; viewers cannot add", async () => {
    const a = await approvedOrg(t, 25, { compliance: co });
    const { id } = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000025");
    const viewer = await addMember(t, a.admin, a.orgId, "09122220025", "viewer");
    expect((await t.http.post(`${V}/bank-accounts`).set(viewer.auth).set(a.org).set(idem()).send({ iban: iban("0170000000000000000125") })).status).toBe(403);
    const no = await t.http.delete(`${V}/bank-accounts/${id}`).set(a.admin.auth).set(a.org);
    expect(no.body.error.code).toBe("STEP_UP_REQUIRED");
    const su = await stepUp(t, a.admin, "DELETE", `${V}/bank-accounts/${id}`, {});
    await t.http.delete(`${V}/bank-accounts/${id}`).set(a.admin.auth).set({ ...a.org, "x-step-up-token": su }).expect(200);
    const list = await t.http.get(`${V}/bank-accounts`).set(a.admin.auth).set(a.org).expect(200);
    expect(list.body).toHaveLength(0);
  });
});

describe("deposits through Cobank", () => {
  it("needs approved KYB for deposit instructions", async () => {
    const { admin, org } = await orgWithAdmin(t, "09122220030", "022200030", "2222000030");
    const r = await t.http.get(`${V}/deposit-instructions`).set(admin.auth).set(org);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("KYB_REQUIRED");
  });

  it("credits a deposit from a verified account, holds others, refunds unknown payment IDs", async () => {
    const a = await approvedOrg(t, 31, { compliance: co });
    const { iban: src } = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000031");
    const ins = await t.http.get(`${V}/deposit-instructions`).set(a.admin.auth).set(a.org).expect(200);
    expect(ins.body.payment_id).toMatch(/^\d{10}$/);
    expect(ins.body.collection_iban).toBe(t.config.collection.iban);
    expect(ins.body.allowed_source_accounts.map((x: any) => x.iban)).toEqual([src]);

    const good = t.cobank.deposit({ payId: ins.body.payment_id, amount: 500_000_000n, sourceIban: src });
    const strangerAcct = t.cobank.deposit({ payId: ins.body.payment_id, amount: 70_000_000n, sourceIban: iban("0170000000000000000999") });
    const kytFail = t.cobank.deposit({ payId: ins.body.payment_id, amount: 30_000_000n, sourceIban: src, kyt: "NOT_MATCH" });
    const unknown = t.cobank.deposit({ payId: "9999999999", amount: 10_000_000n, sourceIban: src });

    const p = await poll();
    expect(p.body).toMatchObject({ seen: 4, credited: 1, held: 2, refunded: 1 });
    expect(t.cobank.state(good)).toBe("VERIFIED");
    expect(t.cobank.state(strangerAcct)).toBe("TO_BE_DECIDED");
    expect(t.cobank.state(kytFail)).toBe("TO_BE_DECIDED");
    expect(t.cobank.state(unknown)).toBe("REFUNDED");

    const bal = await balances(a.admin, a.org);
    expect(bal.available).toBe("500000000");
    const st = await t.http.get(`${V}/ledger/statement`).set(a.admin.auth).set(a.org).expect(200);
    expect(st.body[0]).toMatchObject({ type: "deposit", amount: "500000000" });
    const deps = await t.http.get(`${V}/deposits`).set(a.admin.auth).set(a.org).expect(200);
    expect(deps.body.map((d: any) => d.status).sort()).toEqual(["credited", "suspense", "suspense"]);
    expect(deps.body[0].source_iban).toMatch(/^IR\d\d…\d{4}$/); // masked

    // polling again changes nothing
    const p2 = await poll();
    expect(p2.body.seen).toBe(0);
    expect((await balances(a.admin, a.org)).available).toBe("500000000");
  });

  it("finishes a decision after a Jibit outage without double-crediting", async () => {
    const a = await approvedOrg(t, 32, { compliance: co });
    const { iban: src } = await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000032");
    const ins = await t.http.get(`${V}/deposit-instructions`).set(a.admin.auth).set(a.org).expect(200);
    const ref = t.cobank.deposit({ payId: ins.body.payment_id, amount: 120_000_000n, sourceIban: src });
    t.cobank.failNextVerify = 1;
    const p1 = await poll();
    expect(p1.body.pending_retry).toBe(1);
    expect((await balances(a.admin, a.org)).available).toBe("0");
    const p2 = await poll();
    expect(p2.body.credited).toBe(1);
    expect(t.cobank.state(ref)).toBe("VERIFIED");
    await poll();
    expect((await balances(a.admin, a.org)).available).toBe("120000000");
  });

  it("compliance clears held deposits: credit to an org, or refund", async () => {
    const a = await approvedOrg(t, 33, { compliance: co });
    await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000033");
    const ins = await t.http.get(`${V}/deposit-instructions`).set(a.admin.auth).set(a.org).expect(200);
    const r1 = t.cobank.deposit({ payId: ins.body.payment_id, amount: 40_000_000n, sourceIban: iban("0170000000000000000933") });
    const r2 = t.cobank.deposit({ payId: ins.body.payment_id, amount: 15_000_000n, sourceIban: iban("0170000000000000000934") });
    await poll();
    const held = await t.http.get(`${V}/admin/deposits/lines?status=suspense`).set(co.auth).expect(200);
    const l1 = held.body.find((x: any) => x.jibit_reference_number === r1);
    const l2 = held.body.find((x: any) => x.jibit_reference_number === r2);
    expect(l1.decision_reason).toBe("source_account_not_verified");

    expect((await t.http.post(`${V}/admin/deposits/lines/${l1.id}/resolve`).set(fin.auth).send({ action: "credit", reason: "x" })).status).toBe(403);
    await t.http.post(`${V}/admin/deposits/lines/${l1.id}/resolve`).set(co.auth).send({ action: "credit", reason: "حساب شرکت مادر؛ نامه تأیید پیوست شد" }).expect(200);
    await t.http.post(`${V}/admin/deposits/lines/${l2.id}/resolve`).set(co.auth).send({ action: "refund", reason: "واریز اشتباه" }).expect(200);
    expect(t.cobank.state(r1)).toBe("VERIFIED");
    expect(t.cobank.state(r2)).toBe("REFUNDED");
    expect((await balances(a.admin, a.org)).available).toBe("40000000");
    const again = await t.http.post(`${V}/admin/deposits/lines/${l1.id}/resolve`).set(co.auth).send({ action: "refund", reason: "دوباره" });
    expect(again.body.error.code).toBe("NOT_IN_SUSPENSE");
  });

  it("keeps each org's money and accounts private", async () => {
    const a = await approvedOrg(t, 34, { compliance: co });
    const b = await approvedOrg(t, 35, { compliance: co });
    await verifiedAccount(t, a.admin, a.orgId, a.nationalId, "0170000000000000000034");
    expect((await t.http.get(`${V}/balances`).set(b.admin.auth).set(a.org)).status).toBe(404);
    expect((await t.http.get(`${V}/bank-accounts`).set(b.admin.auth).set(b.org).expect(200)).body).toHaveLength(0);
    expect((await t.http.get(`${V}/deposits`).set(b.admin.auth).set(a.org)).status).toBe(404);
  });
});

describe("ledger integrity", () => {
  it("balances overall, and the books match the money that arrived", async () => {
    const tb = await t.http.get(`${V}/admin/ledger/trial-balance`).set(fin.auth).expect(200);
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.signed_sum).toBe("0");
    const bank = tb.body.accounts.find((x: any) => x.kind === "collection_bank");
    const lines = await t.db.query(`select coalesce(sum(amount),0) as s from bank_statement_lines where status in ('credited','suspense')`);
    expect(bank.balance).toBe(String((lines.rows[0] as any).s));
  });

  it("the database refuses unbalanced entries, edits, deletes and overdrafts", async () => {
    const accts = (await t.db.query(`select id, kind from ledger_accounts where kind in ('collection_bank','org_available') order by kind limit 2`)).rows as any[];
    const bank = accts.find((x) => x.kind === "collection_bank").id;
    const avail = accts.find((x) => x.kind === "org_available").id;

    // unbalanced: rejected at commit
    await expect(
      t.db.tx(async (q) => {
        await q.query(`insert into journal_entries (id, entry_type, idempotency_key) values ('00000000-0000-7000-8000-000000000001', 'test', 'test-unbalanced')`);
        await q.query(`insert into journal_lines (entry_id, account_id, amount) values ('00000000-0000-7000-8000-000000000001', $1, 100)`, [bank]);
        await q.query(`insert into journal_lines (entry_id, account_id, amount) values ('00000000-0000-7000-8000-000000000001', $1, -99)`, [avail]);
      }),
    ).rejects.toThrow(/LEDGER_UNBALANCED/);

    // history cannot change
    await expect(t.db.query(`update journal_lines set amount = amount * 2`)).rejects.toThrow();
    await expect(t.db.query(`delete from journal_entries`)).rejects.toThrow();

    // org_available cannot go below zero (debit more than it holds)
    const bal = BigInt(((await t.db.query(`select balance from account_balances where account_id = $1`, [avail])).rows[0] as any).balance);
    const tooMuch = -bal + 1n;
    await expect(
      t.db.tx(async (q) => {
        await q.query(`insert into journal_entries (id, entry_type, idempotency_key) values ('00000000-0000-7000-8000-000000000002', 'test', 'test-overdraft')`);
        await q.query(`insert into journal_lines (entry_id, account_id, amount) values ('00000000-0000-7000-8000-000000000002', $1, $2)`, [avail, tooMuch.toString()]);
        await q.query(`insert into journal_lines (entry_id, account_id, amount) values ('00000000-0000-7000-8000-000000000002', $1, $2)`, [bank, (-tooMuch).toString()]);
      }),
    ).rejects.toThrow(/LEDGER_NEGATIVE_BALANCE/);
    const tb = await t.http.get(`${V}/admin/ledger/trial-balance`).set(fin.auth).expect(200);
    expect(tb.body.balanced).toBe(true);
  });
});
