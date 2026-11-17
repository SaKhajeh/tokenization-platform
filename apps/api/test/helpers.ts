import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { loadConfig, AppConfig } from "../src/config.js";
import { createApp } from "../src/app.module.js";
import { PgliteDb } from "../src/db/db.js";
import { migrate } from "../src/db/migrate.js";
import { MemorySender, MemoryStorage, MockIdentity } from "../src/integrations/providers.js";
import { normalizeMobile } from "../src/common/validators.js";
import { MockRegistry } from "../src/integrations/registry.js";
import { MockCobank } from "../src/integrations/cobank.js";
import { ChainGateway, MockChain } from "../src/chain/gateway.js";

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  db: PgliteDb;
  sms: MemorySender;
  identity: MockIdentity;
  storage: MemoryStorage;
  registry: MockRegistry;
  cobank: MockCobank;
  chain: MockChain;
  config: AppConfig;
  close(): Promise<void>;
}

export async function makeApp(overrides: Partial<AppConfig> = {}, chainOverride?: ChainGateway): Promise<TestApp> {
  process.env.APP_ENV = "test";
  const db = new PgliteDb(new PGlite());
  await migrate(db);
  const sms = new MemorySender();
  const identity = new MockIdentity();
  const storage = new MemoryStorage();
  const registry = new MockRegistry();
  const cobank = new MockCobank();
  const chain = new MockChain();
  // Tests log in many times per destination: relax OTP throttling unless a test overrides it.
  const config = loadConfig({ env: "test", databaseUrl: "pglite:", otpResendCooldownSec: 0, otpMaxPerHour: 1000, ...overrides });
  const app = await createApp({ config, db, sms, email: sms, identity, storage, registry, cobank, chain: chainOverride ?? chain });
  await app.init();
  return {
    app, db, sms, identity, storage, registry, cobank, chain, config,
    http: request(app.getHttpServer()),
    async close() {
      await app.close();
      await db.close();
    },
  };
}

// ------------------------------------------------------------------ identifiers that pass the checksums

/** Valid کد ملی with the given 9-digit prefix. */
export function nationalCode(prefix9: string): string {
  const d = prefix9.split("").map(Number);
  const sum = d.reduce((a, v, i) => a + v * (10 - i), 0);
  const r = sum % 11;
  return prefix9 + String(r < 2 ? r : 11 - r);
}

/** Valid شناسه ملی with the given 10-digit prefix. */
export function legalId(prefix10: string): string {
  const d = prefix10.split("").map(Number);
  const off = d[9] + 2;
  const w = [29, 27, 23, 19, 17];
  let s = 0;
  for (let i = 0; i < 10; i++) s += (d[i] + off) * w[i % 5];
  let r = s % 11;
  if (r === 10) r = 0;
  return prefix10 + String(r);
}

// ------------------------------------------------------------------ flows

export interface Session {
  userId: string;
  token: string;
  refresh: string;
  mobile: string;
  auth: Record<string, string>;
}

export async function login(t: TestApp, mobile: string, fingerprint = "device-" + mobile): Promise<Session> {
  const r1 = await t.http.post("/api/v1/auth/otp/request").send({ destination: mobile }).expect(200);
  const code = t.sms.lastOtp(normalizeMobile(mobile) ?? mobile)!;
  const r2 = await t.http
    .post("/api/v1/auth/otp/verify")
    .send({ challenge_id: r1.body.challenge_id, code, device_fingerprint: fingerprint })
    .expect(200);
  return { userId: r2.body.user.id, token: r2.body.access_token, refresh: r2.body.refresh_token, mobile: normalizeMobile(mobile) ?? mobile, auth: { authorization: `Bearer ${r2.body.access_token}` } };
}

/** Logs in and passes Shahkar with a valid national code. */
export async function verifiedUser(t: TestApp, mobile: string, ncPrefix: string): Promise<Session> {
  const s = await login(t, mobile);
  await t.http.post("/api/v1/me/national-code").set(s.auth).send({ national_code: nationalCode(ncPrefix) }).expect(200);
  return s;
}

/** Gets a step-up token for exactly this request. */
export async function stepUp(t: TestApp, s: Session, method: string, path: string, body: unknown): Promise<string> {
  const r = await t.http.post("/api/v1/auth/step-up").set(s.auth).send({ method, path, body }).expect(200);
  const code = t.sms.lastOtp(s.mobile)!;
  const v = await t.http.post("/api/v1/auth/step-up/verify").set(s.auth).send({ challenge_id: r.body.challenge_id, code }).expect(200);
  return v.body.step_up_token;
}

export const idem = () => ({ "idempotency-key": randomUUID() });

/** Creates an org owned by a fresh verified user. */
export async function orgWithAdmin(t: TestApp, mobile: string, ncPrefix: string, legalPrefix: string, name = "شرکت آزمون") {
  const admin = await verifiedUser(t, mobile, ncPrefix);
  const r = await t.http.post("/api/v1/orgs").set(admin.auth).set(idem()).send({ legal_name: name, national_id: legalId(legalPrefix) }).expect(201);
  return { admin, orgId: r.body.id as string, org: { "x-org-id": r.body.id as string } };
}

/** Admin invites `mobile` with `role`; that user logs in and accepts. */
export async function addMember(t: TestApp, admin: Session, orgId: string, mobile: string, role: string): Promise<Session> {
  const path = "/api/v1/orgs/current/invitations";
  const body = { destination: mobile, role };
  const su = await stepUp(t, admin, "POST", path, body);
  const inv = await t.http.post(path).set(admin.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send(body).expect(201);
  const member = await login(t, mobile);
  await t.http.post("/api/v1/invitations/accept").set(member.auth).send({ token: inv.body.token }).expect(200);
  return member;
}

// ------------------------------------------------------------------ M-B helpers

/** Valid Iranian IBAN (IR + 2 check digits + 22 digits) from a 22-digit account part. */
export function iban(bban22: string): string {
  let rem = 0;
  for (const ch of bban22 + "182700") rem = (rem * 10 + Number(ch)) % 97;
  return `IR${String(98 - rem).padStart(2, "0")}${bban22}`;
}

/** A logged-in user holding a staff role. */
export async function staff(t: TestApp, mobile: string, ...roles: string[]): Promise<Session> {
  const s = await login(t, mobile);
  for (const r of roles) await t.db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [s.userId, r]);
  return s;
}

/**
 * Org whose admin is listed as CEO in the (mock) registry, with KYB submitted and approved by a compliance officer.
 * Returns the org plus the reviewer.
 */
export async function approvedOrg(t: TestApp, n: number, opts: { compliance?: Session; name?: string } = {}) {
  const pad = String(n).padStart(4, "0");
  const ncPrefix = `07${pad}111`;
  const legalPrefix = `10${pad}3333`;
  const name = opts.name ?? `شرکت نمونه ${n}`;
  const { admin, orgId, org } = await orgWithAdmin(t, `0912${pad}777`.slice(0, 11), ncPrefix, legalPrefix, name);
  t.registry.companies.set(legalId(legalPrefix), {
    name, postalCode: "1234567890",
    people: [{ nationalCode: nationalCode(ncPrefix), name: "مدیر نمونه", position: "مدیرعامل", roles: ["ceo"] }],
  });
  const reg = await t.http.post("/api/v1/kyb/registry").set(admin.auth).set(org).expect(200);
  const body = { snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS };
  const su = await stepUp(t, admin, "POST", "/api/v1/kyb/submit", body);
  const sub = await t.http.post("/api/v1/kyb/submit").set(admin.auth).set({ ...org, "x-step-up-token": su }).set(idem()).send(body).expect(201);
  const reviewer = opts.compliance ?? (await staff(t, `0935${pad}000`.slice(0, 11), "compliance_officer"));
  await t.http.post(`/api/v1/admin/kyb/${sub.body.id}/decision`).set(reviewer.auth).send({ decision: "approve" }).expect(200);
  return { admin, orgId, org, reviewer, caseId: sub.body.id as string, nationalId: legalId(legalPrefix) };
}

export const KYB_FIELDS = {
  activity: "پژوهش و توسعه فناوری باتری",
  address: "تهران، خیابان آزمایش، پلاک ۱، طبقه دوم",
  postal_code: "1234567890",
  phone: "02112345678",
};

/** Adds a bank account that Jibit matches to the org (verified at once). */
export async function verifiedAccount(t: TestApp, s: Session, orgId: string, nationalId: string, bban22: string) {
  const i = iban(bban22);
  t.registry.ibans.set(i, { legalId: nationalId });
  const body = { iban: i };
  const su = await stepUp(t, s, "POST", "/api/v1/bank-accounts", body);
  const r = await t.http.post("/api/v1/bank-accounts").set(s.auth).set({ "x-org-id": orgId, "x-step-up-token": su }).set(idem()).send(body).expect(201);
  return { id: r.body.id as string, iban: i };
}
