/**
 * Org bank accounts (PRD M4, plan/04 §2.2). Deposits are accepted only from these, and withdrawals (M-C) only go to them.
 *
 * Add (org_admin, step-up): IBAN checksum → Jibit IBAN inquiry (must be ACTIVE) → Jibit IBAN ↔ شناسه ملی match.
 *   matched  → verified; withdrawals to it allowed after a cooling-off period (default 24 h).
 *   no match → pending_review + compliance task (e.g. a name variant). Never auto-verified.
 */
import { Inject, Injectable } from "@nestjs/common";
import { DB, type Db } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { AuditService } from "../audit/audit.service.js";
import { REGISTRY, type RegistryProvider } from "../integrations/registry.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { normalizeDigits } from "../common/validators.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { CasesService } from "../cases/cases.service.js";

/** Normalises and checks an Iranian IBAN (شبا): IR + 24 digits, ISO 13616 mod-97 check. */
export function normalizeIban(input: string): string | null {
  const s = normalizeDigits(input).toUpperCase().replace(/[\s-]/g, "");
  const iban = /^\d{24}$/.test(s) ? `IR${s}` : s;
  if (!/^IR\d{24}$/.test(iban)) return null;
  const rearranged = iban.slice(4) + "1827" + iban.slice(2, 4); // I=18, R=27
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1 ? iban : null;
}

const err = {
  invalid: () => new ApiError(422, "IBAN_INVALID", "Invalid IBAN", "شماره شبا معتبر نیست."),
  notFound: () => new ApiError(422, "IBAN_NOT_FOUND", "IBAN not found at the bank", "شماره شبا در بانک یافت نشد."),
  notActive: (s: string) => new ApiError(422, "IBAN_NOT_ACTIVE", `Account is not active (${s})`, "حساب بانکی فعال نیست."),
  taken: () => new ApiError(409, "IBAN_IN_USE", "This IBAN is already registered", "این شماره شبا قبلاً ثبت شده است."),
  conflict: () => new ApiError(403, "CONFLICT_OF_INTEREST", "Reviewers cannot decide on their own organisation", "بررسی پرونده سازمانی که عضو آن هستید مجاز نیست."),
};

const view = (a: any) => ({
  id: a.id,
  iban: a.iban,
  bank_name: a.bank_name,
  owner_names: a.owner_names,
  status: a.status,
  matched: a.matched,
  is_default: a.is_default,
  verified_at: a.verified_at,
  withdraw_enabled_at: a.withdraw_enabled_at,
  review_reason: a.review_reason,
  created_at: a.created_at,
});

@Injectable()
export class BankAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REGISTRY) private readonly registry: RegistryProvider,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cases: CasesService,
  ) {}

  async list(req: AppRequest) {
    const r = await this.db.query(`select * from bank_accounts where org_id = $1 and status <> 'removed' order by created_at`, [req.org!.id]);
    return r.rows.map(view);
  }

  async add(req: AppRequest, input: { iban: string }) {
    const iban = normalizeIban(input.iban);
    if (!iban) throw err.invalid();
    const orgId = req.org!.id;
    if ((await this.db.query(`select 1 from bank_accounts where iban = $1 and status in ('pending_review','verified')`, [iban])).rows[0]) throw err.taken();

    const org = (await this.db.query(`select national_id, legal_name from orgs where id = $1`, [orgId])).rows[0];
    const info = await this.registry.ibanInfo(iban);
    if (!info) throw err.notFound();
    if (info.status !== "ACTIVE") throw err.notActive(info.status);
    const matched = await this.registry.matchIbanLegal(iban, org.national_id);

    return this.db.tx(async (q) => {
      const hasDefault = (await q.query(`select 1 from bank_accounts where org_id = $1 and is_default and status = 'verified'`, [orgId])).rows[0];
      const id = uuidv7();
      const status = matched ? "verified" : "pending_review";
      const row = (
        await q.query(
          `insert into bank_accounts (id, org_id, iban, bank_name, deposit_number, owner_names, iban_status, matched, status, verified_at, withdraw_enabled_at, is_default, added_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                   case when $8 then now() end,
                   case when $8 then now() + ($10 || ' hours')::interval end,
                   $11,$12) returning *`,
          [id, orgId, iban, info.bank, info.depositNumber, JSON.stringify(info.owners), info.status, matched, status,
            String(this.cfg.bank.coolingOffHours), matched && !hasDefault, req.user!.id],
        )
      ).rows[0];
      if (matched) await this.cases.refreshPrefill(q, orgId, req.user!.id); // §2a
      if (!matched) {
        await staffTask(q, {
          title: `بررسی حساب بانکی: ${org.legal_name}`,
          description: `شبا با شناسه ملی شرکت تطبیق نداشت. صاحبان حساب: ${info.owners.join("، ") || "نامشخص"}`,
          linkedType: "bank_account", linkedId: id, role: "compliance_officer", key: "bank_account.review", dueInHours: 24,
        });
      }
      await this.audit.append(q, { ...actor(req), orgId, action: "bank_account.added", entityType: "bank_account", entityId: id, after: { iban, status, matched } });
      return view(row);
    });
  }

  async remove(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const a = (await q.query(`select * from bank_accounts where id = $1 and org_id = $2 and status <> 'removed' for update`, [id, req.org!.id])).rows[0];
      if (!a) throw Errors.notFound("Bank account");
      await q.query(`update bank_accounts set status='removed', is_default=false, removed_by=$2, removed_at=now(), updated_at=now() where id=$1`, [id, req.user!.id]);
      await closeWorkflowTasks(q, "bank_account", id, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "bank_account.removed", entityType: "bank_account", entityId: id, before: { iban: a.iban, status: a.status } });
      return { id, status: "removed" };
    });
  }

  async setDefault(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const a = (await q.query(`select * from bank_accounts where id = $1 and org_id = $2 and status = 'verified' for update`, [id, req.org!.id])).rows[0];
      if (!a) throw Errors.notFound("Verified bank account");
      await q.query(`update bank_accounts set is_default=false, updated_at=now() where org_id=$1 and is_default`, [req.org!.id]);
      await q.query(`update bank_accounts set is_default=true, updated_at=now() where id=$1`, [id]);
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "bank_account.default_set", entityType: "bank_account", entityId: id });
      return { id, is_default: true };
    });
  }

  // ------------------------------------------------------------------ compliance side

  async pending() {
    const r = await this.db.query(
      `select a.*, o.legal_name, o.national_id from bank_accounts a join orgs o on o.id = a.org_id where a.status = 'pending_review' order by a.created_at`,
    );
    return r.rows.map((a: any) => ({ ...view(a), org_id: a.org_id, legal_name: a.legal_name, national_id: a.national_id }));
  }

  async review(req: AppRequest, id: string, input: { approved: boolean; reason: string }) {
    return this.db.tx(async (q) => {
      const a = (await q.query(`select * from bank_accounts where id = $1 for update`, [id])).rows[0];
      if (!a) throw Errors.notFound("Bank account");
      if (a.status !== "pending_review") throw new ApiError(409, "NOT_PENDING", "Account is not awaiting review", "این حساب در انتظار بررسی نیست.");
      if ((await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status <> 'removed'`, [a.org_id, req.user!.id])).rows[0]) throw err.conflict();
      const hasDefault = (await q.query(`select 1 from bank_accounts where org_id = $1 and is_default and status = 'verified'`, [a.org_id])).rows[0];
      const row = (
        await q.query(
          input.approved
            ? `update bank_accounts set status='verified', verified_at=now(), verified_by=$2, review_reason=$3,
                 withdraw_enabled_at = now() + ($4 || ' hours')::interval, is_default=$5, updated_at=now() where id=$1 returning *`
            : `update bank_accounts set status='rejected', verified_by=$2, review_reason=$3, updated_at=now() where id=$1 returning *`,
          input.approved ? [id, req.user!.id, input.reason, String(this.cfg.bank.coolingOffHours), !hasDefault] : [id, req.user!.id, input.reason],
        )
      ).rows[0];
      await closeWorkflowTasks(q, "bank_account", id, req.user!.id);
      if (input.approved) await this.cases.refreshPrefill(q, a.org_id, req.user!.id); // §2a
      await this.notifications.notify(q, {
        to: { orgId: a.org_id, orgRoles: ["org_admin"] }, event: input.approved ? "bank_account.verified" : "bank_account.rejected",
        params: { iban_tail: `…${a.iban.slice(-4)}`, reason: input.reason }, dedupeKey: `bank_account.review:${id}`,
      });
      await this.audit.append(q, { ...actor(req), orgId: a.org_id, action: input.approved ? "bank_account.verified_manual" : "bank_account.rejected", entityType: "bank_account", entityId: id, after: { reason: input.reason } });
      return view(row);
    });
  }
}
