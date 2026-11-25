import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { login, makeApp, nationalCode, stepUp, TestApp, verifiedUser, orgWithAdmin } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

describe("OTP login / signup", () => {
  it("signs up a new user, then logs the same user in", async () => {
    const r1 = await t.http.post("/api/v1/auth/otp/request").send({ destination: "09121110001" }).expect(200);
    expect(r1.body).toMatchObject({ channel: "sms", expires_in: 120 });
    const code = t.sms.lastOtp("09121110001")!;
    expect(code).toMatch(/^\d{6}$/);
    const r2 = await t.http.post("/api/v1/auth/otp/verify").send({ challenge_id: r1.body.challenge_id, code, device_fingerprint: "dev-aaaaaaaa" }).expect(200);
    expect(r2.body.is_new_user).toBe(true);
    expect(r2.body.user).toMatchObject({ mobile: "09121110001", shahkar_status: "pending" });

    const again = await login(t, "09121110001", "dev-aaaaaaaa");
    expect(again.userId).toBe(r2.body.user.id);
    const me = await t.http.get("/api/v1/me").set(again.auth).expect(200);
    expect(me.body).toMatchObject({ id: again.userId, organisations: [], staff_roles: [] });
  });

  it("normalises Persian digits and +98 numbers", async () => {
    const s = await login(t, "۰۹۱۲۱۱۱۰۰۰۲");
    const s2 = await login(t, "+989121110002");
    expect(s2.userId).toBe(s.userId);
  });

  it("gives the same answer whether or not the account exists", async () => {
    const a = await t.http.post("/api/v1/auth/otp/request").send({ destination: "09121110001" }).expect(200);
    const b = await t.http.post("/api/v1/auth/otp/request").send({ destination: "09121119999" }).expect(200);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
  });

  it("rejects invalid destinations", async () => {
    const r = await t.http.post("/api/v1/auth/otp/request").send({ destination: "12345" }).expect(400);
    expect(r.body.error.code).toBe("INVALID_DESTINATION");
    expect(r.body.error.message_fa).toBeTruthy();
    expect(r.body.error.request_id).toBeTruthy();
  });

  it("counts wrong codes and kills the challenge at the limit", async () => {
    const r = await t.http.post("/api/v1/auth/otp/request").send({ destination: "09121110003" }).expect(200);
    const good = t.sms.lastOtp("09121110003")!;
    const bad = good === "000000" ? "111111" : "000000";
    const send = (code: string) => t.http.post("/api/v1/auth/otp/verify").send({ challenge_id: r.body.challenge_id, code, device_fingerprint: "dev-bbbbbbbb" });
    const w1 = await send(bad).expect(400);
    expect(w1.body.error).toMatchObject({ code: "OTP_INVALID", details: { attempts_left: 4 } });
    for (let i = 0; i < 3; i++) await send(bad).expect(400);
    const last = await send(bad).expect(400);
    expect(last.body.error.code).toBe("OTP_EXPIRED");
    const late = await send(good).expect(400);
    expect(late.body.error.code).toBe("OTP_EXPIRED");
  });

  it("a code works once and not after expiry", async () => {
    const r = await t.http.post("/api/v1/auth/otp/request").send({ destination: "09121110004" }).expect(200);
    const code = t.sms.lastOtp("09121110004")!;
    const body = { challenge_id: r.body.challenge_id, code, device_fingerprint: "dev-cccccccc" };
    await t.http.post("/api/v1/auth/otp/verify").send(body).expect(200);
    expect((await t.http.post("/api/v1/auth/otp/verify").send(body).expect(400)).body.error.code).toBe("OTP_EXPIRED");

    const r2 = await t.http.post("/api/v1/auth/otp/request").send({ destination: "09121110004" }).expect(200);
    await t.db.query(`update otp_challenges set expires_at = now() - interval '1 second' where id = $1`, [r2.body.challenge_id]);
    await t.http
      .post("/api/v1/auth/otp/verify")
      .send({ challenge_id: r2.body.challenge_id, code: t.sms.lastOtp("09121110004"), device_fingerprint: "dev-cccccccc" })
      .expect(400);
  });

  it("rejects requests without a valid token", async () => {
    await t.http.get("/api/v1/me").expect(401);
    await t.http.get("/api/v1/me").set({ authorization: "Bearer not-a-jwt" }).expect(401);
  });
});

describe("OTP throttling", () => {
  it("enforces the resend cooldown and the hourly cap", async () => {
    const strict = await makeApp({ otpResendCooldownSec: 60, otpMaxPerHour: 2 });
    try {
      await strict.http.post("/api/v1/auth/otp/request").send({ destination: "09121110005" }).expect(200);
      const c = await strict.http.post("/api/v1/auth/otp/request").send({ destination: "09121110005" }).expect(429);
      expect(c.body.error.code).toBe("OTP_COOLDOWN");
      await strict.db.query(`update otp_challenges set created_at = now() - interval '2 minutes'`);
      await strict.http.post("/api/v1/auth/otp/request").send({ destination: "09121110005" }).expect(200);
      await strict.db.query(`update otp_challenges set created_at = now() - interval '2 minutes'`);
      const h = await strict.http.post("/api/v1/auth/otp/request").send({ destination: "09121110005" }).expect(429);
      expect(h.body.error.code).toBe("OTP_RATE_LIMIT");
    } finally {
      await strict.close();
    }
  });

  it("throttles per purpose: confirming right after login, or two different actions back to back, is not refused", async () => {
    const strict = await makeApp({ otpResendCooldownSec: 60, otpMaxPerHour: 2, otpMaxStepUpPerHour: 3 });
    try {
      const s = await login(strict, "09121110015"); // a login code was just sent
      const ask = (path: string) => strict.http.post("/api/v1/auth/step-up").set(s.auth).send({ method: "POST", path, body: {} });
      expect((await ask("/api/v1/case/submit")).status).toBe(200); // right after the login code
      expect((await ask("/api/v1/case/letter/sign")).status).toBe(200); // a different action at once
      const again = await ask("/api/v1/case/submit"); // the same action again: resend cooldown
      expect(again.status).toBe(429);
      expect(again.body.error.code).toBe("OTP_COOLDOWN");
      await strict.db.query(`update otp_challenges set created_at = now() - interval '2 minutes'`);
      expect((await ask("/api/v1/case/submit")).status).toBe(200);
      const cap = await ask("/api/v1/bank-accounts"); // fourth confirmation within the hour
      expect(cap.body.error.code).toBe("OTP_RATE_LIMIT");
      // the login budget is separate
      expect((await strict.http.post("/api/v1/auth/otp/request").send({ destination: "09121110015" })).status).toBe(200);
    } finally {
      await strict.close();
    }
  });
});

describe("sessions", () => {
  it("rotates refresh tokens and revokes the session when an old one is reused", async () => {
    const s = await login(t, "09121110006");
    const r1 = await t.http.post("/api/v1/auth/refresh").send({ refresh_token: s.refresh }).expect(200);
    expect(r1.body.refresh_token).not.toBe(s.refresh);
    await t.http.get("/api/v1/me").set({ authorization: `Bearer ${r1.body.access_token}` }).expect(200);
    // attacker replays the old token → whole session dies
    await t.http.post("/api/v1/auth/refresh").send({ refresh_token: s.refresh }).expect(401);
    await t.http.post("/api/v1/auth/refresh").send({ refresh_token: r1.body.refresh_token }).expect(401);
    await t.http.get("/api/v1/me").set({ authorization: `Bearer ${r1.body.access_token}` }).expect(401);
  });

  it("logout ends the session", async () => {
    const s = await login(t, "09121110007");
    await t.http.post("/api/v1/auth/logout").set(s.auth).expect(204);
    await t.http.get("/api/v1/me").set(s.auth).expect(401);
  });

  it("revoking a device ends its sessions; a fresh OTP login re-trusts it", async () => {
    const phone = await login(t, "09121110008", "phone-1111");
    const laptop = await login(t, "09121110008", "laptop-2222");
    const devices = (await t.http.get("/api/v1/me/devices").set(laptop.auth).expect(200)).body;
    expect(devices).toHaveLength(2);
    const phoneDevice = devices.find((d: any) => !d.current);
    await t.http.delete(`/api/v1/me/devices/${phoneDevice.id}`).set(laptop.auth).expect(204);
    await t.http.get("/api/v1/me").set(phone.auth).expect(401);
    await t.http.get("/api/v1/me").set(laptop.auth).expect(200);
    const back = await login(t, "09121110008", "phone-1111");
    await t.http.get("/api/v1/me").set(back.auth).expect(200);
  });
});

describe("national code + Shahkar (FR-AUTH-6)", () => {
  it("rejects an invalid national code", async () => {
    const s = await login(t, "09121110009");
    const r = await t.http.post("/api/v1/me/national-code").set(s.auth).send({ national_code: "0012345678" }).expect(400);
    expect(r.body.error.code).toBe("NATIONAL_CODE_INVALID");
  });

  it("records a Shahkar mismatch", async () => {
    const s = await login(t, "09121110010");
    const nc = nationalCode("001234568");
    t.identity.mismatches.add(nc);
    const r = await t.http.post("/api/v1/me/national-code").set(s.auth).send({ national_code: nc }).expect(422);
    expect(r.body.error.code).toBe("SHAHKAR_MISMATCH");
    const me = await t.http.get("/api/v1/me").set(s.auth).expect(200);
    expect(me.body.shahkar_status).toBe("failed");
    t.identity.mismatches.delete(nc);
    await t.http.post("/api/v1/me/national-code").set(s.auth).send({ national_code: nc }).expect(200);
  });

  it("verifies, masks the code, stores it encrypted and blocks reuse by another account", async () => {
    const s = await login(t, "09121110011");
    const nc = nationalCode("004567891");
    const r = await t.http.post("/api/v1/me/national-code").set(s.auth).send({ national_code: nc }).expect(200);
    expect(r.body.shahkar_status).toBe("verified");
    expect(r.body.national_code_masked).toBe(`${nc.slice(0, 3)}****${nc.slice(-3)}`);
    const raw = (await t.db.query(`select national_code_enc from users where id = $1`, [s.userId])).rows[0];
    expect(raw.national_code_enc).not.toContain(nc);
    const other = await login(t, "09121110012");
    const dup = await t.http.post("/api/v1/me/national-code").set(other.auth).send({ national_code: nc }).expect(409);
    expect(dup.body.error.code).toBe("NATIONAL_CODE_IN_USE");
    const again = await t.http.post("/api/v1/me/national-code").set(s.auth).send({ national_code: nc }).expect(409);
    expect(again.body.error.code).toBe("ALREADY_VERIFIED");
  });
});

describe("step-up (FR-AUTH-4)", () => {
  it("a step-up token authorises exactly one action, once", async () => {
    const { admin, org } = await orgWithAdmin(t, "09121110013", "007777777", "1010101010");
    const path = "/api/v1/orgs/current";
    const body = { single_user_mode: true };

    const none = await t.http.patch(path).set(admin.auth).set(org).send(body).expect(403);
    expect(none.body.error.code).toBe("STEP_UP_REQUIRED");

    const tokenForOtherBody = await stepUp(t, admin, "PATCH", path, { single_user_mode: false });
    await t.http.patch(path).set(admin.auth).set(org).set({ "x-step-up-token": tokenForOtherBody }).send(body).expect(403);

    const ok = await stepUp(t, admin, "PATCH", path, body);
    const r = await t.http.patch(path).set(admin.auth).set(org).set({ "x-step-up-token": ok }).send(body).expect(200);
    expect(r.body.single_user_mode).toBe(true);
    await t.http.patch(path).set(admin.auth).set(org).set({ "x-step-up-token": ok }).send(body).expect(403); // used
  });

  it("another user's step-up token is useless", async () => {
    const a = await orgWithAdmin(t, "09121110014", "008888888", "1020202020");
    const b = await verifiedUser(t, "09121110015", "009999999");
    const body = { single_user_mode: true };
    const tokenOfB = await stepUp(t, b, "PATCH", "/api/v1/orgs/current", body);
    await t.http.patch("/api/v1/orgs/current").set(a.admin.auth).set(a.org).set({ "x-step-up-token": tokenOfB }).send(body).expect(403);
  });
});

describe("audit of auth events", () => {
  it("logs sign-up and login", async () => {
    const s = await login(t, "09121110016");
    const { rows } = await t.db.query(`select action from audit_log where actor_user_id = $1 order by id`, [s.userId]);
    expect(rows.map((r: any) => r.action)).toEqual(["user.signed_up", "auth.login"]);
  });
});
