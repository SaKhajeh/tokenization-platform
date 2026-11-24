/**
 * Invitation codes go out through an outbox written with the invitation, so a crash after the commit (or a provider
 * outage) never leaves an invitation whose code was not sent. The code is stored encrypted and wiped once sent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, orgWithAdmin, stepUp, staff, Session } from "./helpers.js";

let t: TestApp;
let admin: Session;
let org: { "x-org-id": string };
let ops: Session;
beforeAll(async () => {
  t = await makeApp();
  ({ admin, org } = await orgWithAdmin(t, "09120000801", "008000010", "1080808080"));
  ops = await staff(t, "09120000899", "super_admin");
});
afterAll(async () => t.close());

const V = "/api/v1";
const PATH = `${V}/orgs/current/invitations`;
const invite = async (destination: string) => {
  const body = { destination, role: "preparer" };
  const su = await stepUp(t, admin, "POST", PATH, body);
  return t.http.post(PATH).set(admin.auth).set({ ...org, "x-step-up-token": su }).set(idem()).send(body).expect(201);
};
const delivery = async (id: string) => (await t.db.query(`select * from invitation_deliveries where invitation_id = $1`, [id])).rows[0];
const textsTo = (mobile: string) => t.sms.sent.filter((m) => m.kind === "text" && m.to === mobile);
const runJob = async () => (await t.http.post(`${V}/admin/jobs/invitations/run`).set(ops.auth).expect(200)).body;

describe("invitation delivery", () => {
  it("sends the code right away and wipes the stored copy", async () => {
    const r = await invite("09120000811");
    const msgs = textsTo("09120000811");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toContain(r.body.token); // dev/test exposes the token in the response
    const d = await delivery(r.body.id);
    expect(d.status).toBe("sent");
    expect(d.token_enc).toBeNull();
  });

  it("still sends the code when the request could not (crash or provider outage after the commit)", async () => {
    // The sender fails during the request: the invitation is created anyway and its message is left queued.
    const realSend = t.sms.sendText.bind(t.sms);
    (t.sms as any).sendText = () => Promise.reject(new Error("provider down"));
    let r;
    try {
      r = await invite("09120000812");
    } finally {
      (t.sms as any).sendText = realSend;
    }
    expect(textsTo("09120000812")).toHaveLength(0);
    const queued = await delivery(r.body.id);
    expect(queued.status).toBe("queued");
    expect(queued.token_enc).not.toBeNull();
    expect(queued.token_enc).not.toContain(r.body.token); // stored encrypted, never in clear

    // The worker delivers it, once.
    expect((await runJob()).sent).toBe(1);
    expect(textsTo("09120000812")).toHaveLength(1);
    expect(textsTo("09120000812")[0].body).toContain(r.body.token);
    expect((await delivery(r.body.id)).token_enc).toBeNull();
    await runJob();
    expect(textsTo("09120000812")).toHaveLength(1);
  });

  it("does not send a code for an invitation revoked or replaced before delivery, and wipes it", async () => {
    const realSend = t.sms.sendText.bind(t.sms);
    (t.sms as any).sendText = () => Promise.reject(new Error("provider down"));
    let first, second;
    try {
      first = await invite("09120000813");
      second = await invite("09120000813"); // replaces the first
    } finally {
      (t.sms as any).sendText = realSend;
    }
    const d1 = await delivery(first.body.id);
    expect(d1.status).toBe("cancelled");
    expect(d1.token_enc).toBeNull();

    const path = `${PATH}/${second.body.id}`;
    const su = await stepUp(t, admin, "DELETE", path, {});
    await t.http.delete(path).set(admin.auth).set({ ...org, "x-step-up-token": su }).set(idem()).expect((res) => expect(res.status).toBeLessThan(300));
    expect((await delivery(second.body.id)).status).toBe("cancelled");

    await runJob();
    expect(textsTo("09120000813")).toHaveLength(0);
  });

  it("gives up after repeated failures and wipes the code", async () => {
    const realSend = t.sms.sendText.bind(t.sms);
    (t.sms as any).sendText = () => Promise.reject(new Error("provider down"));
    try {
      const r = await invite("09120000814");
      for (let i = 0; i < 6; i++) await runJob();
      const d = await delivery(r.body.id);
      expect(d.status).toBe("failed");
      expect(d.attempts).toBe(5);
      expect(d.token_enc).toBeNull();
    } finally {
      (t.sms as any).sendText = realSend;
    }
  });
});
