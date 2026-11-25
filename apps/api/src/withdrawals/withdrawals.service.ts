/**
 * Withdrawals (PRD FR-WDR-1..3, plan/04 §2.5): from the org's platform balance to one of its verified bank accounts,
 * paid directly from the fund's collection account through Jibit Cobank settlement.
 *
 *   requested        preparer asks; the amount moves  org_available → org_withdrawal_hold  (can't be spent twice)
 *   org_approved     an approver confirms with step-up (the same person only in single-user mode)
 *   finance_queued   a finance officer checks it
 *   internal_approved  the fund manager also approves, at or above the threshold
 *   sent             finance sends it to Jibit (after checking the daily/monthly transfer limits)
 *   completed        Jibit reports TRANSFERRED → hold → collection_bank (the money has left)
 *   failed           Jibit failure, or rejected by finance → hold back to available
 *   cancelled        withdrawn by the org before finance picked it up → hold back to available
 *   reverted         the bank returned a completed transfer → collection_bank → available, compliance task
 *
 * Every status change goes through WITHDRAWAL in @tp/domain. The withdrawal id is Jibit's recordTrackId, so a lost
 * response is resolved by asking Jibit, never by sending twice.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { WITHDRAWAL, WithdrawalStatus, canTransition } from "@tp/domain";
import { DB, type Db, type Queryable } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { AuditService } from "../audit/audit.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { COBANK, type CobankProvider, SettlementStatus, TransferType } from "../integrations/cobank.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { withLease } from "../common/lease.js";
import { kybRequired } from "../deposits/deposits.service.js";

const err = {
  disabled: () => new ApiError(403, "FEATURE_DISABLED", "Withdrawals are not enabled yet", "امکان برداشت هنوز فعال نشده است."),
  account: () => new ApiError(422, "ACCOUNT_NOT_ELIGIBLE", "Choose a verified bank account of this organisation", "یکی از حساب‌های تأییدشده‌ی همین شرکت را انتخاب کنید."),
  cooling: (at: string) =>
    new ApiError(422, "ACCOUNT_COOLING_OFF", "This account can receive withdrawals only after the cooling-off period", "برداشت به این حساب پس از پایان دوره‌ی انتظار ممکن است.", { withdraw_enabled_at: at }),
  balance: () => new ApiError(409, "INSUFFICIENT_BALANCE", "Not enough available balance", "موجودی قابل برداشت کافی نیست."),
  transition: (from: string, to: string) => new ApiError(409, "ILLEGAL_TRANSITION", `Cannot go from ${from} to ${to}`, "این تغییر وضعیت برای برداشت مجاز نیست.", { from, to }),
  makerChecker: () => new ApiError(403, "MAKER_CHECKER", "The approver must be someone other than the requester (unless single-user mode)", "تأییدکننده باید فردی غیر از درخواست‌دهنده باشد (مگر در حالت تک‌کاربره)."),
  sameStaff: () => new ApiError(403, "MAKER_CHECKER", "The fund manager approval must come from someone other than the finance officer", "تأیید مدیر صندوق باید توسط فردی غیر از کارشناس مالی باشد."),
  fundApproval: () => new ApiError(409, "FUND_APPROVAL_REQUIRED", "The fund manager must approve this amount first", "این مبلغ ابتدا باید به تأیید مدیر صندوق برسد."),
  limit: (daily: bigint, monthly: bigint) =>
    new ApiError(409, "TRANSFER_LIMIT", "Over the collection account's remaining transfer limit; send later or raise the limit", "مبلغ از سقف باقی‌مانده‌ی انتقال حساب جمع‌آوری بیشتر است؛ بعداً ارسال کنید یا سقف را افزایش دهید.", {
      daily_remaining: daily.toString(), monthly_remaining: monthly.toString(),
    }),
  conflict: () => new ApiError(403, "CONFLICT_OF_INTEREST", "Staff cannot handle their own organisation's withdrawal", "رسیدگی به برداشت سازمانی که عضو آن هستید مجاز نیست."),
  reason: () => new ApiError(422, "REASON_REQUIRED", "A reason is required", "ذکر دلیل الزامی است."),
};

const view = (w: any) => ({
  id: w.id, org_id: w.org_id, bank_account_id: w.bank_account_id, destination_iban: w.destination_iban, amount: String(w.amount), status: w.status,
  requested_by: w.requested_by, org_approved_by: w.org_approved_by, single_user: w.single_user, needs_fund_approval: w.needs_fund_approval,
  transfer_type: w.transfer_type, jibit_state: w.jibit_state, fail_reason: w.fail_reason, estimated_settle_at: w.estimated_settle_at,
  bank_reference: w.bank_reference, closed_reason: w.closed_reason, created_at: w.created_at, sent_at: w.sent_at, completed_at: w.completed_at,
});

/** Bank code inside an Iranian IBAN: IR + 2 check digits + 3-digit bank code. */
const bankCode = (iban: string) => iban.slice(4, 7);

@Injectable()
export class WithdrawalsService {
  private readonly log = new Logger("withdrawals");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(COBANK) private readonly cobank: CobankProvider,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private async move(q: Queryable, w: any, to: WithdrawalStatus, extraSql = "", extra: unknown[] = []) {
    if (!canTransition(WITHDRAWAL, w.status as WithdrawalStatus, to)) throw err.transition(w.status, to);
    await q.query(`update withdrawals set status = $2, updated_at = now() ${extraSql} where id = $1`, [w.id, to, ...extra]);
    w.status = to;
  }

  private async fresh(q: Queryable, id: string) {
    return view((await q.query(`select * from withdrawals where id = $1`, [id])).rows[0]);
  }

  private async load(q: Queryable, id: string, orgId?: string) {
    const w = (await q.query(`select * from withdrawals where id = $1 ${orgId ? "and org_id = $2" : ""} for update`, orgId ? [id, orgId] : [id])).rows[0];
    if (!w) throw Errors.notFound("Withdrawal");
    return w;
  }

  /** Moves the held amount back to available (cancel, reject, failure). */
  private async releaseHold(q: Queryable, w: any, entryType: string, by: string | null, reason: string) {
    const hold = await this.ledger.account(q, "org_withdrawal_hold", w.org_id);
    const avail = await this.ledger.account(q, "org_available", w.org_id);
    const amount = BigInt(w.amount);
    const { entryId } = await this.ledger.post(q, {
      entryType, refType: "withdrawal", refId: w.id, postedBy: by, idempotencyKey: `withdrawal-release:${w.id}`, description: reason,
      lines: [{ account: hold, amount }, { account: avail, amount: -amount }],
    });
    await q.query(`update withdrawals set final_entry_id = $2, closed_reason = $3 where id = $1`, [w.id, entryId, reason]);
  }

  private async notMember(q: Queryable, orgId: string, userId: string) {
    if ((await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status <> 'removed'`, [orgId, userId])).rows[0]) throw err.conflict();
  }

  // ------------------------------------------------------------------ org side

  async request(req: AppRequest, input: { bank_account_id: string; amount: string }) {
    if (!this.cfg.withdrawals.enabled) throw err.disabled();
    const orgId = req.org!.id;
    const amount = BigInt(input.amount);
    if (!(await this.db.query(`select 1 from orgs where id = $1 and status = 'active' and kyb_expires_at > now()`, [orgId])).rows[0]) throw kybRequired();
    const acct = (await this.db.query(`select * from bank_accounts where id = $1 and org_id = $2 and status = 'verified'`, [input.bank_account_id, orgId])).rows[0];
    if (!acct) throw err.account();
    if (!acct.withdraw_enabled_at || new Date(acct.withdraw_enabled_at) > new Date()) throw err.cooling(acct.withdraw_enabled_at);

    return this.db.tx(async (q) => {
      const avail = await this.ledger.account(q, "org_available", orgId);
      if ((await this.ledger.balance(q, avail)) < amount) throw err.balance();
      const hold = await this.ledger.account(q, "org_withdrawal_hold", orgId);
      const id = uuidv7();
      await q.query(
        `insert into withdrawals (id, org_id, bank_account_id, destination_iban, amount, requested_by) values ($1,$2,$3,$4,$5,$6)`,
        [id, orgId, acct.id, acct.iban, amount.toString(), req.user!.id],
      );
      const { entryId } = await this.ledger.post(q, {
        entryType: "withdrawal_hold", refType: "withdrawal", refId: id, postedBy: req.user!.id, idempotencyKey: `withdrawal-hold:${id}`,
        description: `برداشت به حساب …${acct.iban.slice(-4)}`,
        lines: [{ account: avail, amount }, { account: hold, amount: -amount }],
      });
      await q.query(`update withdrawals set hold_entry_id = $2 where id = $1`, [id, entryId]);
      await this.notifications.notify(q, { to: { orgId, orgRoles: ["approver", "org_admin"] }, event: "withdrawal.approval_needed", params: { amount: amount.toString(), id } });
      await this.audit.append(q, { ...actor(req), orgId, action: "withdrawal.requested", entityType: "withdrawal", entityId: id, after: { amount: amount.toString(), iban: acct.iban } });
      return view((await q.query(`select * from withdrawals where id = $1`, [id])).rows[0]);
    });
  }

  async approve(req: AppRequest, id: string) {
    const orgId = req.org!.id;
    return this.db.tx(async (q) => {
      const w = await this.load(q, id, orgId);
      const self = w.requested_by === req.user!.id;
      if (self && !req.org!.singleUserMode) throw err.makerChecker();
      await this.move(q, w, "org_approved", ", org_approved_by = $3, org_approved_at = now(), single_user = $4", [req.user!.id, self]);
      const name = (await q.query(`select legal_name from orgs where id = $1`, [orgId])).rows[0].legal_name;
      await staffTask(q, {
        title: `بررسی برداشت ${name}`, description: `${BigInt(w.amount).toLocaleString("fa-IR")} ریال`, linkedType: "withdrawal", linkedId: id,
        role: "finance_officer", key: "withdrawal.finance", dueInHours: 24,
      });
      await this.audit.append(q, { ...actor(req), orgId, action: "withdrawal.org_approved", entityType: "withdrawal", entityId: id });
      return this.fresh(q, w.id);
    });
  }

  async cancel(req: AppRequest, id: string, reason: string) {
    const orgId = req.org!.id;
    return this.db.tx(async (q) => {
      const w = await this.load(q, id, orgId);
      await this.move(q, w, "cancelled");
      await this.releaseHold(q, w, "withdrawal_cancelled", req.user!.id, reason);
      await closeWorkflowTasks(q, "withdrawal", id, req.user!.id);
      await this.notifications.notify(q, { to: { orgId, orgRoles: ["approver", "org_admin"] }, event: "withdrawal.cancelled", params: { amount: String(w.amount), id } });
      await this.audit.append(q, { ...actor(req), orgId, action: "withdrawal.cancelled", entityType: "withdrawal", entityId: id, after: { reason } });
      return this.fresh(q, w.id);
    });
  }

  async list(req: AppRequest) {
    return (await this.db.query(`select * from withdrawals where org_id = $1 order by created_at desc limit 100`, [req.org!.id])).rows.map(view);
  }

  async get(req: AppRequest, id: string) {
    const w = (await this.db.query(`select * from withdrawals where id = $1 and org_id = $2`, [id, req.org!.id])).rows[0];
    if (!w) throw Errors.notFound("Withdrawal");
    return view(w);
  }

  // ------------------------------------------------------------------ fund side

  async adminList(status?: string) {
    const r = await this.db.query(
      `select w.*, o.legal_name from withdrawals w join orgs o on o.id = w.org_id where ($1::text is null or w.status = $1) order by w.created_at limit 200`,
      [status ?? null],
    );
    return r.rows.map((w: any) => ({ ...view(w), legal_name: w.legal_name }));
  }

  async queue(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const w = await this.load(q, id);
      await this.notMember(q, w.org_id, req.user!.id);
      const needs = BigInt(w.amount) >= this.cfg.withdrawals.fundApprovalThreshold;
      await this.move(q, w, "finance_queued", ", finance_by = $3, finance_queued_at = now(), needs_fund_approval = $4", [req.user!.id, needs]);
      await closeWorkflowTasks(q, "withdrawal", id, req.user!.id);
      if (needs)
        await staffTask(q, { title: "تأیید برداشت بالای سقف", description: `${BigInt(w.amount).toLocaleString("fa-IR")} ریال`, linkedType: "withdrawal", linkedId: id, role: "fund_manager", key: "withdrawal.fund_approval", dueInHours: 24, priority: "p0" });
      await this.audit.append(q, { ...actor(req), orgId: w.org_id, action: "withdrawal.finance_queued", entityType: "withdrawal", entityId: id, after: { needs_fund_approval: needs } });
      return this.fresh(q, w.id);
    });
  }

  async fundApprove(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const w = await this.load(q, id);
      await this.notMember(q, w.org_id, req.user!.id);
      if (w.finance_by === req.user!.id) throw err.sameStaff();
      await this.move(q, w, "internal_approved", ", fund_approved_by = $3, fund_approved_at = now()", [req.user!.id]);
      await closeWorkflowTasks(q, "withdrawal", id, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: w.org_id, action: "withdrawal.fund_approved", entityType: "withdrawal", entityId: id });
      return this.fresh(q, w.id);
    });
  }

  async reject(req: AppRequest, id: string, reason: string) {
    if (!reason?.trim()) throw err.reason();
    return this.db.tx(async (q) => {
      const w = await this.load(q, id);
      await this.notMember(q, w.org_id, req.user!.id);
      // Before finance has queued it the request is closed as cancelled; afterwards (or after fund approval) as failed.
      await this.move(q, w, w.status === "org_approved" || w.status === "requested" ? "cancelled" : "failed");
      await this.releaseHold(q, w, "withdrawal_rejected", req.user!.id, reason);
      await closeWorkflowTasks(q, "withdrawal", id, req.user!.id);
      await this.notifications.notify(q, { to: { orgId: w.org_id }, event: "withdrawal.failed", params: { amount: String(w.amount), id, reason } });
      await this.audit.append(q, { ...actor(req), orgId: w.org_id, action: "withdrawal.rejected", entityType: "withdrawal", entityId: id, after: { reason } });
      return this.fresh(q, w.id);
    });
  }

  /** Sends the transfer to Jibit. Safe to retry: a lost response is resolved by looking the track id up at Jibit. */
  async send(req: AppRequest, id: string) {
    if (!this.cfg.withdrawals.enabled) throw err.disabled();
    const w = (await this.db.query(`select * from withdrawals where id = $1`, [id])).rows[0];
    if (!w) throw Errors.notFound("Withdrawal");
    if ((await this.db.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status <> 'removed'`, [w.org_id, req.user!.id])).rows[0]) throw err.conflict();
    if (w.status === "finance_queued" && w.needs_fund_approval) throw err.fundApproval();
    if (!canTransition(WITHDRAWAL, w.status, "sent")) throw err.transition(w.status, "sent");

    const amount = BigInt(w.amount);
    const collection = this.cfg.collection.iban;
    let st: SettlementStatus | null = await this.cobank.settlementStatus(w.id); // already sent by an earlier attempt?
    let transferType: TransferType = "NORMAL";
    if (!st) {
      const lim = await this.cobank.transferLimits(collection);
      if (amount > lim.dailyRemaining || amount > lim.monthlyRemaining) throw err.limit(lim.dailyRemaining, lim.monthlyRemaining);
      transferType = bankCode(w.destination_iban) === bankCode(collection) ? "NORMAL" : amount >= this.cfg.withdrawals.satnaThreshold ? "RTGS" : "ACH";
      try {
        st = await this.cobank.createSettlement({
          trackId: w.id, transferType, transferReason: this.cfg.withdrawals.transferReason, sourceIban: collection,
          destinationIban: w.destination_iban, amount, description: `WDR-${w.id.slice(-12)}`,
        });
      } catch (e: any) {
        st = await this.cobank.settlementStatus(w.id).catch(() => null); // did it reach Jibit before the error?
        if (!st) throw e;
        this.log.warn(`settlement ${w.id}: response lost, found at Jibit in state ${st.state}`);
      }
    }
    return this.db.tx(async (q) => {
      const cur = await this.load(q, id);
      if (cur.status === "sent") return this.fresh(q, cur.id);
      await this.move(q, cur, "sent", ", sent_by = $3, sent_at = now(), transfer_type = coalesce(transfer_type, $4), transfer_reason = $5, jibit_state = $6", [
        req.user!.id, transferType, this.cfg.withdrawals.transferReason, st!.state,
      ]);
      await this.audit.append(q, { ...actor(req), orgId: cur.org_id, action: "withdrawal.sent", entityType: "withdrawal", entityId: id, after: { transfer_type: transferType, jibit_state: st!.state } });
      await this.applyState(q, cur, st!);
      return this.fresh(q, cur.id);
    });
  }

  // ------------------------------------------------------------------ settlement tracking (worker, every 2 min)

  async poll() {
    const res = await withLease(this.db, "cobank.settlements.poll", 300, async () => {
      const out = { checked: 0, completed: 0, failed: 0, reverted: 0, waiting: 0 };
      // completed ones are watched for 7 days in case the bank reverts them
      const rows = (
        await this.db.query(`select * from withdrawals where status = 'sent' or (status = 'completed' and completed_at > now() - interval '7 days') order by sent_at limit 200`)
      ).rows;
      for (const w of rows) {
        out.checked++;
        let st: SettlementStatus | null;
        try {
          st = await this.cobank.settlementStatus(w.id);
        } catch (e: any) {
          this.log.warn(`settlement ${w.id} status failed: ${e?.message ?? e}`);
          continue;
        }
        if (!st) continue;
        const r = await this.db.tx(async (q) => this.applyState(q, await this.load(q, w.id), st!));
        if (r.status === "completed" && w.status !== "completed") out.completed++;
        else if (r.status === "failed") out.failed++;
        else if (r.status === "reverted") out.reverted++;
        else if (/WAITING/.test(st.state)) out.waiting++;
      }
      return out;
    });
    return res ?? { skipped: "another worker holds the lease" };
  }

  /** Maps a Jibit settlement state onto the withdrawal (plan/04 §2.5 table). Returns the new fields. */
  private async applyState(q: Queryable, w: any, st: SettlementStatus): Promise<{ status: string; jibit_state: string }> {
    await q.query(
      `update withdrawals set jibit_state = $2, fail_reason = $3, bank_reference = coalesce($4, bank_reference), estimated_settle_at = coalesce($5, estimated_settle_at), updated_at = now() where id = $1`,
      [w.id, st.state, st.failReason, st.bankReferenceNumber, st.estimatedSettleAt],
    );
    const amount = BigInt(w.amount);
    const iban_tail = `…${w.destination_iban.slice(-4)}`;

    if (st.state === "TRANSFERRED" && w.status === "sent") {
      const hold = await this.ledger.account(q, "org_withdrawal_hold", w.org_id);
      const bank = await this.ledger.account(q, "collection_bank");
      const { entryId } = await this.ledger.post(q, {
        entryType: "withdrawal_completed", refType: "withdrawal", refId: w.id, idempotencyKey: `withdrawal-done:${w.id}`,
        description: `واریز به حساب ${iban_tail}${st.bankReferenceNumber ? ` (مرجع ${st.bankReferenceNumber})` : ""}`,
        lines: [{ account: hold, amount }, { account: bank, amount: -amount }],
      });
      await this.move(q, w, "completed", ", completed_at = now(), final_entry_id = $3", [entryId]);
      await this.notifications.notify(q, { to: { orgId: w.org_id }, event: "withdrawal.completed", params: { amount: amount.toString(), id: w.id, iban_tail }, dedupeKey: `withdrawal.completed:${w.id}` });
      await this.audit.append(q, { actorType: "system", orgId: w.org_id, action: "withdrawal.completed", entityType: "withdrawal", entityId: w.id, after: { bank_reference: st.bankReferenceNumber } });
    } else if (["FAILED", "FAILED_WRONG", "CANCELLED"].includes(st.state) && w.status === "sent") {
      await this.move(q, w, "failed");
      await this.releaseHold(q, w, "withdrawal_failed", null, `Jibit ${st.state}${st.failReason ? ` (${st.failReason})` : ""}`);
      await staffTask(q, { title: "برداشت ناموفق", description: `${st.state} ${st.failReason ?? ""}`, linkedType: "withdrawal", linkedId: w.id, role: "finance_officer", key: "withdrawal.failed", priority: "p0" });
      await this.notifications.notify(q, { to: { orgId: w.org_id }, event: "withdrawal.failed", params: { amount: amount.toString(), id: w.id }, dedupeKey: `withdrawal.failed:${w.id}` });
      await this.audit.append(q, { actorType: "system", orgId: w.org_id, action: "withdrawal.failed", entityType: "withdrawal", entityId: w.id, after: { state: st.state, fail_reason: st.failReason } });
    } else if (st.state === "TRANSFERRED_REVERTED" && w.status === "completed") {
      // The money came back into the collection account: the org gets it back, compliance looks at why.
      const bank = await this.ledger.account(q, "collection_bank");
      const avail = await this.ledger.account(q, "org_available", w.org_id);
      await this.ledger.post(q, {
        entryType: "withdrawal_reverted", refType: "withdrawal", refId: w.id, idempotencyKey: `withdrawal-reverted:${w.id}`,
        description: "برگشت واریز از سوی بانک", lines: [{ account: bank, amount }, { account: avail, amount: -amount }],
      });
      await this.move(q, w, "reverted", ", closed_reason = $3", ["bank reverted the transfer"]);
      await staffTask(q, { title: "برداشت برگشت خورد", description: `حساب ${iban_tail}`, linkedType: "withdrawal", linkedId: w.id, role: "compliance_officer", key: "withdrawal.reverted", priority: "p0" });
      await this.notifications.notify(q, { to: { orgId: w.org_id }, event: "withdrawal.reverted", params: { amount: amount.toString(), id: w.id }, dedupeKey: `withdrawal.reverted:${w.id}` });
      await this.audit.append(q, { actorType: "system", orgId: w.org_id, action: "withdrawal.reverted", entityType: "withdrawal", entityId: w.id });
    } else if (/^WAITING_FOR_(FEE|BALANCE)$/.test(st.state)) {
      // Treasury problem at Jibit (fee balance or account balance): tell finance once.
      const open = (await q.query(`select 1 from tasks where linked_type='withdrawal' and linked_id=$1 and workflow_key='withdrawal.blocked' and status in ('open','in_progress')`, [w.id])).rows[0];
      if (!open)
        await staffTask(q, { title: "برداشت در جیبیت متوقف شده", description: st.state === "WAITING_FOR_FEE" ? "موجودی کارمزد جیبیت کافی نیست." : "موجودی حساب جمع‌آوری کافی نیست.", linkedType: "withdrawal", linkedId: w.id, role: "finance_officer", key: "withdrawal.blocked", priority: "p0" });
    }
    return { status: w.status, jibit_state: st.state };
  }
}
