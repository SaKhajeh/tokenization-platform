import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, orgWithAdmin, addMember, login } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => t.close());

const V = "/api/v1";

async function uploadedDoc(s: { auth: Record<string, string> }, orgId: string, size = 1234) {
  const up = await t.http
    .post(`${V}/documents/upload-url`)
    .set(s.auth)
    .set({ "x-org-id": orgId })
    .set(idem())
    .send({ category: "evidence", filename: "report.pdf", mime: "application/pdf", size })
    .expect(201);
  t.storage.put(`orgs/${orgId}/${up.body.document_id}`, size);
  await t.http.post(`${V}/documents/${up.body.document_id}/complete`).set(s.auth).set({ "x-org-id": orgId }).send({ sha256: "a".repeat(64) }).expect(200);
  return up.body.document_id as string;
}

describe("tasks", () => {
  it("assigns to a member or role, filters by scope, and enforces transitions", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000301", "003000010", "3010101010");
    const prep = await addMember(t, admin, orgId, "09120000302", "preparer");
    const o = { "x-org-id": orgId };

    const none = await t.http.post(`${V}/tasks`).set(admin.auth).set(o).set(idem()).send({ title: "بدون مسئول" });
    expect(none.body.error.code).toBe("ASSIGNEE_REQUIRED");

    const a = await t.http.post(`${V}/tasks`).set(admin.auth).set(o).set(idem()).send({ title: "تهیه گزارش", assignee_user_id: prep.userId, due_date: "2026-12-01" }).expect(201);
    await t.http.post(`${V}/tasks`).set(admin.auth).set(o).set(idem()).send({ title: "بررسی قرارداد", assignee_role: "preparer" }).expect(201);

    const mine = await t.http.get(`${V}/tasks?scope=mine`).set(prep.auth).set(o).expect(200);
    expect(mine.body.map((x: any) => x.title)).toEqual(["تهیه گزارش"]);
    const role = await t.http.get(`${V}/tasks?scope=role`).set(prep.auth).set(o).expect(200);
    expect(role.body.map((x: any) => x.title)).toEqual(["بررسی قرارداد"]);
    const created = await t.http.get(`${V}/tasks?scope=created`).set(admin.auth).set(o).expect(200);
    expect(created.body).toHaveLength(2);

    await t.http.patch(`${V}/tasks/${a.body.id}`).set(prep.auth).set(o).send({ status: "in_progress" }).expect(200);
    await t.http.patch(`${V}/tasks/${a.body.id}`).set(prep.auth).set(o).send({ status: "done" }).expect(200);
    const back = await t.http.patch(`${V}/tasks/${a.body.id}`).set(prep.auth).set(o).send({ status: "open" });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("forbids viewers from creating tasks and outsiders from assignment", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000303", "003000020", "3020202020");
    const viewer = await addMember(t, admin, orgId, "09120000304", "viewer");
    const outsider = await login(t, "09120000305");
    const o = { "x-org-id": orgId };
    const r1 = await t.http.post(`${V}/tasks`).set(viewer.auth).set(o).set(idem()).send({ title: "کار", assignee_role: "preparer" });
    expect(r1.status).toBe(403);
    const r2 = await t.http.post(`${V}/tasks`).set(admin.auth).set(o).set(idem()).send({ title: "کار", assignee_user_id: outsider.userId });
    expect(r2.body.error.code).toBe("ASSIGNEE_NOT_MEMBER");
  });

  it("keeps tasks inside their org", async () => {
    const A = await orgWithAdmin(t, "09120000306", "003000030", "3030303030");
    const B = await orgWithAdmin(t, "09120000307", "003000040", "3040404040");
    const task = await t.http.post(`${V}/tasks`).set(A.admin.auth).set(A.org).set(idem()).send({ title: "محرمانه", assignee_role: "org_admin" }).expect(201);
    // B's admin, using B's org header, cannot read A's task.
    const r = await t.http.get(`${V}/tasks/${task.body.id}`).set(B.admin.auth).set(B.org);
    expect(r.status).toBe(404);
    // ...nor by pointing the header at A.
    const r2 = await t.http.get(`${V}/tasks/${task.body.id}`).set(B.admin.auth).set(A.org);
    expect(r2.status).toBe(404);
  });

  it("accepts comments with this org's uploaded documents only", async () => {
    const A = await orgWithAdmin(t, "09120000308", "003000050", "3050505050");
    const B = await orgWithAdmin(t, "09120000309", "003000060", "3060606060");
    const task = await t.http.post(`${V}/tasks`).set(A.admin.auth).set(A.org).set(idem()).send({ title: "پیوست", assignee_role: "org_admin" }).expect(201);
    const docA = await uploadedDoc(A.admin, A.orgId);
    const docB = await uploadedDoc(B.admin, B.orgId);
    await t.http.post(`${V}/tasks/${task.body.id}/comments`).set(A.admin.auth).set(A.org).set(idem()).send({ body: "سند پیوست شد", attachment_doc_ids: [docA] }).expect(201);
    const bad = await t.http.post(`${V}/tasks/${task.body.id}/comments`).set(A.admin.auth).set(A.org).set(idem()).send({ body: "سند دیگران", attachment_doc_ids: [docB] });
    expect(bad.body.error.code).toBe("ATTACHMENT_INVALID");
    const list = await t.http.get(`${V}/tasks/${task.body.id}/comments`).set(A.admin.auth).set(A.org).expect(200);
    expect(list.body).toHaveLength(1);
  });
});

describe("documents", () => {
  it("validates type and size, and requires the object before completing", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000401", "004000010", "4010101010");
    const o = { "x-org-id": orgId };
    const exe = await t.http.post(`${V}/documents/upload-url`).set(admin.auth).set(o).set(idem()).send({ category: "other", filename: "x.exe", mime: "application/x-msdownload", size: 10 });
    expect(exe.body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");
    const big = await t.http.post(`${V}/documents/upload-url`).set(admin.auth).set(o).set(idem()).send({ category: "other", filename: "x.pdf", mime: "application/pdf", size: 50 * 1024 * 1024 });
    expect(big.body.error.code).toBe("FILE_TOO_LARGE");

    const up = await t.http.post(`${V}/documents/upload-url`).set(admin.auth).set(o).set(idem()).send({ category: "contract", filename: "c.pdf", mime: "application/pdf", size: 500 }).expect(201);
    const id = up.body.document_id;
    const early = await t.http.post(`${V}/documents/${id}/complete`).set(admin.auth).set(o).send({ sha256: "b".repeat(64) });
    expect(early.body.error.code).toBe("UPLOAD_NOT_FOUND");
    t.storage.put(`orgs/${orgId}/${id}`, 499);
    const mismatch = await t.http.post(`${V}/documents/${id}/complete`).set(admin.auth).set(o).send({ sha256: "b".repeat(64) });
    expect(mismatch.body.error.code).toBe("UPLOAD_SIZE_MISMATCH");
    t.storage.put(`orgs/${orgId}/${id}`, 500);
    await t.http.post(`${V}/documents/${id}/complete`).set(admin.auth).set(o).send({ sha256: "b".repeat(64) }).expect(200);
    const list = await t.http.get(`${V}/documents`).set(admin.auth).set(o).expect(200);
    expect(list.body.map((d: any) => d.id)).toContain(id);
  });

  it("lets members download, logs it, and hides documents from outsiders", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000402", "004000020", "4020202020");
    const viewer = await addMember(t, admin, orgId, "09120000403", "viewer");
    const outsider = await login(t, "09120000404");
    const id = await uploadedDoc(admin, orgId);

    const dl = await t.http.get(`${V}/documents/${id}/download`).set(viewer.auth).expect(200);
    expect(dl.body.url).toContain(id);
    const log = await t.db.query(`select user_id from document_access_log where document_id = $1`, [id]);
    expect(log.rows.map((r: any) => r.user_id)).toEqual([viewer.userId]);

    expect((await t.http.get(`${V}/documents/${id}`).set(outsider.auth)).status).toBe(404);
    expect((await t.http.get(`${V}/documents/${id}/download`).set(outsider.auth)).status).toBe(404);
  });

  it("forbids viewers from uploading", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000405", "004000030", "4030303030");
    const viewer = await addMember(t, admin, orgId, "09120000406", "viewer");
    const r = await t.http.post(`${V}/documents/upload-url`).set(viewer.auth).set({ "x-org-id": orgId }).set(idem()).send({ category: "other", filename: "a.pdf", mime: "application/pdf", size: 10 });
    expect(r.status).toBe(403);
  });
});
