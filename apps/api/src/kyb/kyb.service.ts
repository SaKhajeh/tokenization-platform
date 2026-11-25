/**
 * KYB for legal entities (PRD M3, plan/04 §2.1).
 *
 * 1. fetchRegistry — org_admin pulls the company's official record from Jibit (name, registration, state, CEO, board,
 *    signature rules). Stored as a snapshot; billed per call, so it is reused for 30 days.
 * 2. submit — org_admin (step-up) submits declared details. Authority: if the submitter's verified national code is
 *    the CEO or a board member in the snapshot, authority is "registry"; otherwise an introduction letter
 *    (معرفی‌نامه) document is required. Risk flags are computed for the reviewer, never auto-rejected.
 * 3. decide — compliance officer (not a member of the org) approves / rejects / asks for more information.
 *    Approval creates the org's custodial wallet and queues its on-chain digital-ID registration.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { keccak256, toUtf8Bytes } from "ethers";
import { DB, type Db } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { canonicalJson, decrypt } from "../common/crypto.js";
import { normalizeDigits } from "../common/validators.js";
import { REGISTRY, type RegistryProvider, type LegalIdentity } from "../integrations/registry.js";
import { ChainService } from "../chain/chain.service.js";
import { DepositsService } from "../deposits/deposits.service.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { withLease } from "../common/lease.js";
import { CasesService } from "../cases/cases.service.js";

export interface KybFields {
  activity: string;
  address: string;
  postal_code: string;
  phone: string;
  website?: string;
  contact_email?: string;
}

/** Compare Persian company names loosely: Arabic/Persian letters, ZWNJ, spaces, "شرکت", punctuation. */
export function normalizeFaName(s: string): string {
  return normalizeDigits(s)
    .replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌‏‎]/g, "")
    .replace(/شرکت|سهامی|خاص|عام|مسئولیت|محدود|تعاونی|موسسه|مؤسسه|[()«»"'.,،\-_/]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

const kybErr = {
  notInRegistry: () => new ApiError(422, "NOT_IN_REGISTRY", "Company not found in the official registry", "شرکت با این شناسه ملی در سامانه ثبت یافت نشد."),
  shahkar: () => new ApiError(403, "SHAHKAR_REQUIRED", "Verify your national code first", "ابتدا کد ملی خود را تأیید کنید."),
  alreadyOpen: () => new ApiError(409, "KYB_IN_REVIEW", "A KYB case is already under review", "پرونده احراز هویت شرکت در حال بررسی است."),
  alreadyApproved: () => new ApiError(409, "KYB_ALREADY_APPROVED", "KYB is already approved", "احراز هویت شرکت قبلاً تأیید شده است."),
  staleSnapshot: () => new ApiError(422, "REGISTRY_SNAPSHOT_STALE", "Registry data is too old; fetch it again", "اطلاعات ثبتی قدیمی است؛ دوباره استعلام بگیرید."),
  authorityDoc: () =>
    new ApiError(422, "AUTHORITY_DOCUMENT_REQUIRED", "You are not listed as CEO or board member; attach an introduction letter", "نام شما در فهرست مدیرعامل یا هیئت‌مدیره نیست؛ معرفی‌نامه رسمی پیوست کنید."),
  badDoc: () => new ApiError(422, "DOCUMENT_INVALID", "Document not found or not uploaded", "سند پیوست یافت نشد یا بارگذاری نشده است."),
  conflict: () => new ApiError(403, "CONFLICT_OF_INTEREST", "Reviewers cannot decide on their own organisation", "بررسی پرونده سازمانی که عضو آن هستید مجاز نیست."),
  notReviewable: () => new ApiError(409, "KYB_NOT_IN_REVIEW", "This case is not under review", "این پرونده در وضعیت بررسی نیست."),
};

@Injectable()
export class KybService {
  private readonly log = new Logger("kyb");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REGISTRY) private readonly registry: RegistryProvider,
    private readonly audit: AuditService,
    private readonly chain: ChainService,
    private readonly deposits: DepositsService,
    private readonly notifications: NotificationsService,
    private readonly cases: CasesService,
  ) {}

  private async org(id: string) {
    return (await this.db.query(`select * from orgs where id = $1`, [id])).rows[0];
  }

  private publicSnapshot(row: any) {
    const d = row.data as LegalIdentity;
    return {
      id: row.id,
      fetched_at: row.fetched_at,
      name: d.name,
      national_id: d.nationalId,
      register_number: d.registerNumber,
      register_date: d.registerDate,
      company_type: d.companyType,
      state: d.state,
      activity: d.activity,
      address: d.address,
      postal_code: d.postalCode,
      signature_authority: d.signatureAuthority,
      bankrupt: d.bankrupt,
      suspended: d.suspended,
      // national codes of people are never sent back to the client
      people: d.people.map((p) => ({ name: p.name, position: p.position, roles: p.roles })),
    };
  }

  private async myNationalCode(userId: string): Promise<string | null> {
    const u = (await this.db.query(`select national_code_enc, shahkar_status from users where id = $1`, [userId])).rows[0];
    if (!u || u.shahkar_status !== "verified" || !u.national_code_enc) return null;
    return decrypt(this.cfg.dataEncryptionKey, u.national_code_enc);
  }

  // ------------------------------------------------------------------ org side

  async fetchRegistry(req: AppRequest) {
    const o = await this.org(req.org!.id);
    const recent = (
      await this.db.query(`select * from legal_identity_snapshots where org_id = $1 and fetched_at > now() - interval '1 day' order by fetched_at desc limit 1`, [o.id])
    ).rows[0];
    let row = recent;
    if (!row) {
      const li = await this.registry.legalIdentity(o.national_id);
      if (!li) throw kybErr.notInRegistry();
      const { raw, ...data } = li;
      row = (
        await this.db.query(
          `insert into legal_identity_snapshots (id, org_id, national_id, data, raw, fetched_by) values ($1,$2,$3,$4,$5,$6) returning *`,
          [uuidv7(), o.id, o.national_id, JSON.stringify(data), JSON.stringify(raw ?? {}), req.user!.id],
        )
      ).rows[0];
      await this.audit.append(this.db, { ...actor(req), orgId: o.id, action: "kyb.registry_fetched", entityType: "org", entityId: o.id, after: { snapshot_id: row.id } });
    }
    const nc = await this.myNationalCode(req.user!.id);
    const listed = !!nc && (row.data as LegalIdentity).people.some((p) => p.nationalCode === nc);
    return { snapshot: this.publicSnapshot(row), you_are_listed: listed };
  }

  async current(req: AppRequest) {
    const o = await this.org(req.org!.id);
    const c = (await this.db.query(`select * from kyb_cases where org_id = $1 order by version desc limit 1`, [o.id])).rows[0];
    return {
      kyb_status: o.kyb_status,
      kyb_expires_at: o.kyb_expires_at,
      case: c
        ? {
            id: c.id, version: c.version, status: c.status, fields: c.fields, authority_basis: c.authority_basis,
            submitted_at: c.submitted_at, reviewed_at: c.reviewed_at, decision_reason: c.decision_reason, expires_at: c.expires_at,
          }
        : null,
    };
  }

  async submit(req: AppRequest, input: { snapshot_id: string; fields: KybFields; authority_doc_id?: string; articles_doc_id?: string; gazette_doc_id?: string }) {
    const nc = await this.myNationalCode(req.user!.id);
    if (!nc) throw kybErr.shahkar();
    const orgId = req.org!.id;

    const snap = (await this.db.query(`select * from legal_identity_snapshots where id = $1 and org_id = $2`, [input.snapshot_id, orgId])).rows[0];
    if (!snap) throw Errors.notFound("Registry snapshot");
    if (Date.now() - new Date(snap.fetched_at).getTime() > this.cfg.kyb.snapshotMaxAgeDays * 86400_000) throw kybErr.staleSnapshot();
    const li = snap.data as LegalIdentity;

    const listed = li.people.some((p) => p.nationalCode === nc);
    if (!listed && !input.authority_doc_id) throw kybErr.authorityDoc();
    for (const docId of [input.authority_doc_id, input.articles_doc_id, input.gazette_doc_id]) {
      if (!docId) continue;
      const d = (await this.db.query(`select id from documents where id = $1 and org_id = $2 and status = 'uploaded'`, [docId, orgId])).rows[0];
      if (!d) throw kybErr.badDoc();
    }

    // Risk signals for the reviewer (inquiries outside the transaction; they are slow and billed).
    const o = await this.org(orgId);
    const flags: string[] = [];
    if (li.state && !/فعال|active/i.test(li.state)) flags.push("registry_state_not_active");
    if (li.bankrupt) flags.push("bankrupt");
    if (li.suspended) flags.push("suspended");
    if (normalizeFaName(li.name) !== normalizeFaName(o.legal_name)) flags.push("name_differs_from_registry");
    const postal = normalizeDigits(input.fields.postal_code);
    if (li.postalCode && li.postalCode !== postal) flags.push("postal_code_differs_from_registry");
    let bounced: number | null = null;
    try {
      bounced = await this.registry.bouncedChequeCount(o.national_id);
      if (bounced > 0) flags.push("bounced_cheques");
    } catch (e: any) {
      flags.push("bounced_cheque_check_unavailable");
      this.log.warn(`bounced cheque inquiry failed: ${e?.message ?? e}`);
    }
    if (!listed) flags.push("authority_by_document");

    return this.db.tx(async (q) => {
      const cur = (await q.query(`select kyb_status, kyb_expires_at from orgs where id = $1 for update`, [orgId])).rows[0];
      if (cur.kyb_status === "in_review") throw kybErr.alreadyOpen();
      if (cur.kyb_status === "approved" && cur.kyb_expires_at && new Date(cur.kyb_expires_at) > new Date(Date.now() + 30 * 86400_000))
        throw kybErr.alreadyApproved(); // re-KYB allowed only in the last 30 days before expiry
      const version = Number((await q.query(`select coalesce(max(version), 0) + 1 as v from kyb_cases where org_id = $1`, [orgId])).rows[0].v);
      const id = uuidv7();
      const fields = { ...input.fields, postal_code: postal, phone: normalizeDigits(input.fields.phone) };
      await q.query(
        `insert into kyb_cases (id, org_id, version, status, fields, snapshot_id, risk_flags, bounced_cheques, submitted_by, authority_basis, authority_doc_id, articles_doc_id, gazette_doc_id)
         values ($1,$2,$3,'in_review',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, orgId, version, JSON.stringify(fields), snap.id, JSON.stringify(flags), bounced, req.user!.id, listed ? "registry" : "document", input.authority_doc_id ?? null,
          input.articles_doc_id ?? null, input.gazette_doc_id ?? null],
      );
      await q.query(`update orgs set kyb_status = 'in_review', updated_at = now() where id = $1`, [orgId]);
      if (input.authority_doc_id) await q.query(`update org_members set authority_doc_id = $2, updated_at = now() where id = $1`, [req.org!.memberId, input.authority_doc_id]);
      await staffTask(q, {
        title: `بررسی احراز هویت: ${o.legal_name}`,
        description: flags.length ? `هشدارها: ${flags.join(", ")}` : undefined,
        linkedType: "kyb_case", linkedId: id, role: "compliance_officer", key: "kyb.review", dueInHours: 48,
        priority: flags.length ? "p0" : "p1",
      });
      // §2a: an org that wants financing gets its credit case now, pre-filled from this registration
      await this.cases.openIfEligible(q, orgId, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId, action: "kyb.submitted", entityType: "kyb_case", entityId: id, after: { version, risk_flags: flags, authority_basis: listed ? "registry" : "document" } });
      return { id, version, status: "in_review", risk_flags: flags, authority_basis: listed ? "registry" : "document" };
    });
  }

  // ------------------------------------------------------------------ compliance side

  async list(status?: string) {
    const r = await this.db.query(
      `select c.id, c.org_id, o.legal_name, o.national_id, c.version, c.status, c.risk_flags, c.authority_basis, c.submitted_at, c.reviewed_at
       from kyb_cases c join orgs o on o.id = c.org_id where ($1::text is null or c.status = $1) order by c.submitted_at limit 200`,
      [status ?? null],
    );
    return r.rows;
  }

  async get(id: string) {
    const c = (await this.db.query(`select c.*, o.legal_name, o.national_id from kyb_cases c join orgs o on o.id = c.org_id where c.id = $1`, [id])).rows[0];
    if (!c) throw Errors.notFound("KYB case");
    const snap = (await this.db.query(`select * from legal_identity_snapshots where id = $1`, [c.snapshot_id])).rows[0];
    const submitter = (await this.db.query(`select id, full_name, mobile from users where id = $1`, [c.submitted_by])).rows[0];
    return {
      id: c.id, org_id: c.org_id, legal_name: c.legal_name, national_id: c.national_id, version: c.version, status: c.status,
      fields: c.fields, risk_flags: c.risk_flags, bounced_cheques: c.bounced_cheques, authority_basis: c.authority_basis,
      authority_doc_id: c.authority_doc_id, submitted_by: submitter, submitted_at: c.submitted_at,
      registry: this.publicSnapshot(snap), reviewed_at: c.reviewed_at, decision_reason: c.decision_reason, expires_at: c.expires_at,
    };
  }

  async decide(req: AppRequest, id: string, input: { decision: "approve" | "reject" | "request_info"; reason?: string; expires_at?: string }) {
    if (input.decision !== "approve" && !input.reason?.trim())
      throw new ApiError(422, "REASON_REQUIRED", "A reason is required", "ذکر دلیل الزامی است.");
    let approvedOrg: string | null = null;
    const result = await this.db.tx(async (q) => {
      const c = (await q.query(`select * from kyb_cases where id = $1 for update`, [id])).rows[0];
      if (!c) throw Errors.notFound("KYB case");
      if (c.status !== "in_review") throw kybErr.notReviewable();
      const member = (await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status <> 'removed'`, [c.org_id, req.user!.id])).rows[0];
      if (member) throw kybErr.conflict();

      const status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "info_requested";
      let expiresAt: Date | null = null;
      let kybHash: string | null = null;
      if (status === "approved") {
        const max = Date.now() + 2 * 365 * 86400_000;
        expiresAt = input.expires_at ? new Date(input.expires_at) : new Date(Date.now() + this.cfg.kyb.validityDays * 86400_000);
        if (!(expiresAt.getTime() > Date.now()) || expiresAt.getTime() > max)
          throw new ApiError(422, "EXPIRY_INVALID", "Expiry must be in the future and within 2 years", "تاریخ انقضا باید در آینده و حداکثر دو سال بعد باشد.");
        kybHash = keccak256(toUtf8Bytes(canonicalJson({ case_id: c.id, org_id: c.org_id, version: c.version, snapshot_id: c.snapshot_id, expires_at: expiresAt.toISOString() })));
      }
      await q.query(
        `update kyb_cases set status=$2, reviewer_id=$3, reviewed_at=now(), decision_reason=$4, expires_at=$5, kyb_hash=$6 where id=$1`,
        [id, status, req.user!.id, input.reason ?? null, expiresAt, kybHash],
      );

      if (status === "approved") {
        const snap = (await q.query(`select data from legal_identity_snapshots where id = $1`, [c.snapshot_id])).rows[0].data as LegalIdentity;
        const org = (
          await q.query(
            `update orgs set kyb_status='approved', kyb_expires_at=$2, legal_name=coalesce(nullif($3, ''), legal_name), registration_no=coalesce($4, registration_no), updated_at=now()
             where id=$1 returning *`,
            [c.org_id, expiresAt, snap.name ?? null, snap.registerNumber ?? null],
          )
        ).rows[0];
        // The submitter's authority is now verified (by registry match or by the reviewed document).
        await q.query(
          `update org_members set authority_verified_by=$3, authority_verified_at=now(), updated_at=now() where org_id=$1 and user_id=$2`,
          [c.org_id, c.submitted_by, req.user!.id],
        );
        const w = await this.chain.ensureWallet(q, c.org_id);
        const queuedBefore = (await q.query(`select 1 from chain_txs where ref_type = 'wallet' and ref_id = $1 limit 1`, [w.id])).rows[0];
        if (w.registryStatus === "pending" && !queuedBefore) {
          await this.chain.queueRegistration(q, {
            orgId: c.org_id, walletId: w.id, address: w.address, orgIdHash: w.orgIdHash, kybHash: kybHash!, expiresAt: expiresAt!,
            orgKind: org.org_kind, kybCaseId: c.id,
          });
        } else {
          // Re-KYB: refresh expiry and KYB hash on-chain, and lift a revocation if KYB had expired.
          await this.chain.syncIdentity(q, c.org_id, "kyb_reapproved");
        }
        approvedOrg = c.org_id;
        await this.cases.onKybApproved(q, c.org_id);
      } else {
        // A rejection also ends any earlier approval still running; "info requested" leaves it in place.
        await q.query(
          `update orgs set kyb_status=$2, kyb_expires_at = case when $2 = 'rejected' then null else kyb_expires_at end, updated_at=now() where id=$1`,
          [c.org_id, status],
        );
      }
      await closeWorkflowTasks(q, "kyb_case", id, req.user!.id);
      if (status === "rejected") await this.chain.syncIdentity(q, c.org_id, "kyb_rejected");
      await this.notifications.notify(q, {
        to: { orgId: c.org_id, orgRoles: ["org_admin"] }, event: `kyb.${status}` as "kyb.approved" | "kyb.rejected" | "kyb.info_requested",
        params: { reason: input.reason ?? "" }, dedupeKey: `kyb.${status}:${id}`,
      });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: `kyb.${status}`, entityType: "kyb_case", entityId: id, after: { reason: input.reason ?? null, expires_at: expiresAt } });
      return { id, status, expires_at: expiresAt, kyb_hash: kybHash };
    });

    // Payment ID for deposits: best effort now, created lazily later if Cobank is down.
    if (approvedOrg) {
      try {
        await this.deposits.ensurePayId(approvedOrg);
      } catch (e: any) {
        this.log.warn(`payment ID for org ${approvedOrg} deferred: ${e?.message ?? e}`);
      }
    }
    return result;
  }

  // ------------------------------------------------------------------ expiry job (daily)

  /**
   * Reminds org admins 30 and 7 days before KYB expires, then expires it: status → expired, the digital ID is revoked
   * on-chain (holdings stay; new mints are refused), and deposits are held until re-approval.
   */
  async runExpiry() {
    const res = await withLease(this.db, "kyb.expiry", 600, async () => {
      const out = { reminded: 0, expired: 0 };
      for (const days of [30, 7]) {
        const due = (
          await this.db.query(
            `select id, kyb_expires_at from orgs where kyb_status = 'approved' and kyb_expires_at > now() and kyb_expires_at <= now() + ($1 || ' days')::interval`,
            [String(days)],
          )
        ).rows;
        for (const o of due) {
          await this.db.tx(async (q) => {
            const before = (await q.query(`select count(*)::int as n from notifications where org_id = $1 and dedupe_key = $2`, [o.id, `kyb.expiring:${days}:${o.kyb_expires_at.toISOString?.() ?? o.kyb_expires_at}`])).rows[0].n;
            await this.notifications.notify(q, {
              to: { orgId: o.id, orgRoles: ["org_admin"] }, event: "kyb.expiring",
              params: { days: Math.max(1, Math.ceil((new Date(o.kyb_expires_at).getTime() - Date.now()) / 86400_000)) },
              dedupeKey: `kyb.expiring:${days}:${o.kyb_expires_at.toISOString?.() ?? o.kyb_expires_at}`,
            });
            if (before === 0) out.reminded++;
          });
        }
      }
      const expired = (await this.db.query(`select id from orgs where kyb_status = 'approved' and kyb_expires_at <= now()`)).rows;
      for (const o of expired) {
        await this.db.tx(async (q) => {
          const r = await q.query(`update orgs set kyb_status = 'expired', updated_at = now() where id = $1 and kyb_status = 'approved' returning id`, [o.id]);
          if (!r.rows[0]) return;
          await q.query(`update kyb_cases set status = 'expired' where org_id = $1 and status = 'approved'`, [o.id]);
          await this.chain.syncIdentity(q, o.id, "kyb_expired");
          await this.notifications.notify(q, { to: { orgId: o.id, orgRoles: ["org_admin"] }, event: "kyb.expired", dedupeKey: `kyb.expired:${o.id}:${new Date().toISOString().slice(0, 10)}` });
          await this.audit.append(q, { actorType: "system", orgId: o.id, action: "kyb.expired", entityType: "org", entityId: o.id });
          out.expired++;
        });
      }
      return out;
    });
    return res ?? { skipped: "another worker holds the lease" };
  }
}
