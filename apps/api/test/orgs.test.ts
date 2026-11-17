import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, verifiedUser, login, legalId, idem, orgWithAdmin, addMember, stepUp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => t.close());

const V = "/api/v1";

describe("organisations", () => {
  it("requires Shahkar before creating an org", async () => {
    const s = await login(t, "09120000101");
    const r = await t.http.post(`${V}/orgs`).set(s.auth).set(idem()).send({ legal_name: "شرکت الف", national_id: legalId("1010101010") });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("SHAHKAR_REQUIRED");
  });

  it("rejects a bad legal national ID and a duplicate org", async () => {
    const s = await verifiedUser(t, "09120000102", "001000010");
    const good = legalId("1020202020");
    const bad = good.slice(0, 10) + String((Number(good[10]) + 1) % 10);
    const r1 = await t.http.post(`${V}/orgs`).set(s.auth).set(idem()).send({ legal_name: "شرکت ب", national_id: bad });
    expect(r1.body.error.code).toBe("LEGAL_ID_INVALID");
    await t.http.post(`${V}/orgs`).set(s.auth).set(idem()).send({ legal_name: "شرکت ب", national_id: good }).expect(201);
    const other = await verifiedUser(t, "09120000103", "001000020");
    const r2 = await t.http.post(`${V}/orgs`).set(other.auth).set(idem()).send({ legal_name: "شرکت ب۲", national_id: good });
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe("ORG_EXISTS");
  });

  it("creates an org in single-user mode with the creator as admin", async () => {
    const { admin, org } = await orgWithAdmin(t, "09120000104", "001000030", "1030303030");
    const r = await t.http.get(`${V}/orgs/current`).set(admin.auth).set(org).expect(200);
    expect(r.body.my_role).toBe("org_admin");
    expect(r.body.single_user_mode).toBe(true);
    expect(r.body.active_members).toBe(1);
    expect(r.body.requires_second_approver).toBe(false);
  });

  it("replays an idempotent create and rejects key reuse with a different body", async () => {
    const s = await verifiedUser(t, "09120000105", "001000040");
    const key = idem();
    const body = { legal_name: "شرکت پ", national_id: legalId("1040404040") };
    const a = await t.http.post(`${V}/orgs`).set(s.auth).set(key).send(body).expect(201);
    const b = await t.http.post(`${V}/orgs`).set(s.auth).set(key).send(body).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers["idempotent-replay"]).toBe("true");
    const c = await t.http.post(`${V}/orgs`).set(s.auth).set(key).send({ ...body, legal_name: "دیگری" });
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const d = await t.http.post(`${V}/orgs`).set(s.auth).send(body);
    expect(d.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("hides orgs from non-members (404) and requires the org header", async () => {
    const { orgId } = await orgWithAdmin(t, "09120000106", "001000050", "1050505050");
    const outsider = await login(t, "09120000107");
    const r = await t.http.get(`${V}/orgs/current`).set(outsider.auth).set({ "x-org-id": orgId });
    expect(r.status).toBe(404);
    const r2 = await t.http.get(`${V}/orgs/current`).set(outsider.auth);
    expect(r2.body.error.code).toBe("ORG_HEADER_REQUIRED");
  });
});

describe("members and invitations", () => {
  it("invites, accepts, and leaves single-user mode when a second member joins", async () => {
    const { admin, orgId, org } = await orgWithAdmin(t, "09120000201", "002000010", "2010101010");
    const member = await addMember(t, admin, orgId, "09120000202", "preparer");
    const cur = await t.http.get(`${V}/orgs/current`).set(member.auth).set(org).expect(200);
    expect(cur.body.my_role).toBe("preparer");
    expect(cur.body.single_user_mode).toBe(false);
    expect(cur.body.active_members).toBe(2);
    expect(cur.body.requires_second_approver).toBe(true);
    const list = await t.http.get(`${V}/orgs/current/members`).set(admin.auth).set(org).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[1].mobile).toMatch(/^0912\*\*\*0202$/);
  });

  it("only lets the invited person accept, once", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000203", "002000020", "2020202020");
    const path = `${V}/orgs/current/invitations`;
    const body = { destination: "09120000204", role: "viewer" };
    const su = await stepUp(t, admin, "POST", path, body);
    const inv = await t.http.post(path).set(admin.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send(body).expect(201);
    const wrong = await login(t, "09120000205");
    const r = await t.http.post(`${V}/invitations/accept`).set(wrong.auth).send({ token: inv.body.token });
    expect(r.body.error.code).toBe("INVITATION_NOT_FOR_YOU");
    const right = await login(t, "09120000204");
    await t.http.post(`${V}/invitations/accept`).set(right.auth).send({ token: inv.body.token }).expect(200);
    const again = await t.http.post(`${V}/invitations/accept`).set(right.auth).send({ token: inv.body.token });
    expect(again.body.error.code).toBe("INVITATION_INVALID");
  });

  it("requires org_admin role and step-up to invite", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000206", "002000030", "2030303030");
    const viewer = await addMember(t, admin, orgId, "09120000207", "viewer");
    const path = `${V}/orgs/current/invitations`;
    const body = { destination: "09120000208", role: "viewer" };
    const r1 = await t.http.post(path).set(viewer.auth).set({ "x-org-id": orgId }).set(idem()).send(body);
    expect(r1.body.error.code).toBe("ORG_ROLE_REQUIRED");
    const r2 = await t.http.post(path).set(admin.auth).set({ "x-org-id": orgId }).set(idem()).send(body);
    expect(r2.body.error.code).toBe("STEP_UP_REQUIRED");
  });

  it("protects the last admin and lets a second admin be demoted", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000209", "002000040", "2040404040");
    const members = await t.http.get(`${V}/orgs/current/members`).set(admin.auth).set({ "x-org-id": orgId }).expect(200);
    const selfId = members.body[0].id;
    const path = `${V}/orgs/current/members/${selfId}`;
    const body = { role: "viewer" };
    let su = await stepUp(t, admin, "PATCH", path, body);
    const r = await t.http.patch(path).set(admin.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).send(body);
    expect(r.body.error.code).toBe("LAST_ADMIN");

    await addMember(t, admin, orgId, "09120000210", "org_admin");
    su = await stepUp(t, admin, "PATCH", path, body);
    const ok = await t.http.patch(path).set(admin.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).send(body).expect(200);
    expect(ok.body.role).toBe("viewer");
    // The demoted user lost admin rights immediately.
    const r3 = await t.http.get(`${V}/orgs/current/invitations`).set(admin.auth).set({ "x-org-id": orgId });
    expect(r3.status).toBe(403);
  });

  it("cannot turn single-user mode back on with two members", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000211", "002000050", "2050505050");
    await addMember(t, admin, orgId, "09120000212", "approver");
    const path = `${V}/orgs/current`;
    const body = { single_user_mode: true };
    const su = await stepUp(t, admin, "PATCH", path, body);
    const r = await t.http.patch(path).set(admin.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).send(body);
    expect(r.body.error.code).toBe("SINGLE_USER_NOT_ALLOWED");
  });

  it("suspended members lose access", async () => {
    const { admin, orgId } = await orgWithAdmin(t, "09120000213", "002000060", "2060606060");
    const m = await addMember(t, admin, orgId, "09120000214", "preparer");
    const list = await t.http.get(`${V}/orgs/current/members`).set(admin.auth).set({ "x-org-id": orgId }).expect(200);
    const mid = list.body.find((x: any) => x.user_id === m.userId).id;
    const path = `${V}/orgs/current/members/${mid}`;
    const body = { status: "suspended" };
    const su = await stepUp(t, admin, "PATCH", path, body);
    await t.http.patch(path).set(admin.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).send(body).expect(200);
    const r = await t.http.get(`${V}/orgs/current`).set(m.auth).set({ "x-org-id": orgId });
    expect(r.status).toBe(404);
  });
});
