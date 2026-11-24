/**
 * Idempotency after a crash: the response is recorded inside the business transaction, so a committed action
 * always has a response to replay, and a key whose request died before committing can be used again.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, orgWithAdmin, Session } from "./helpers.js";
import { canonicalJson, sha256Hex } from "../src/common/crypto.js";

let t: TestApp;
let admin: Session;
let org: { "x-org-id": string };
beforeAll(async () => {
  t = await makeApp({ idempotencyStaleSec: 300 });
  ({ admin, org } = await orgWithAdmin(t, "09120000901", "009000010", "1090909090"));
});
afterAll(async () => t.close());

const V = "/api/v1";
const PATH = `${V}/tasks`;
const countTasks = async (title: string) => Number((await t.db.query(`select count(*) as n from tasks where title = $1`, [title])).rows[0].n);
const keyRow = async (key: string) => (await t.db.query(`select status_code, response from idempotency_keys where user_id = $1 and key = $2`, [admin.userId, key])).rows[0];
/** The hash the interceptor computes for a request (method, path, org, body). */
const requestHash = (body: unknown) => sha256Hex(canonicalJson({ m: "POST", path: PATH, org: org["x-org-id"], body }));

describe("idempotency after a crash", () => {
  it("records the response in the business transaction: a crash after the commit replays it, never repeats the action", async () => {
    const body = { title: "پیگیری پس از قطعی", assignee_role: "org_admin" };
    const key = idem();
    // Simulate the process dying after the business transaction committed but before the interceptor stored the
    // response: the interceptor's own (non-transactional) write of the response fails.
    const original = t.db.query.bind(t.db);
    (t.db as any).query = (sql: string, params?: unknown[]) =>
      /update idempotency_keys set status_code=\$3/.test(sql) ? Promise.reject(new Error("simulated crash")) : original(sql, params);
    try {
      const first = await t.http.post(PATH).set(admin.auth).set(org).set(key).send(body);
      expect(first.status).toBe(500); // the client never saw the success
    } finally {
      (t.db as any).query = original;
    }
    // The task exists, and the key already holds its response (written by the transaction itself).
    expect(await countTasks(body.title)).toBe(1);
    const row = await keyRow(key["idempotency-key"]);
    expect(row.status_code).toBe(201);
    expect(row.response.title).toBe(body.title);

    // The client retries with the same key: it gets the original result, and no second task is created.
    const retry = await t.http.post(PATH).set(admin.auth).set(org).set(key).send(body).expect(201);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.body.id).toBe(row.response.id);
    expect(await countTasks(body.title)).toBe(1);
  });

  it("takes over a key whose request died before committing anything (it used to stay blocked forever)", async () => {
    const body = { title: "کار رها شده", assignee_role: "org_admin" };
    const key = idem();
    // What a crash before the commit leaves behind: a claimed key with no response, from 10 minutes ago.
    await t.db.query(
      `insert into idempotency_keys (user_id, key, method, path, request_hash, created_at) values ($1,$2,'POST',$3,$4, now() - interval '10 minutes')`,
      [admin.userId, key["idempotency-key"], PATH, requestHash(body)],
    );
    const r = await t.http.post(PATH).set(admin.auth).set(org).set(key).send(body).expect(201);
    expect(r.headers["idempotent-replay"]).toBeUndefined();
    expect(await countTasks(body.title)).toBe(1);
    // …and from now on the key replays.
    const again = await t.http.post(PATH).set(admin.auth).set(org).set(key).send(body).expect(201);
    expect(again.body.id).toBe(r.body.id);
    expect(again.headers["idempotent-replay"]).toBe("true");
  });

  it("still answers 'in progress' while the first request may be running, and checks the body even for stale keys", async () => {
    const body = { title: "در حال اجرا", assignee_role: "org_admin" };
    const key = idem();
    await t.db.query(
      `insert into idempotency_keys (user_id, key, method, path, request_hash) values ($1,$2,'POST',$3,$4)`,
      [admin.userId, key["idempotency-key"], PATH, requestHash(body)],
    );
    const r = await t.http.post(PATH).set(admin.auth).set(org).set(key).send(body);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(await countTasks(body.title)).toBe(0);

    await t.db.query(`update idempotency_keys set created_at = now() - interval '10 minutes' where key = $1`, [key["idempotency-key"]]);
    const other = await t.http.post(PATH).set(admin.auth).set(org).set(key).send({ title: "بدنه‌ی دیگر", assignee_role: "org_admin" });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("releases the key when the request fails before committing, so the client can fix and retry with it", async () => {
    const key = idem();
    const bad = await t.http.post(PATH).set(admin.auth).set(org).set(key).send({ title: "x" }); // too short → 400
    expect(bad.status).toBe(400);
    expect(await keyRow(key["idempotency-key"])).toBeUndefined();
  });
});
