/**
 * Deposits into the fund's collection account through Jibit Cobank (plan/04 §2.3).
 *
 * Each org transfers from its own verified bank account using its payment ID (شناسه پرداخت). The poll job reads
 * Jibit's "waiting for verify" list and decides each record:
 *
 *   accept  — known payment ID, org KYB valid and active, source IBAN is one of the org's verified accounts,
 *             and Jibit's KYT says the source account belongs to the payer → verify → credit org_available.
 *   hold    — known payment ID but any other check fails → "to be decided" at Jibit → suspense + compliance task.
 *   refund  — unknown payment ID → full refund to the sender. Nothing is credited.
 *
 * The decision is stored first, then Jibit is called, then the ledger is posted. If Jibit or the DB fails midway,
 * the next poll finishes the same decision; ledger posting is idempotent per Jibit reference number.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DB, type Db } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { AuditService } from "../audit/audit.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { COBANK, type CobankProvider, DepositRecord } from "../integrations/cobank.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { withLease } from "../common/lease.js";
import { NotificationsService } from "../notifications/notifications.service.js";

const PAGE = 50;
const MAX_PAGES = 20;

export const kybRequired = () =>
  new ApiError(403, "KYB_REQUIRED", "Company verification (KYB) must be approved first", "ابتدا احراز هویت شرکت باید تأیید شود.");

const maskIban = (iban: string | null) => (iban ? `${iban.slice(0, 4)}…${iban.slice(-4)}` : null);

@Injectable()
export class DepositsService {
  private readonly log = new Logger("deposits");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(COBANK) private readonly cobank: CobankProvider,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The org's payment ID on the collection IBAN; created once. */
  async ensurePayId(orgId: string): Promise<string> {
    const cur = (await this.db.query(`select deposit_id from orgs where id = $1`, [orgId])).rows[0];
    if (cur?.deposit_id) return cur.deposit_id;
    const payId = await this.cobank.createPayId(this.cfg.collection.iban);
    const set = await this.db.query(`update orgs set deposit_id = $2 where id = $1 and deposit_id is null returning deposit_id`, [orgId, payId]);
    if (set.rows[0]) {
      await this.audit.append(this.db, { actorType: "system", orgId, action: "org.payment_id_assigned", entityType: "org", entityId: orgId, after: { deposit_id: payId } });
      return payId;
    }
    return (await this.db.query(`select deposit_id from orgs where id = $1`, [orgId])).rows[0].deposit_id; // lost a race
  }

  private async kybValid(orgId: string) {
    const r = await this.db.query(`select 1 from orgs where id = $1 and status = 'active' and kyb_expires_at > now()`, [orgId]);
    return !!r.rows[0];
  }

  async instructions(req: AppRequest) {
    if (!(await this.kybValid(req.org!.id))) throw kybRequired();
    const payId = await this.ensurePayId(req.org!.id);
    const accounts = (await this.db.query(`select iban, bank_name from bank_accounts where org_id = $1 and status = 'verified' order by created_at`, [req.org!.id])).rows;
    return {
      payment_id: payId,
      collection_iban: this.cfg.collection.iban,
      bank_name: this.cfg.collection.bankName,
      account_holder: this.cfg.collection.holderName,
      allowed_source_accounts: accounts.map((a: any) => ({ iban: a.iban, bank_name: a.bank_name })),
      notes_fa: [
        "واریز فقط از حساب‌های تأییدشده‌ی همین شرکت پذیرفته می‌شود.",
        "شناسه پرداخت را حتماً هنگام انتقال وارد کنید؛ واریز بدون شناسه یا با شناسه‌ی نادرست برگشت داده می‌شود.",
        "واریز از حساب دیگر تا بررسی واحد تطبیق در انتظار می‌ماند.",
      ],
    };
  }

  async listForOrg(req: AppRequest) {
    const r = await this.db.query(
      `select id, amount, status, source_iban, bank_reference_number, bank_timestamp, created_at from bank_statement_lines
       where org_id = $1 order by created_at desc limit 100`,
      [req.org!.id],
    );
    return r.rows.map((x: any) => ({
      id: x.id, amount: String(x.amount), status: x.status, source_iban: maskIban(x.source_iban),
      bank_reference: x.bank_reference_number, received_at: x.bank_timestamp ?? x.created_at,
    }));
  }

  // ------------------------------------------------------------------ poll job

  async poll() {
    const res = await withLease(this.db, "cobank.deposits.poll", 300, async () => {
      const out = { seen: 0, credited: 0, held: 0, refunded: 0, pending_retry: 0 };
      const iban = this.cfg.collection.iban;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { items, hasNext } = await this.cobank.waitingForVerify(iban, page, PAGE);
        for (const rec of items) {
          out.seen++;
          await this.record(rec);
        }
        if (!hasNext) break;
      }
      // Finish every decided-but-unfinished line (new ones and leftovers from earlier failures).
      const open = (await this.db.query(`select * from bank_statement_lines where status = 'received' and decision is not null order by created_at`)).rows;
      for (const line of open) {
        const r = await this.finish(line);
        if (r === "credited") out.credited++;
        else if (r === "suspense") out.held++;
        else if (r === "refunded") out.refunded++;
        else out.pending_retry++;
      }
      return out;
    });
    return res ?? { skipped: "another worker holds the lease" };
  }

  /** Stores the record (once) and our decision. */
  private async record(rec: DepositRecord) {
    if (rec.amount <= 0n) return; // only credits are deposits
    const ins = await this.db.query(
      `insert into bank_statement_lines (id, jibit_reference_number, account_iban, amount, source_iban, source_name, pay_id, kyt_status,
         merchant_status, bank_reference_number, record_type, bank_timestamp, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (jibit_reference_number) do nothing returning *`,
      [uuidv7(), rec.referenceNumber, rec.accountIban, rec.amount.toString(), rec.sourceIban, rec.sourceName, rec.payId, rec.kytStatus,
        rec.merchantVerificationStatus, rec.bankReferenceNumber, rec.recordType, rec.timestamp, JSON.stringify(rec.raw ?? {})],
    );
    const line = ins.rows[0] ?? (await this.db.query(`select * from bank_statement_lines where jibit_reference_number = $1`, [rec.referenceNumber])).rows[0];
    if (line.decision) return;

    let decision: "accept" | "hold" | "refund";
    let reason: string;
    const org = rec.payId ? (await this.db.query(`select id, status, kyb_expires_at from orgs where deposit_id = $1`, [rec.payId])).rows[0] : null;
    if (!org) {
      decision = "refund";
      reason = rec.payId ? "unknown_payment_id" : "no_payment_id";
    } else if (!(org.status === "active" && org.kyb_expires_at && new Date(org.kyb_expires_at) > new Date())) {
      decision = "hold";
      reason = "kyb_not_valid_or_org_inactive";
    } else {
      const acct = rec.sourceIban
        ? (await this.db.query(`select 1 from bank_accounts where org_id = $1 and iban = $2 and status = 'verified'`, [org.id, rec.sourceIban])).rows[0]
        : null;
      if (!acct) {
        decision = "hold";
        reason = "source_account_not_verified";
      } else if (rec.kytStatus !== "MATCH_IBAN_AND_NATIONAL_ID") {
        decision = "hold";
        reason = `kyt_${String(rec.kytStatus).toLowerCase()}`;
      } else {
        decision = "accept";
        reason = "all_checks_passed";
      }
    }
    await this.db.query(`update bank_statement_lines set decision=$2, decision_reason=$3, org_id=$4, updated_at=now() where id=$1 and decision is null`, [
      line.id, decision, reason, org?.id ?? null,
    ]);
  }

  /** Executes the stored decision at Jibit, then books it. Returns the new status, or null to retry later. */
  private async finish(line: any): Promise<string | null> {
    const iban = this.cfg.collection.iban;
    try {
      if (!line.jibit_action_done) {
        if (line.decision === "accept") await this.cobank.verify(iban, line.jibit_reference_number);
        else if (line.decision === "hold") await this.cobank.toBeDecided(iban, line.jibit_reference_number);
        else await this.cobank.fullRefund(iban, line.jibit_reference_number);
        await this.db.query(`update bank_statement_lines set jibit_action_done = true, updated_at = now() where id = $1`, [line.id]);
      }
    } catch (e: any) {
      this.log.warn(`Cobank ${line.decision} ${line.jibit_reference_number} failed, will retry: ${e?.message ?? e}`);
      return null;
    }
    const amount = BigInt(line.amount);
    return this.db.tx(async (q) => {
      const fresh = (await q.query(`select status from bank_statement_lines where id = $1 for update`, [line.id])).rows[0];
      if (fresh.status !== "received") return fresh.status;
      const bank = await this.ledger.account(q, "collection_bank");
      if (line.decision === "accept") {
        const avail = await this.ledger.account(q, "org_available", line.org_id);
        const { entryId } = await this.ledger.post(q, {
          entryType: "deposit", refType: "bank_statement_line", refId: line.id, idempotencyKey: `deposit:${line.jibit_reference_number}`,
          description: `واریز شناسه‌دار ${line.bank_reference_number ?? ""}`.trim(),
          lines: [{ account: bank, amount }, { account: avail, amount: -amount }],
        });
        await q.query(`update bank_statement_lines set status='credited', journal_entry_id=$2, updated_at=now() where id=$1`, [line.id, entryId]);
        await this.notifications.notify(q, { to: { orgId: line.org_id }, event: "deposit.credited", params: { amount: String(amount) }, dedupeKey: `deposit:${line.id}` });
        await this.audit.append(q, { actorType: "system", orgId: line.org_id, action: "deposit.credited", entityType: "bank_statement_line", entityId: line.id, after: { amount: String(amount) } });
        return "credited";
      }
      if (line.decision === "hold") {
        const susp = await this.ledger.account(q, "suspense");
        const { entryId } = await this.ledger.post(q, {
          entryType: "deposit_suspense", refType: "bank_statement_line", refId: line.id, idempotencyKey: `deposit:${line.jibit_reference_number}`,
          description: `واریز در انتظار بررسی (${line.decision_reason})`,
          lines: [{ account: bank, amount }, { account: susp, amount: -amount }],
        });
        await q.query(`update bank_statement_lines set status='suspense', journal_entry_id=$2, updated_at=now() where id=$1`, [line.id, entryId]);
        await staffTask(q, {
          title: "واریز نیازمند بررسی", description: `${line.decision_reason} · مبلغ ${amount} ریال · مرجع ${line.jibit_reference_number}`,
          linkedType: "bank_statement_line", linkedId: line.id, role: "compliance_officer", key: "deposit.review", dueInHours: 24, priority: "p0",
        });
        if (line.org_id)
          await this.notifications.notify(q, { to: { orgId: line.org_id, orgRoles: ["org_admin"] }, event: "deposit.held", params: { amount: String(amount) }, dedupeKey: `deposit:${line.id}` });
        await this.audit.append(q, { actorType: "system", orgId: line.org_id, action: "deposit.held", entityType: "bank_statement_line", entityId: line.id, after: { amount: String(amount), reason: line.decision_reason } });
        return "suspense";
      }
      await q.query(`update bank_statement_lines set status='refunded', updated_at=now() where id=$1`, [line.id]);
      await this.audit.append(q, { actorType: "system", orgId: line.org_id, action: "deposit.refunded", entityType: "bank_statement_line", entityId: line.id, after: { amount: String(amount), reason: line.decision_reason } });
      return "refunded";
    });
  }

  // ------------------------------------------------------------------ compliance side

  async lines(status?: string) {
    const r = await this.db.query(
      `select l.id, l.jibit_reference_number, l.amount, l.source_iban, l.source_name, l.pay_id, l.kyt_status, l.decision, l.decision_reason,
              l.status, l.org_id, o.legal_name, l.bank_timestamp, l.created_at, l.resolved_at
       from bank_statement_lines l left join orgs o on o.id = l.org_id
       where ($1::text is null or l.status = $1) order by l.created_at desc limit 200`,
      [status ?? null],
    );
    return r.rows.map((x: any) => ({ ...x, amount: String(x.amount) }));
  }

  /** Clears a held deposit: credit it to an org, or send it back. */
  async resolve(req: AppRequest, id: string, input: { action: "credit" | "refund"; org_id?: string; reason: string }) {
    const line = (await this.db.query(`select * from bank_statement_lines where id = $1`, [id])).rows[0];
    if (!line) throw Errors.notFound("Deposit");
    if (line.status !== "suspense") throw new ApiError(409, "NOT_IN_SUSPENSE", "Only held deposits can be resolved", "فقط واریزهای در انتظار بررسی قابل تعیین تکلیف‌اند.");
    const orgId = input.org_id ?? line.org_id;
    if (input.action === "credit") {
      if (!orgId) throw new ApiError(422, "ORG_REQUIRED", "Choose the organisation to credit", "سازمان مقصد را مشخص کنید.");
      if (!(await this.kybValid(orgId))) throw kybRequired();
      await this.cobank.verify(this.cfg.collection.iban, line.jibit_reference_number);
    } else {
      await this.cobank.fullRefund(this.cfg.collection.iban, line.jibit_reference_number);
    }
    const amount = BigInt(line.amount);
    return this.db.tx(async (q) => {
      const fresh = (await q.query(`select status from bank_statement_lines where id = $1 for update`, [id])).rows[0];
      if (fresh.status !== "suspense") throw new ApiError(409, "NOT_IN_SUSPENSE", "Already resolved", "قبلاً تعیین تکلیف شده است.");
      const susp = await this.ledger.account(q, "suspense");
      const other = input.action === "credit" ? await this.ledger.account(q, "org_available", orgId) : await this.ledger.account(q, "collection_bank");
      const { entryId } = await this.ledger.post(q, {
        entryType: input.action === "credit" ? "suspense_credited" : "suspense_refunded",
        refType: "bank_statement_line", refId: id, postedBy: req.user!.id, idempotencyKey: `deposit-resolve:${line.jibit_reference_number}`,
        description: input.reason,
        lines: [{ account: susp, amount }, { account: other, amount: -amount }],
      });
      const status = input.action === "credit" ? "credited" : "refunded";
      await q.query(
        `update bank_statement_lines set status=$2, org_id=$3, resolved_by=$4, resolved_at=now(), decision_reason = decision_reason || ' → ' || $5,
         journal_entry_id=$6, updated_at=now() where id=$1`,
        [id, status, orgId ?? null, req.user!.id, input.reason, entryId],
      );
      await closeWorkflowTasks(q, "bank_statement_line", id, req.user!.id);
      if (orgId)
        await this.notifications.notify(q, {
          to: { orgId }, event: status === "credited" ? "deposit.credited" : "deposit.refunded", params: { amount: String(amount) }, dedupeKey: `deposit-resolved:${id}`,
        });
      await this.audit.append(q, { ...actor(req), orgId: orgId ?? null, action: `deposit.suspense_${status}`, entityType: "bank_statement_line", entityId: id, after: { amount: String(amount), reason: input.reason } });
      return { id, status };
    });
  }
}
