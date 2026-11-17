import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, login, orgWithAdmin } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => t.close());

const V = "/api/v1";

async function staff(mobile: string, role: string) {
  const s = await login(t, mobile);
  await t.db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [s.userId, role]);
  return s;
}

describe("audit log", () => {
  it("is visible to auditors only", async () => {
    await orgWithAdmin(t, "09120000501", "005000010", "5010101010");
    const user = await login(t, "09120000502");
    expect((await t.http.get(`${V}/admin/audit`).set(user.auth)).status).toBe(403);
    const auditor = await staff("09120000503", "auditor");
    const r = await t.http.get(`${V}/admin/audit`).set(auditor.auth).expect(200);
    expect(r.body.map((e: any) => e.action)).toEqual(expect.arrayContaining(["org.created", "user.shahkar_verified"]));
    const analyst = await staff("09120000504", "analyst");
    expect((await t.http.get(`${V}/admin/audit`).set(analyst.auth)).status).toBe(403);
  });

  it("verifies the hash chain", async () => {
    const auditor = await staff("09120000505", "auditor");
    const r = await t.http.get(`${V}/admin/audit/verify`).set(auditor.auth).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.checked).toBeGreaterThan(5);
  });

  it("cannot be updated, deleted or truncated", async () => {
    await expect(t.db.query(`update audit_log set action = 'x' where id = 1`)).rejects.toThrow();
    await expect(t.db.query(`delete from audit_log where id = 1`)).rejects.toThrow();
    await expect(t.db.query(`truncate audit_log`)).rejects.toThrow();
  });

  it("detects a forged row inserted directly", async () => {
    const auditor = await staff("09120000506", "auditor");
    const last = (await t.db.query(`select hash from audit_log order by id desc limit 1`)).rows[0] as any;
    await t.db.query(
      `insert into audit_log (at, actor_type, action, entity_type, prev_hash, hash) values (now(), 'system', 'forged', 'x', $1, $2)`,
      [last.hash, "f".repeat(64)],
    );
    const r = await t.http.get(`${V}/admin/audit/verify`).set(auditor.auth).expect(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.firstBadId).not.toBeNull();
  });
});
