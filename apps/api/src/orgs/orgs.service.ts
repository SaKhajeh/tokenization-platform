import { Inject, Injectable } from "@nestjs/common";
import { DB, Db, Queryable } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { ApiError, Errors } from "../common/errors.js";
import { uuidv7 } from "../common/ids.js";
import { randomToken, sha256Hex } from "../common/crypto.js";
import { isValidLegalNationalId, normalizeDigits, normalizeEmail, normalizeMobile } from "../common/validators.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL, MessageSender, SMS } from "../integrations/providers.js";
import { actor, AppRequest, OrgRole } from "../common/context.js";

const E = {
  shahkar: () => new ApiError(403, "SHAHKAR_REQUIRED", "Verify your national code first", "ابتدا کد ملی خود را تأیید کنید."),
  legalId: () => new ApiError(400, "LEGAL_ID_INVALID", "Invalid legal national ID", "شناسه ملی شخص حقوقی معتبر نیست."),
  orgExists: () => new ApiError(409, "ORG_EXISTS", "This organisation is already registered; ask its admin to invite you", "این سازمان قبلاً ثبت شده است؛ از مدیر سازمان دعوت‌نامه بخواهید."),
  lastAdmin: () => new ApiError(409, "LAST_ADMIN", "An organisation must keep at least one active admin", "سازمان باید دست‌کم یک مدیر فعال داشته باشد."),
  singleUser: () => new ApiError(409, "SINGLE_USER_NOT_ALLOWED", "Single-user mode needs exactly one active member", "حالت تک‌کاربره فقط با یک عضو فعال ممکن است."),
  invitation: () => new ApiError(404, "INVITATION_INVALID", "Invitation not found, expired or already used", "دعوت‌نامه نامعتبر، منقضی یا استفاده‌شده است."),
  notInvitee: () => new ApiError(403, "INVITATION_NOT_FOR_YOU", "This invitation was sent to another mobile/email", "این دعوت‌نامه برای شماره یا ایمیل دیگری ارسال شده است."),
  alreadyMember: () => new ApiError(409, "ALREADY_MEMBER", "Already an active member", "این کاربر هم‌اکنون عضو سازمان است."),
};

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(SMS) private readonly sms: MessageSender,
    @Inject(EMAIL) private readonly email: MessageSender,
    private readonly audit: AuditService,
  ) {}

  /** FR-ORG-1: a Shahkar-verified user registers an organisation and becomes its org_admin. */
  async create(req: AppRequest, input: { legal_name: string; national_id: string; legal_form?: string; registration_no?: string }) {
    if (req.user!.shahkarStatus !== "verified") throw E.shahkar();
    const nid = normalizeDigits(input.national_id.trim());
    if (!/^\d{11}$/.test(nid) || (this.cfg.validateLegalIdChecksum && !isValidLegalNationalId(nid))) throw E.legalId();
    return this.db.tx(async (q) => {
      const exists = await q.query(`select id from orgs where national_id = $1`, [nid]);
      if (exists.rows.length) throw E.orgExists();
      const id = uuidv7();
      const org = (
        await q.query(
          `insert into orgs (id, legal_name, national_id, legal_form, registration_no, created_by, single_user_mode) values ($1,$2,$3,$4,$5,$6, true) returning *`,
          [id, input.legal_name.trim(), nid, input.legal_form ?? null, input.registration_no ?? null, req.user!.id],
        )
      ).rows[0];
      await q.query(`insert into org_members (id, org_id, user_id, role) values ($1,$2,$3,'org_admin')`, [uuidv7(), id, req.user!.id]);
      await this.audit.append(q, { ...actor(req), orgId: id, action: "org.created", entityType: "org", entityId: id, after: { legal_name: org.legal_name, national_id: nid } });
      return { ...this.publicOrg(org), my_role: "org_admin" };
    });
  }

  publicOrg(o: any) {
    return {
      id: o.id,
      legal_name: o.legal_name,
      national_id: o.national_id,
      legal_form: o.legal_form,
      registration_no: o.registration_no,
      is_investor: o.is_investor,
      is_issuer: o.is_issuer,
      is_applicant: o.is_applicant,
      org_kind: o.org_kind,
      single_user_mode: o.single_user_mode,
      status: o.status,
      kyb_status: o.kyb_status,
      kyb_expires_at: o.kyb_expires_at,
      created_at: o.created_at,
    };
  }

  async current(req: AppRequest, q: Queryable = this.db) {
    const o = (await q.query(`select * from orgs where id = $1`, [req.org!.id])).rows[0];
    const n = await this.activeCount(q, req.org!.id);
    return { ...this.publicOrg(o), my_role: req.org!.role, active_members: n, requires_second_approver: !(o.single_user_mode && n === 1) };
  }

  private async activeCount(q: Queryable, orgId: string): Promise<number> {
    const r = await q.query(`select count(*)::int as n from org_members where org_id = $1 and status = 'active'`, [orgId]);
    return r.rows[0].n;
  }

  private async activeAdmins(q: Queryable, orgId: string): Promise<number> {
    const r = await q.query(`select count(*)::int as n from org_members where org_id = $1 and status = 'active' and role = 'org_admin'`, [orgId]);
    return r.rows[0].n;
  }

  /** FR-ORG-5 / D17. Enabling requires exactly one active member. */
  async updateSettings(req: AppRequest, input: { single_user_mode: boolean }) {
    return this.db.tx(async (q) => {
      const before = (await q.query(`select single_user_mode from orgs where id = $1 for update`, [req.org!.id])).rows[0];
      if (input.single_user_mode && (await this.activeCount(q, req.org!.id)) !== 1) throw E.singleUser();
      await q.query(`update orgs set single_user_mode = $2, updated_at = now() where id = $1`, [req.org!.id, input.single_user_mode]);
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "org.settings_updated", entityType: "org", entityId: req.org!.id, before, after: input });
      return this.current(req, q); // read inside the transaction (PGlite has one connection; pg would read stale data)
    });
  }

  async members(req: AppRequest) {
    const { rows } = await this.db.query(
      `select m.id, m.user_id, m.role, m.status, m.created_at, u.full_name, u.mobile, u.email, u.shahkar_status,
              (m.authority_verified_at is not null) as authority_verified
       from org_members m join users u on u.id = m.user_id
       where m.org_id = $1 and m.status <> 'removed' order by m.created_at`,
      [req.org!.id],
    );
    return rows.map((r) => ({ ...r, mobile: r.mobile ? `${r.mobile.slice(0, 4)}***${r.mobile.slice(-4)}` : null }));
  }

  /** FR-ORG-3: invite by mobile or email. The token goes out by SMS/email; it is returned only in dev/test. */
  async invite(req: AppRequest, input: { destination: string; role: OrgRole }) {
    const mobile = normalizeMobile(input.destination);
    const email = mobile ? null : normalizeEmail(input.destination);
    if (!mobile && !email) throw new ApiError(400, "INVALID_DESTINATION", "Enter a valid mobile number or email", "شماره موبایل یا ایمیل معتبر وارد کنید.");
    const dest = (mobile ?? email)!;
    const channel = mobile ? "sms" : "email";
    const token = randomToken();
    const out = await this.db.tx(async (q) => {
      const member = await q.query(
        `select 1 from org_members m join users u on u.id = m.user_id where m.org_id = $1 and m.status = 'active' and (u.mobile = $2 or u.email = $2)`,
        [req.org!.id, dest],
      );
      if (member.rows.length) throw E.alreadyMember();
      // A new invitation to the same person replaces any open one.
      await q.query(`update org_invitations set revoked_at = now() where org_id = $1 and destination = $2 and accepted_at is null and revoked_at is null`, [req.org!.id, dest]);
      const id = uuidv7();
      await q.query(
        `insert into org_invitations (id, org_id, destination, channel, role, token_hash, invited_by, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))`,
        [id, req.org!.id, dest, channel, input.role, sha256Hex(token), req.user!.id, this.cfg.invitationTtlSec],
      );
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "member.invited", entityType: "invitation", entityId: id, after: { destination: dest, role: input.role } });
      return { id, destination: dest, role: input.role };
    });
    const orgName = (await this.db.query(`select legal_name from orgs where id = $1`, [req.org!.id])).rows[0].legal_name;
    await (channel === "sms" ? this.sms : this.email).sendText(dest, `دعوت به «${orgName}» در پلتفرم توکن‌سازی. کد دعوت: ${token}`, out.id);
    return { ...out, ...(this.cfg.exposeInvitationTokens ? { token } : {}) };
  }

  async revokeInvitation(req: AppRequest, id: string) {
    await this.db.tx(async (q) => {
      const r = await q.query(
        `update org_invitations set revoked_at = now() where id = $1 and org_id = $2 and accepted_at is null and revoked_at is null returning id`,
        [id, req.org!.id],
      );
      if (!r.rows.length) throw E.invitation();
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "member.invitation_revoked", entityType: "invitation", entityId: id });
    });
  }

  async listInvitations(req: AppRequest) {
    const { rows } = await this.db.query(
      `select id, destination, channel, role, expires_at, created_at from org_invitations
       where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc`,
      [req.org!.id],
    );
    return rows;
  }

  /** The invitee accepts while logged in with the invited mobile/email. */
  async accept(req: AppRequest, token: string) {
    return this.db.tx(async (q) => {
      const inv = (
        await q.query(`select * from org_invitations where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`, [sha256Hex(token)])
      ).rows[0];
      if (!inv) throw E.invitation();
      const u = req.user!;
      if (inv.destination !== u.mobile && inv.destination !== u.email) throw E.notInvitee();
      const existing = (await q.query(`select * from org_members where org_id = $1 and user_id = $2`, [inv.org_id, u.id])).rows[0];
      if (existing?.status === "active") throw E.alreadyMember();
      const memberId = existing?.id ?? uuidv7();
      if (existing) {
        await q.query(`update org_members set role = $2, status = 'active', invited_by = $3, updated_at = now() where id = $1`, [existing.id, inv.role, inv.invited_by]);
      } else {
        await q.query(`insert into org_members (id, org_id, user_id, role, invited_by) values ($1,$2,$3,$4,$5)`, [memberId, inv.org_id, u.id, inv.role, inv.invited_by]);
      }
      await q.query(`update org_invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, u.id]);
      await this.audit.append(q, { ...actor(req), orgId: inv.org_id, action: "member.joined", entityType: "member", entityId: memberId, after: { role: inv.role, invitation_id: inv.id } });
      // D17: a second active member ends single-user mode (maker–checker applies again).
      const o = (await q.query(`select single_user_mode from orgs where id = $1 for update`, [inv.org_id])).rows[0];
      if (o.single_user_mode && (await this.activeCount(q, inv.org_id)) > 1) {
        await q.query(`update orgs set single_user_mode = false, updated_at = now() where id = $1`, [inv.org_id]);
        await this.audit.append(q, { actorType: "system", orgId: inv.org_id, action: "org.single_user_mode_ended", entityType: "org", entityId: inv.org_id, before: { single_user_mode: true }, after: { single_user_mode: false } });
      }
      return { org_id: inv.org_id, member_id: memberId, role: inv.role };
    });
  }

  /** FR-ORG-3: change role or status. The last active admin cannot be demoted, suspended or removed. */
  async updateMember(req: AppRequest, memberId: string, input: { role?: OrgRole; status?: "active" | "suspended" | "removed" }) {
    return this.db.tx(async (q) => {
      // Lock all members of the org so two admins cannot demote each other concurrently.
      await q.query(`select id from org_members where org_id = $1 for update`, [req.org!.id]);
      const m = (await q.query(`select * from org_members where id = $1 and org_id = $2`, [memberId, req.org!.id])).rows[0];
      if (!m || m.status === "removed") throw Errors.notFound("Member");
      const next = { role: input.role ?? m.role, status: input.status ?? m.status };
      const losesAdmin = m.role === "org_admin" && m.status === "active" && (next.role !== "org_admin" || next.status !== "active");
      if (losesAdmin && (await this.activeAdmins(q, req.org!.id)) <= 1) throw E.lastAdmin();
      await q.query(`update org_members set role = $2, status = $3, updated_at = now() where id = $1`, [memberId, next.role, next.status]);
      if (next.status !== "active") {
        // Removing/suspending a member ends their access immediately for this org only — nothing else to revoke in M-A.
      }
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "member.updated", entityType: "member", entityId: memberId, before: { role: m.role, status: m.status }, after: next });
      return { id: memberId, user_id: m.user_id, ...next };
    });
  }
}
