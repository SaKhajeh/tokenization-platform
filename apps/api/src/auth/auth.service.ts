import { Inject, Injectable } from "@nestjs/common";
import { SignJWT } from "jose";
import { DB, type Db, type Queryable } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { ApiError } from "../common/errors.js";
import { decrypt, encrypt, hmacHex, otpCode, randomToken, safeEqualHex, sha256Hex } from "../common/crypto.js";
import { uuidv7 } from "../common/ids.js";
import { isValidNationalCode, normalizeDigits, normalizeEmail, normalizeMobile } from "../common/validators.js";
import { EMAIL, IDENTITY, type IdentityProvider, type MessageSender, SMS } from "../integrations/providers.js";
import { AuditService } from "../audit/audit.service.js";
import { actionHash } from "../common/stepup.js";
import type { AppRequest } from "../common/context.js";
import { actor } from "../common/context.js";

type Purpose = "login" | "step_up";

const E = {
  badDestination: () => new ApiError(400, "INVALID_DESTINATION", "Enter a valid mobile number or email", "شماره موبایل یا ایمیل معتبر وارد کنید."),
  cooldown: (s: number) => new ApiError(429, "OTP_COOLDOWN", `Wait ${s}s before requesting another code`, "لطفاً کمی بعد دوباره درخواست کد دهید.", { retry_after: s }),
  hourly: () => new ApiError(429, "OTP_RATE_LIMIT", "Too many codes requested; try again later", "تعداد درخواست کد بیش از حد مجاز است. بعداً تلاش کنید."),
  invalidOtp: (left: number) => new ApiError(400, "OTP_INVALID", "Wrong code", "کد واردشده صحیح نیست.", { attempts_left: left }),
  expiredOtp: () => new ApiError(400, "OTP_EXPIRED", "Code expired or already used; request a new one", "کد منقضی یا استفاده‌شده است؛ کد جدید بگیرید."),
  badRefresh: () => new ApiError(401, "REFRESH_INVALID", "Session expired; log in again", "نشست شما منقضی شده است؛ دوباره وارد شوید."),
  disabled: () => new ApiError(403, "USER_DISABLED", "Account disabled", "حساب کاربری غیرفعال است."),
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(SMS) private readonly sms: MessageSender,
    @Inject(EMAIL) private readonly email: MessageSender,
    @Inject(IDENTITY) private readonly identity: IdentityProvider,
    private readonly audit: AuditService,
  ) {}

  private codeHash(challengeId: string, code: string) {
    return hmacHex(this.cfg.pepper, `otp:${challengeId}:${code}`);
  }

  parseDestination(raw: string): { destination: string; channel: "sms" | "email" } {
    const m = normalizeMobile(raw);
    if (m) return { destination: m, channel: "sms" };
    const e = normalizeEmail(raw);
    if (e) return { destination: e, channel: "email" };
    throw E.badDestination();
  }

  private async issueChallenge(dest: string, channel: "sms" | "email", purpose: Purpose, userId: string | null, action: string | null) {
    const recent = await this.db.query<{ created_at: Date }>(
      `select created_at from otp_challenges where destination = $1 and created_at > now() - interval '1 hour' order by created_at desc`,
      [dest],
    );
    if (recent.rows.length) {
      const since = (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
      if (since < this.cfg.otpResendCooldownSec) throw E.cooldown(Math.ceil(this.cfg.otpResendCooldownSec - since));
      if (recent.rows.length >= this.cfg.otpMaxPerHour) throw E.hourly();
    }
    const id = uuidv7();
    const code = otpCode();
    await this.db.query(
      `insert into otp_challenges (id, user_id, channel, destination, purpose, code_hash, action_hash, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))`,
      [id, userId, channel, dest, purpose, this.codeHash(id, code), action, this.cfg.otpTtlSec],
    );
    await (channel === "sms" ? this.sms : this.email).sendOtp(dest, code, id);
    return { challenge_id: id, channel, expires_in: this.cfg.otpTtlSec, resend_in: this.cfg.otpResendCooldownSec };
  }

  /** Verifies and consumes a challenge. Wrong codes count; at the limit the challenge dies. */
  private async consumeChallenge(id: string, code: string, purpose: Purpose) {
    const { rows } = await this.db.query(
      `select * from otp_challenges where id = $1 and purpose = $2`,
      [id, purpose],
    );
    const ch = rows[0];
    if (!ch || ch.consumed_at || new Date(ch.expires_at) < new Date() || ch.attempts >= this.cfg.otpMaxAttempts) throw E.expiredOtp();
    if (!safeEqualHex(ch.code_hash, this.codeHash(id, normalizeDigits(code)))) {
      const up = await this.db.query<{ attempts: number }>(`update otp_challenges set attempts = attempts + 1 where id = $1 returning attempts`, [id]);
      const left = this.cfg.otpMaxAttempts - up.rows[0].attempts;
      if (left <= 0) throw E.expiredOtp();
      throw E.invalidOtp(left);
    }
    const done = await this.db.query(`update otp_challenges set consumed_at = now() where id = $1 and consumed_at is null returning id`, [id]);
    if (!done.rows.length) throw E.expiredOtp(); // lost a race with a parallel verify
    return ch as { destination: string; channel: "sms" | "email"; action_hash: string | null; user_id: string | null };
  }

  // ---------------------------------------------------------------- login / signup
  async requestLoginOtp(raw: string) {
    const { destination, channel } = this.parseDestination(raw);
    const u = await this.db.query(`select id from users where ${channel === "sms" ? "mobile" : "email"} = $1`, [destination]);
    // Same response whether or not the account exists (no user enumeration).
    return this.issueChallenge(destination, channel, "login", u.rows[0]?.id ?? null, null);
  }

  async verifyLogin(req: AppRequest, input: { challenge_id: string; code: string; device_fingerprint: string; device_label?: string }) {
    const ch = await this.consumeChallenge(input.challenge_id, input.code, "login");
    return this.db.tx(async (q) => {
      const col = ch.channel === "sms" ? "mobile" : "email";
      let user = (await q.query(`select * from users where ${col} = $1`, [ch.destination])).rows[0];
      const isNew = !user;
      if (isNew) {
        user = (await q.query(`insert into users (id, ${col}) values ($1, $2) returning *`, [uuidv7(), ch.destination])).rows[0];
        await this.audit.append(q, { actorUserId: user.id, action: "user.signed_up", entityType: "user", entityId: user.id, after: { channel: ch.channel }, ip: req.ip });
      }
      if (user.status !== "active") throw E.disabled();

      const device = (
        await q.query(
          `insert into user_devices (id, user_id, fingerprint, label) values ($1,$2,$3,$4)
           on conflict (user_id, fingerprint) do update set last_seen_at = now(), label = coalesce(excluded.label, user_devices.label)
           returning id, revoked_at, (xmax = 0) as inserted`,
          [uuidv7(), user.id, input.device_fingerprint, input.device_label ?? null],
        )
      ).rows[0];
      if (device.revoked_at) {
        // A revoked device is re-trusted only by a fresh OTP login — which just happened.
        await q.query(`update user_devices set revoked_at = null where id = $1`, [device.id]);
      }
      await q.query(`update users set last_login_at = now() where id = $1`, [user.id]);
      const tokens = await this.createSession(q, user.id, device.id);
      await this.audit.append(q, {
        actorUserId: user.id, action: "auth.login", entityType: "session", entityId: tokens.session_id,
        after: { new_device: device.inserted === true, channel: ch.channel }, ip: req.ip, deviceId: device.id,
      });
      return { ...tokens, is_new_user: isNew, user: this.publicUser(user) };
    });
  }

  private async accessToken(userId: string, sessionId: string, deviceId: string) {
    return new SignJWT({ sid: sessionId, did: deviceId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("tp-api")
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.accessTokenTtlSec}s`)
      .sign(this.cfg.jwtSecret);
  }

  private async createSession(q: Queryable, userId: string, deviceId: string) {
    const id = uuidv7();
    const refresh = randomToken();
    await q.query(
      `insert into sessions (id, user_id, device_id, refresh_token_hash, expires_at) values ($1,$2,$3,$4, now() + make_interval(secs => $5))`,
      [id, userId, deviceId, sha256Hex(refresh), this.cfg.refreshTokenTtlSec],
    );
    return {
      session_id: id,
      access_token: await this.accessToken(userId, id, deviceId),
      refresh_token: refresh,
      expires_in: this.cfg.accessTokenTtlSec,
    };
  }

  /** Rotating refresh tokens. Presenting an already-rotated token revokes the session (stolen-token detection). */
  async refresh(refreshToken: string) {
    const h = sha256Hex(refreshToken);
    const out = await this.db.tx(async (q) => {
      const reused = await q.query(`select id from sessions where previous_refresh_token_hash = $1 and revoked_at is null for update`, [h]);
      if (reused.rows.length) {
        // Commit the revocation (do not throw inside the transaction, or it would roll back).
        await q.query(`update sessions set revoked_at = now(), revoke_reason = 'refresh_reuse' where id = $1`, [reused.rows[0].id]);
        await this.audit.append(q, { action: "auth.refresh_reuse_detected", entityType: "session", entityId: reused.rows[0].id });
        return null;
      }
      const s = (await q.query(`select * from sessions where refresh_token_hash = $1 for update`, [h])).rows[0];
      if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) return null;
      const next = randomToken();
      await q.query(
        `update sessions set previous_refresh_token_hash = refresh_token_hash, refresh_token_hash = $2, rotated_at = now() where id = $1`,
        [s.id, sha256Hex(next)],
      );
      return { session_id: s.id, access_token: await this.accessToken(s.user_id, s.id, s.device_id), refresh_token: next, expires_in: this.cfg.accessTokenTtlSec };
    });
    if (!out) throw E.badRefresh();
    return out;
  }

  async logout(req: AppRequest) {
    await this.db.tx(async (q) => {
      await q.query(`update sessions set revoked_at = now(), revoke_reason = 'logout' where id = $1 and revoked_at is null`, [req.user!.sessionId]);
      await this.audit.append(q, { ...actor(req), action: "auth.logout", entityType: "session", entityId: req.user!.sessionId });
    });
  }

  // ---------------------------------------------------------------- step-up (FR-AUTH-4)
  async requestStepUp(req: AppRequest, action: { method: string; path: string; body?: unknown }) {
    const u = req.user!;
    const dest = u.mobile ?? u.email;
    if (!dest) throw E.badDestination();
    return this.issueChallenge(dest, u.mobile ? "sms" : "email", "step_up", u.id, actionHash(action.method, action.path, action.body ?? {}));
  }

  async verifyStepUp(req: AppRequest, input: { challenge_id: string; code: string }) {
    const ch = await this.consumeChallenge(input.challenge_id, input.code, "step_up");
    if (ch.user_id !== req.user!.id || !ch.action_hash) throw E.expiredOtp();
    const token = randomToken();
    await this.db.query(
      `insert into step_up_tokens (id, user_id, token_hash, action_hash, expires_at) values ($1,$2,$3,$4, now() + make_interval(secs => $5))`,
      [uuidv7(), req.user!.id, sha256Hex(token), ch.action_hash, this.cfg.stepUpTtlSec],
    );
    return { step_up_token: token, expires_in: this.cfg.stepUpTtlSec };
  }

  // ---------------------------------------------------------------- profile, Shahkar, devices
  publicUser(u: any) {
    return {
      id: u.id,
      mobile: u.mobile,
      email: u.email,
      full_name: u.full_name,
      shahkar_status: u.shahkar_status,
      national_code_masked: u.national_code_enc ? mask(decrypt(this.cfg.dataEncryptionKey, u.national_code_enc)) : null,
    };
  }

  async me(req: AppRequest) {
    const u = (await this.db.query(`select * from users where id = $1`, [req.user!.id])).rows[0];
    const orgs = await this.db.query(
      `select o.id, o.legal_name, o.national_id, o.kyb_status, o.is_investor, o.is_issuer, o.is_applicant, o.org_kind, m.role
       from org_members m join orgs o on o.id = m.org_id where m.user_id = $1 and m.status = 'active' order by o.legal_name`,
      [req.user!.id],
    );
    return { ...this.publicUser(u), staff_roles: req.user!.staffRoles, organisations: orgs.rows };
  }

  async updateProfile(req: AppRequest, fullName: string) {
    return this.db.tx(async (q) => {
      const before = (await q.query(`select full_name from users where id = $1`, [req.user!.id])).rows[0];
      const u = (await q.query(`update users set full_name = $2, updated_at = now() where id = $1 returning *`, [req.user!.id, fullName])).rows[0];
      await this.audit.append(q, { ...actor(req), action: "user.profile_updated", entityType: "user", entityId: u.id, before, after: { full_name: fullName } });
      return this.publicUser(u);
    });
  }

  /** FR-AUTH-6: national code + Shahkar (mobile ↔ national code) before acting for any organisation. */
  async setNationalCode(req: AppRequest, raw: string) {
    const code = normalizeDigits(raw.trim());
    if (!isValidNationalCode(code)) throw new ApiError(400, "NATIONAL_CODE_INVALID", "Invalid national code", "کد ملی معتبر نیست.");
    const u = req.user!;
    if (!u.mobile) throw new ApiError(400, "MOBILE_REQUIRED", "Add a mobile number first", "ابتدا شماره موبایل خود را ثبت کنید.");
    const current = (await this.db.query(`select shahkar_status from users where id = $1`, [u.id])).rows[0];
    if (current.shahkar_status === "verified")
      throw new ApiError(409, "ALREADY_VERIFIED", "Identity already verified", "هویت شما قبلاً تأیید شده است.");
    const hash = hmacHex(this.cfg.pepper, `nc:${code}`);
    const taken = await this.db.query(`select id from users where national_code_hash = $1 and id <> $2`, [hash, u.id]);
    if (taken.rows.length)
      throw new ApiError(409, "NATIONAL_CODE_IN_USE", "This national code belongs to another account", "این کد ملی برای حساب دیگری ثبت شده است.");

    const matched = await this.identity.matchMobileNationalCode(u.mobile, code);
    const row = await this.db.tx(async (q) => {
      const r = (
        await q.query(
          `update users set national_code_enc = $2, national_code_hash = $3, shahkar_status = $4, shahkar_checked_at = now(), updated_at = now()
           where id = $1 returning *`,
          [u.id, encrypt(this.cfg.dataEncryptionKey, code), matched ? hash : null, matched ? "verified" : "failed"],
        )
      ).rows[0];
      await this.audit.append(q, { ...actor(req), action: matched ? "user.shahkar_verified" : "user.shahkar_failed", entityType: "user", entityId: u.id, after: { shahkar_status: r.shahkar_status } });
      return r;
    });
    // Thrown after commit so the failed status and its audit entry are kept.
    if (!matched)
      throw new ApiError(422, "SHAHKAR_MISMATCH", "Mobile number is not registered to this national code", "شماره موبایل به نام این کد ملی ثبت نشده است.");
    return this.publicUser(row);
  }

  async listDevices(req: AppRequest) {
    const { rows } = await this.db.query(
      `select id, label, first_seen_at, last_seen_at, revoked_at, (id = $2) as current from user_devices where user_id = $1 order by last_seen_at desc`,
      [req.user!.id, req.user!.deviceId],
    );
    return rows;
  }

  async revokeDevice(req: AppRequest, deviceId: string) {
    await this.db.tx(async (q) => {
      const d = await q.query(`update user_devices set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id`, [deviceId, req.user!.id]);
      if (!d.rows.length) throw new ApiError(404, "NOT_FOUND", "Device not found", "دستگاه یافت نشد.");
      await q.query(`update sessions set revoked_at = now(), revoke_reason = 'device_revoked' where device_id = $1 and revoked_at is null`, [deviceId]);
      await this.audit.append(q, { ...actor(req), action: "device.revoked", entityType: "device", entityId: deviceId });
    });
  }
}

const mask = (code: string) => `${code.slice(0, 3)}****${code.slice(-3)}`;
