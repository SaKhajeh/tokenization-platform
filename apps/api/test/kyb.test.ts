import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import {
  makeApp, TestApp, orgWithAdmin, nationalCode, legalId, stepUp, idem, staff, approvedOrg, KYB_FIELDS, addMember,
} from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => t.close());

const V = "/api/v1";

async function submit(s: any, orgId: string, body: any) {
  const su = await stepUp(t, s, "POST", `${V}/kyb/submit`, body);
  return t.http.post(`${V}/kyb/submit`).set(s.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send(body);
}

async function uploadedDoc(s: any, orgId: string) {
  const o = { "x-org-id": orgId };
  const up = await t.http.post(`${V}/documents/upload-url`).set(s.auth).set(o).set(idem()).send({ category: "authority_letter", filename: "letter.pdf", mime: "application/pdf", size: 900 }).expect(201);
  t.storage.put(`orgs/${orgId}/${up.body.document_id}`, 900);
  await t.http.post(`${V}/documents/${up.body.document_id}/complete`).set(s.auth).set(o).send({ sha256: "c".repeat(64) }).expect(200);
  return up.body.document_id as string;
}

describe("KYB — registry and submission", () => {
  it("fetches the official record and recognises the admin as CEO, without leaking national codes", async () => {
    const { admin, orgId, org } = await orgWithAdmin(t, "09121110001", "011100001", "1111000001", "شرکت الف");
    t.registry.companies.set(legalId("1111000001"), {
      name: "شرکت الف",
      people: [
        { nationalCode: nationalCode("011100001"), name: "علی مدیر", position: "مدیرعامل", roles: ["ceo"] },
        { nationalCode: "0000000000", name: "عضو هیئت‌مدیره", position: "عضو", roles: ["board"] },
      ],
    });
    const r = await t.http.post(`${V}/kyb/registry`).set(admin.auth).set(org).expect(200);
    expect(r.body.you_are_listed).toBe(true);
    expect(r.body.snapshot.name).toBe("شرکت الف");
    expect(JSON.stringify(r.body)).not.toContain(nationalCode("011100001"));
    expect(r.body.snapshot.people).toHaveLength(2);
    // second call within a day reuses the snapshot (inquiries are billed)
    const before = t.registry.calls.length;
    await t.http.post(`${V}/kyb/registry`).set(admin.auth).set(org).expect(200);
    expect(t.registry.calls.length).toBe(before);
    const s = await submit(admin, orgId, { snapshot_id: r.body.snapshot.id, fields: KYB_FIELDS });
    expect(s.status).toBe(201);
    expect(s.body.authority_basis).toBe("registry");
    expect(s.body.risk_flags).toEqual([]);
    const cur = await t.http.get(`${V}/kyb`).set(admin.auth).set(org).expect(200);
    expect(cur.body.kyb_status).toBe("in_review");
  });

  it("rejects companies that are not in the registry", async () => {
    const { admin, org } = await orgWithAdmin(t, "09121110002", "011100002", "9911000002");
    const r = await t.http.post(`${V}/kyb/registry`).set(admin.auth).set(org);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("NOT_IN_REGISTRY");
  });

  it("needs an introduction letter when the submitter is not CEO or board member, and flags risks", async () => {
    const { admin, orgId, org } = await orgWithAdmin(t, "09121110003", "011100003", "1111000003", "شرکت ب");
    t.registry.companies.set(legalId("1111000003"), { name: "شرکت دیگر", suspended: true, state: "منحل" });
    t.registry.bounced.set(legalId("1111000003"), 2);
    const reg = await t.http.post(`${V}/kyb/registry`).set(admin.auth).set(org).expect(200);
    expect(reg.body.you_are_listed).toBe(false);
    const body = { snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS };
    const r1 = await submit(admin, orgId, body);
    expect(r1.body.error.code).toBe("AUTHORITY_DOCUMENT_REQUIRED");
    const doc = await uploadedDoc(admin, orgId);
    const r2 = await submit(admin, orgId, { ...body, authority_doc_id: doc });
    expect(r2.status).toBe(201);
    expect(r2.body.authority_basis).toBe("document");
    expect(r2.body.risk_flags).toEqual(
      expect.arrayContaining(["registry_state_not_active", "suspended", "name_differs_from_registry", "bounced_cheques", "authority_by_document"]),
    );
    const again = await submit(admin, orgId, { ...body, authority_doc_id: doc });
    expect(again.body.error.code).toBe("KYB_IN_REVIEW");
  });

  it("only org admins with a verified national code can submit, with step-up", async () => {
    const { admin, orgId, org } = await orgWithAdmin(t, "09121110004", "011100004", "1111000004");
    const viewer = await addMember(t, admin, orgId, "09121110005", "viewer");
    expect((await t.http.post(`${V}/kyb/registry`).set(viewer.auth).set(org)).status).toBe(403);
    const reg = await t.http.post(`${V}/kyb/registry`).set(admin.auth).set(org).expect(200);
    const noStepUp = await t.http.post(`${V}/kyb/submit`).set(admin.auth).set(org).set(idem()).send({ snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS });
    expect(noStepUp.body.error.code).toBe("STEP_UP_REQUIRED");
  });
});

describe("KYB — compliance review, wallet and digital ID", () => {
  it("approval creates a custodial wallet, a payment ID and queues the on-chain registration", async () => {
    const { admin, org, orgId, caseId, reviewer } = await approvedOrg(t, 1);
    const cur = await t.http.get(`${V}/kyb`).set(admin.auth).set(org).expect(200);
    expect(cur.body.kyb_status).toBe("approved");
    expect(new Date(cur.body.kyb_expires_at).getTime()).toBeGreaterThan(Date.now() + 360 * 86400_000);

    const w = await t.http.get(`${V}/wallet`).set(admin.auth).set(org).expect(200);
    expect(w.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(w.body.registry_status).toBe("pending");
    expect(w.body.registration_tx.status).toBe("queued");

    const o = (await t.db.query(`select deposit_id from orgs where id = $1`, [orgId])).rows[0] as any;
    expect(o.deposit_id).toMatch(/^\d{10}$/);

    // the review task is closed
    const tasks = await t.http.get(`${V}/admin/tasks`).set(reviewer.auth).expect(200);
    expect(tasks.body.find((x: any) => x.linked_id === caseId)).toBeUndefined();

    // worker: send, confirm → registered on-chain
    const officer = await staff(t, "09351110001", "tokenisation_officer");
    const p = await t.http.post(`${V}/admin/chain/process`).set(officer.auth).expect(200);
    expect(p.body.sent).toBeGreaterThanOrEqual(1);
    await t.http.post(`${V}/admin/chain/process`).set(officer.auth).expect(200);
    const w2 = await t.http.get(`${V}/wallet`).set(admin.auth).set(org).expect(200);
    expect(w2.body.registry_status).toBe("registered");
    const onchain = await t.chain.identity(w.body.address);
    expect(onchain?.exists).toBe(true);
    const stored = t.chain.identities.get(getAddress(w.body.address))!;
    expect(stored.flags).toBe(1); // investor
    expect(stored.orgIdHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("derives a different address per org and never stores private keys", async () => {
    const a = await approvedOrg(t, 2);
    const b = await approvedOrg(t, 3);
    const wa = await t.http.get(`${V}/wallet`).set(a.admin.auth).set(a.org).expect(200);
    const wb = await t.http.get(`${V}/wallet`).set(b.admin.auth).set(b.org).expect(200);
    expect(wa.body.address).not.toBe(wb.body.address);
    const cols = await t.db.query(`select column_name from information_schema.columns where table_name = 'wallets'`);
    expect(cols.rows.map((c: any) => c.column_name).join(",")).not.toMatch(/key|secret|private|mnemonic/);
  });

  it("enforces reviewer rules: staff only, no conflict of interest, reasons for rejection", async () => {
    const { admin, orgId, org } = await orgWithAdmin(t, "09121110010", "011100010", "1111000010");
    const reg = await t.http.post(`${V}/kyb/registry`).set(admin.auth).set(org).expect(200);
    const doc = await uploadedDoc(admin, orgId);
    const sub = await submit(admin, orgId, { snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS, authority_doc_id: doc });
    const path = `${V}/admin/kyb/${sub.body.id}/decision`;

    expect((await t.http.post(path).set(admin.auth).send({ decision: "approve" })).status).toBe(403);
    // a compliance officer who is also a member of the org
    const insider = await staff(t, "09121110011", "compliance_officer");
    await addMember(t, admin, orgId, "09121110011", "viewer");
    const ins = await t.http.post(path).set(insider.auth).send({ decision: "approve" });
    expect(ins.body.error.code).toBe("CONFLICT_OF_INTEREST");

    const co = await staff(t, "09351110002", "compliance_officer");
    const detail = await t.http.get(`${V}/admin/kyb/${sub.body.id}`).set(co.auth).expect(200);
    expect(detail.body.authority_basis).toBe("document");
    expect(detail.body.registry.people).toBeDefined();
    const noReason = await t.http.post(path).set(co.auth).send({ decision: "request_info" });
    expect(noReason.body.error.code).toBe("REASON_REQUIRED");
    await t.http.post(path).set(co.auth).send({ decision: "request_info", reason: "معرفی‌نامه مهر شرکت ندارد" }).expect(200);
    const cur = await t.http.get(`${V}/kyb`).set(admin.auth).set(org).expect(200);
    expect(cur.body.kyb_status).toBe("info_requested");
    expect(cur.body.case.decision_reason).toContain("مهر");

    // resubmission creates version 2
    const sub2 = await submit(admin, orgId, { snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS, authority_doc_id: doc });
    expect(sub2.body.version).toBe(2);
    await t.http.post(`${V}/admin/kyb/${sub2.body.id}/decision`).set(co.auth).send({ decision: "reject", reason: "مدارک ناکافی" }).expect(200);
    const after = await t.http.post(`${V}/admin/kyb/${sub2.body.id}/decision`).set(co.auth).send({ decision: "approve" });
    expect(after.body.error.code).toBe("KYB_NOT_IN_REVIEW");
    expect((await t.http.get(`${V}/wallet`).set(admin.auth).set(org)).status).toBe(404); // no wallet without approval
  });
});

describe("chain outbox", () => {
  it("retries a failed send with backoff and does not re-send what is already on-chain", async () => {
    const officer = await staff(t, "09351110003", "tokenisation_officer");
    await t.http.post(`${V}/admin/chain/process`).set(officer.auth).expect(200); // drain earlier queue

    const { admin, org } = await approvedOrg(t, 4);
    t.chain.failNextSend = 1;
    const p1 = await t.http.post(`${V}/admin/chain/process`).set(officer.auth).expect(200);
    expect(p1.body.retried).toBe(1);
    const queued = await t.http.get(`${V}/admin/chain/txs?status=queued`).set(officer.auth).expect(200);
    expect(queued.body[0].last_error).toContain("RPC endpoints failed");
    expect(new Date(queued.body[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now()); // backoff
    // nothing happens before the backoff time
    const p2 = await t.http.post(`${V}/admin/chain/process`).set(officer.auth).expect(200);
    expect(p2.body.sent).toBe(0);

    // meanwhile someone registered it by hand: the worker must notice, not send again
    const w = await t.http.get(`${V}/wallet`).set(admin.auth).set(org).expect(200);
    await t.chain.send({ kind: "register_identity", wallet: w.body.address, orgIdHash: "0x" + "1".repeat(64), flags: 1, kybHash: "0x" + "2".repeat(64), expiry: 9999999999 });
    const sentBefore = t.chain.txs.size;
    await t.db.query(`update chain_txs set next_attempt_at = now() where status = 'queued'`);
    const p3 = await t.http.post(`${V}/admin/chain/process`).set(officer.auth).expect(200);
    expect(p3.body.confirmed).toBe(1);
    expect(t.chain.txs.size).toBe(sentBefore);
    const w2 = await t.http.get(`${V}/wallet`).set(admin.auth).set(org).expect(200);
    expect(w2.body.registry_status).toBe("registered");
  });
});
