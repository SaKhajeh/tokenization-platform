/**
 * Credit case part 4a — plan/07 §6.5–§6.7, §6d, §7, D-C2, D-C4, D-C5, D-C13, D-C16.
 *
 *   Tariff        fund manager keeps a versioned fee tariff; the assessment fee (Tehran / outside Tehran) is invoiced
 *                 when the applicant asks to pay it and must be paid (or waived) before the case can be submitted.
 *   Visit         after documents are complete: the analyst proposes date, time and visitor; the applicant confirms or
 *                 asks for another date (a ticket); reminder the day before; visit report; originals received.
 *   Scoring       needs the visit done, the originals received and the verified figures locked. The analyst runs the
 *                 fund's method (versioned) with Rc, Ra, Re and a written reason for each, then sends it for approval.
 *   Approval      the fund manager — never the preparer — approves (step-up), sends back or declines.
 *   Credit limit  on approval: the guarantee ceiling with cheque and promissory note, valid 12 months, plus the other
 *                 ceilings for the report. The norm usage ledger draws it down (amount ÷ (Ra × Re)).
 */
import { Inject, Injectable } from "@nestjs/common";
import { ActivityType, addJalaliMonths, DEFAULT_SCORING_METHOD, invoiceTotals, jalaliYearOf, LIMIT_VALIDITY_MONTHS, ROUND, RoundState, scoreCase, ScoringMethod, ScoringInputError, toFinancialYear, toRials, transition, usageLedger, validateScoringMethod, VISIT, VisitState, checklistItem, COLLATERAL_CLASSES, isoFromUtcDate, scoringYears, SCORING_METHOD_V2_CHANGES, calculationPeriods, trialBalancePeriod } from "@tp/domain";
import { DB, type Db, type Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { tehranToday } from "../applications/applications.service.js";
import { CasesService } from "./cases.service.js";
import { assessmentFee, currentTariff } from "./fees.js";
import { TicketsService } from "../tickets/tickets.service.js";
import { withLease } from "../common/lease.js";
import { ApplicationsService } from "../applications/applications.service.js";
import { limitCheck } from "@tp/domain";

const err = {
  noFee: () => new ApiError(409, "NO_FEE_DUE", "No assessment fee is due for this case", "هزینه‌ی ارزیابی برای این پرونده تعیین نشده است."),
  state: (what: string, s: string) => new ApiError(409, "WRONG_STATE", `${what} is not possible while the case is ${s}`, "این کار در وضعیت فعلی پرونده ممکن نیست.", { state: s }),
  noVisit: () => new ApiError(404, "NO_VISIT", "No visit is scheduled", "بازدیدی برنامه‌ریزی نشده است."),
  visitor: () => new ApiError(422, "VISITOR_NOT_STAFF", "The visitor must be fund staff", "بازدیدکننده باید از کارکنان صندوق باشد."),
  date: () => new ApiError(422, "VISIT_DATE_PAST", "The visit date must be today or later", "تاریخ بازدید نمی‌تواند گذشته باشد."),
  notReady: (missing: string[]) => new ApiError(409, "SCORING_NOT_READY", "Scoring needs the visit done, originals received and figures locked", "برای اعتبارسنجی، بازدید، دریافت اصل مدارک و قفل ارقام مالی لازم است.", { missing }),
  scoring: (problems: string[]) => new ApiError(422, "SCORING_INPUT_INVALID", problems.join("; "), "اطلاعات لازم برای محاسبه‌ی حد اعتباری کامل نیست.", { problems }),
  self: () => new ApiError(403, "SELF_APPROVAL", "The fund manager cannot approve a round they prepared", "تهیه‌کننده‌ی محاسبه نمی‌تواند آن را تأیید کند."),
  method: (problems: string[]) => new ApiError(422, "INVALID_SCORING_METHOD", problems.join("; "), "روش اعتبارسنجی معتبر نیست.", { problems }),
  noLimit: () => new ApiError(404, "NO_CREDIT_LIMIT", "No active credit limit", "حد اعتباری فعالی وجود ندارد."),
  notOriginal: () => new ApiError(422, "NO_ORIGINAL_NEEDED", "This item has no original to hand over", "برای این مدرک تحویل اصل لازم نیست."),
};

const visitView = (v: any) => v && ({
  id: v.id, state: v.state, visit_date: v.visit_date instanceof Date ? isoFromUtcDate(v.visit_date) : v.visit_date, visit_time: v.visit_time,
  visitor_id: v.visitor_id, confirmed_at: v.confirmed_at, change_ticket_id: v.change_ticket_id, findings: v.findings, photo_doc_ids: v.photo_doc_ids, done_at: v.done_at,
});

@Injectable()
export class LimitsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cases: CasesService,
    private readonly tickets: TicketsService,
    private readonly apps: ApplicationsService,
  ) {}

  // ================================================================== tariff (§6d)

  async tariff() {
    const t = await currentTariff(this.db);
    const history = (await this.db.query(`select * from fee_tariffs order by version desc`)).rows;
    return { current: t ? tariffView(t) : null, history: history.map(tariffView) };
  }

  async setTariff(req: AppRequest, input: { effective_from: string; assessment_fee_tehran: string; assessment_fee_outside: string; application_fee: string; servicing_fee_bps: number; investor_fee_bps: number; platform_share_bps: number; note?: string | null }) {
    return this.db.tx(async (q) => {
      await q.query(`lock table fee_tariffs in exclusive mode`);
      const before = await currentTariff(q);
      const row = (await q.query(
        `insert into fee_tariffs (id, version, effective_from, assessment_fee_tehran, assessment_fee_outside, application_fee, servicing_fee_bps, investor_fee_bps, platform_share_bps, note, created_by)
         values ($1, coalesce((select max(version) from fee_tariffs), 0) + 1, $2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [uuidv7(), input.effective_from, input.assessment_fee_tehran, input.assessment_fee_outside, input.application_fee, input.servicing_fee_bps,
          input.investor_fee_bps, input.platform_share_bps, input.note ?? null, req.user!.id],
      )).rows[0];
      await this.audit.append(q, { ...actor(req), action: "tariff.changed", entityType: "fee_tariff", entityId: row.id, before: before ? tariffView(before) : undefined, after: tariffView(row) });
      return tariffView(row);
    });
  }

  /** The applicant asks for the assessment-fee invoice; it is paid from the org balance like any invoice (or waived). */
  async feeInvoice(req: AppRequest) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseOf(q, req.org!.id, true);
      if (!["opened", "in_preparation"].includes(c.state)) throw err.state("Paying the assessment fee", c.state);
      const fee = await assessmentFee(q, c.id);
      if (fee.invoice && fee.invoice.status !== "cancelled") return { invoice_id: fee.invoice.id, invoice_no: fee.invoice.invoice_no, status: fee.invoice.status, total: String(fee.invoice.total), region: fee.region };
      if (fee.amount === 0n) throw err.noFee();
      const vatBps = (await q.query(`select vat_bps from pricing_policies order by version desc limit 1`)).rows[0]?.vat_bps ?? 0;
      const t = invoiceTotals([{ code: `assessment_${fee.region}`, amount: fee.amount, fundShareBps: 10000 - fee.tariff.platform_share_bps }], vatBps);
      const n = Number((await q.query(`select nextval('invoice_no_seq') as n`)).rows[0].n);
      const id = uuidv7();
      const no = `INV-${jalaliYearOf(tehranToday())}-${String(n).padStart(5, "0")}`;
      await q.query(
        `insert into invoices (id, invoice_no, org_id, linked_type, linked_id, charge_point, subtotal, vat_bps, vat, total, fund_share, platform_share, policy_version, issued_by)
         values ($1,$2,$3,'case',$4,'case_submission',$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, no, c.org_id, c.id, t.subtotal.toString(), vatBps, t.vat.toString(), t.total.toString(), t.fundShare.toString(), t.platformShare.toString(), fee.tariff.version, req.user!.id],
      );
      await q.query(`update cases set fee_invoice_id = $2 where id = $1`, [c.id, id]);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.fee_invoiced", entityType: "invoice", entityId: id, after: { total: t.total.toString(), region: fee.region, tariff_version: fee.tariff.version } });
      return { invoice_id: id, invoice_no: no, status: "issued", total: t.total.toString(), region: fee.region };
    });
  }

  // ================================================================== site visit (D-C16)

  private async liveVisit(q: Queryable, caseId: string, lock = false) {
    return (await q.query(`select * from case_visits where case_id = $1 and state in ('proposed','confirmed','change_requested') ${lock ? "for update" : ""}`, [caseId])).rows[0];
  }

  private async moveVisit(q: Queryable, v: any, to: VisitState) {
    transition("visit", VISIT, v.state as VisitState, to);
    await q.query(`update case_visits set state = $2 where id = $1`, [v.id, to]);
    v.state = to;
  }

  async proposeVisit(req: AppRequest, caseId: string, input: { visit_date: string; visit_time: string; visitor_id: string }) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      if (c.state !== "documents_complete") throw err.state("Scheduling the visit", c.state);
      if (input.visit_date < tehranToday()) throw err.date();
      if (!(await q.query(`select 1 from staff_roles where user_id = $1 and revoked_at is null and role in ('analyst','technical_expert')`, [input.visitor_id])).rows[0]) throw err.visitor();
      const done = (await q.query(`select 1 from case_visits where case_id = $1 and state = 'done'`, [caseId])).rows[0];
      if (done) throw err.state("Another visit", "visit done");
      const old = await this.liveVisit(q, caseId, true);
      if (old) await this.moveVisit(q, old, "cancelled");
      const id = uuidv7();
      await q.query(
        `insert into case_visits (id, case_id, state, visit_date, visit_time, visitor_id, proposed_by) values ($1,$2,'proposed',$3,$4,$5,$6)`,
        [id, caseId, input.visit_date, input.visit_time, input.visitor_id, req.user!.id],
      );
      await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.visit_proposed", params: { no: c.case_no, date: input.visit_date, time: input.visit_time } });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.visit_proposed", entityType: "case", entityId: caseId, after: input });
      return visitView((await q.query(`select * from case_visits where id = $1`, [id])).rows[0]);
    });
  }

  async myVisit(req: AppRequest) {
    const c = await this.cases.caseOf(this.db, req.org!.id);
    const v = (await this.db.query(`select * from case_visits where case_id = $1 order by proposed_at desc limit 1`, [c.id])).rows[0];
    return visitView(v) ?? null;
  }

  /** Staff: the latest visit of a case (any state), or null. */
  async staffVisit(caseId: string) {
    const v = (await this.db.query(`select * from case_visits where case_id = $1 order by proposed_at desc limit 1`, [caseId])).rows[0];
    return visitView(v) ?? null;
  }

  async confirmVisit(req: AppRequest) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseOf(q, req.org!.id, true);
      const v = await this.liveVisit(q, c.id, true);
      if (!v) throw err.noVisit();
      await this.moveVisit(q, v, "confirmed");
      await q.query(`update case_visits set confirmed_by = $2, confirmed_at = now() where id = $1`, [v.id, req.user!.id]);
      await q.query(`update cases set last_activity_at = now() where id = $1`, [c.id]);
      await this.notifications.notify(q, { to: { userIds: [v.visitor_id] }, event: "case.visit_confirmed", params: { no: c.case_no, date: isoFromUtcDate(v.visit_date), time: v.visit_time, case_id: c.id } });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.visit_confirmed", entityType: "case", entityId: c.id });
      return visitView({ ...v, confirmed_at: new Date() });
    });
  }

  /** The applicant asks for another date: the request becomes a ticket linked to the case (D-C16). */
  async requestOtherDate(req: AppRequest, message: string) {
    const c = await this.cases.caseOf(this.db, req.org!.id);
    const ticket = await this.tickets.open(req, { category: "credit_case", subject: `درخواست تغییر زمان بازدید — پرونده ${c.case_no}`, body: message, link_type: "case", link_id: c.id });
    return this.db.tx(async (q) => {
      const v = await this.liveVisit(q, c.id, true);
      if (!v) throw err.noVisit();
      await this.moveVisit(q, v, "change_requested");
      await q.query(`update case_visits set change_ticket_id = $2 where id = $1`, [v.id, ticket.id]);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.visit_change_requested", entityType: "case", entityId: c.id, after: { ticket_id: ticket.id } });
      return { visit: visitView(v), ticket_id: ticket.id };
    });
  }

  async reportVisit(req: AppRequest, caseId: string, input: { findings: string; photo_doc_ids?: string[] }) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      const v = await this.liveVisit(q, caseId, true);
      if (!v) throw err.noVisit();
      await this.moveVisit(q, v, "done");
      await q.query(`update case_visits set findings = $2, photo_doc_ids = $3, reported_by = $4, done_at = now() where id = $1`, [v.id, input.findings, input.photo_doc_ids ?? [], req.user!.id]);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.visit_done", entityType: "case", entityId: caseId });
      return visitView({ ...v, findings: input.findings, photo_doc_ids: input.photo_doc_ids ?? [], done_at: new Date() });
    });
  }

  async originalReceived(req: AppRequest, caseId: string, itemId: string) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId);
      const i = (await q.query(`select * from case_items where id = $1 and case_id = $2 for update`, [itemId, caseId])).rows[0];
      if (!i) throw Errors.notFound("Case item");
      if (!checklistItem(i.code)?.originalRequired) throw err.notOriginal();
      await q.query(`update case_items set original_received_at = now(), original_received_by = $2 where id = $1`, [itemId, req.user!.id]);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.original_received", entityType: "case_item", entityId: itemId });
      return { item_id: itemId, original_received: true };
    });
  }

  /** Reminder SMS the day before a confirmed visit. */
  async remindVisits() {
    const res = await withLease(this.db, "visits.remind", 300, async () => {
      const tomorrow = isoFromUtcDate(new Date(Date.parse(`${tehranToday()}T00:00:00Z`) + 86400_000)); // the shared clock (TP_TODAY in tests)
      const rows = (await this.db.query(
        `select v.*, c.org_id, c.case_no from case_visits v join cases c on c.id = v.case_id where v.state = 'confirmed' and v.visit_date = $1 and v.reminder_sent_at is null`,
        [tomorrow],
      )).rows;
      for (const v of rows) {
        await this.db.tx(async (q) => {
          const r = await q.query(`update case_visits set reminder_sent_at = now() where id = $1 and reminder_sent_at is null returning id`, [v.id]);
          if (!r.rows[0]) return;
          await this.notifications.notify(q, { to: { orgId: v.org_id }, event: "case.visit_reminder", params: { no: v.case_no, time: v.visit_time } });
          await this.notifications.notify(q, { to: { userIds: [v.visitor_id] }, event: "case.visit_reminder", params: { no: v.case_no, time: v.visit_time } });
        });
      }
      return { reminded: rows.length };
    });
    return res ?? { skipped: "another worker holds the lease" };
  }

  // ================================================================== scoring method (versioned)

  async method(q: Queryable = this.db): Promise<ScoringMethod> {
    const r = (await q.query(`select * from scoring_methods order by version desc limit 1`)).rows[0];
    // Built-in versions: 1 = the fund's workbook (3 periods); 2 = the fund's 2026-11-26 rules (4 periods, weights
    // 0.4/0.3/0.2/0.1). Version 2 is added once, unless the fund has already published its own later versions.
    if (r && (r.version >= 2 || r.created_by)) return { ...r.config, version: r.version };
    const v2: ScoringMethod = { ...DEFAULT_SCORING_METHOD, ...SCORING_METHOD_V2_CHANGES, version: 2 };
    await q.query(`insert into scoring_methods (version, config, note) values (1, $1, 'built-in: the fund''s workbook') on conflict do nothing`, [JSON.stringify(DEFAULT_SCORING_METHOD)]);
    await q.query(`insert into scoring_methods (version, config, note) values (2, $1, 'built-in: four periods, margin weights 0.4/0.3/0.2/0.1 (fund, 2026-11-26)') on conflict do nothing`, [JSON.stringify(v2)]);
    return v2;
  }

  async setMethod(req: AppRequest, input: Omit<ScoringMethod, "version"> & { note?: string }) {
    return this.db.tx(async (q) => {
      const cur = await this.method(q);
      const next: ScoringMethod = { ...cur, ...input, version: cur.version + 1 } as ScoringMethod;
      const { note, ...config } = next as any;
      const problems = validateScoringMethod(config);
      if (problems.length) throw err.method(problems);
      await q.query(`insert into scoring_methods (version, config, note, created_by) values ($1,$2,$3,$4)`, [next.version, JSON.stringify(config), input.note ?? null, req.user!.id]);
      await this.audit.append(q, { ...actor(req), action: "scoring_method.changed", entityType: "scoring_method", entityId: String(next.version), before: cur, after: config });
      return config;
    });
  }

  // ================================================================== scoring rounds and approval

  private async readiness(q: Queryable, c: any) {
    const missing: string[] = [];
    if (!c.financials_locked_at) missing.push("financials_not_locked");
    if (!(await q.query(`select 1 from case_visits where case_id = $1 and state = 'done'`, [c.id])).rows[0]) missing.push("visit_not_done");
    const items = (await q.query(`select code, label, original_received_at from case_items where case_id = $1 and state = 'accepted'`, [c.id])).rows;
    for (const i of items) if (checklistItem(i.code)?.originalRequired && !i.original_received_at) missing.push(`original_not_received:${i.code}:${i.label}`);
    return missing;
  }

  /**
   * Two calculations (fund rules 2026-11-26, doc 07 §13.2): A on the latest years of statements, B on the current-year
   * trial balance plus the statements before it (the trial balance is not annualised). A is used unless B is higher
   * AND the analyst has checked the trial balance against the tax returns and other documents. The chosen result is
   * returned in the usual shape, with both calculations and the choice attached (stored as the round's outputs).
   */
  compute(c: any, fin: any[], method: ScoringMethod, input: ScoreInput) {
    const n = method.marginWeights.length;
    const periods = calculationPeriods(c.latest_fiscal_year, n);
    const row = (y: number) => fin.find((r) => r.fiscal_year === y);
    const run = (ys: number[]) => scoreCase({ activityType: input.activity_type, years: ys.map((y) => toFinancialYear(row(y)?.verified ?? {})), guarantee: input.guarantee, facility: input.facility ?? undefined }, method);
    let a: any;
    try {
      a = run(periods.a);
    } catch (e) {
      if (e instanceof ScoringInputError) throw err.scoring(e.problems);
      throw e;
    }
    let b: any = null, bError: string[] | null = null;
    try {
      // in spring no trial balance is accepted: only calculation A (fund 2026-11-27)
      if (!trialBalancePeriod(tehranToday())) throw new ScoringInputError(["spring: no trial balance is accepted"]);
      if (!row(c.latest_fiscal_year + 1)?.verified) throw new ScoringInputError(["trial balance missing"]);
      b = run(periods.b);
    } catch (e) {
      if (e instanceof ScoringInputError) bError = e.problems; else throw e;
    }
    const bHigher = !!b && b.creditLimit > a.creditLimit;
    const useB = bHigher && !!input.trial_balance_check?.confirmed;
    const chosen = useB ? b : a;
    const label = (ys: number[]) => ys.map((y) => ({ fiscal_year: y, trial_balance: y === c.latest_fiscal_year + 1, through_month: row(y)?.through_month ?? null }));
    return {
      ...chosen,
      chosen: useB ? "b" : "a",
      b_higher: bHigher,
      trial_balance_check: input.trial_balance_check ?? null,
      alternatives: { a: { ...a, periods: label(periods.a) }, b: b ? { ...b, periods: label(periods.b) } : null, b_error: bError },
    };
  }

  /** The analyst runs (or re-runs) the current round. Moves documents_complete / sent_back_to_analyst → scoring. */
  async score(req: AppRequest, caseId: string, input: ScoreInput) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      if (!["documents_complete", "scoring", "sent_back_to_analyst"].includes(c.state)) throw err.state("Scoring", c.state);
      if (c.state === "documents_complete") {
        const missing = await this.readiness(q, c);
        if (missing.length) throw err.notReady(missing);
      }
      const method = await this.method(q);
      const fin = (await q.query(`select fiscal_year, verified, statement_type, through_month from case_financials where case_id = $1`, [caseId])).rows;
      const result = this.compute(c, fin, method, input);
      let round = (await q.query(`select * from assessment_rounds where case_id = $1 and state in ('preparing','sent_back') order by round_no desc limit 1 for update`, [caseId])).rows[0];
      const judgement = { ...input.guarantee, reasons: input.reasons };
      if (round) {
        await q.query(
          `update assessment_rounds set method_version = $2, activity_type = $3, judgement = $4, facility = $5, inputs = $6, outputs = $7, prepared_by = $8, prepared_at = now() where id = $1`,
          [round.id, method.version, input.activity_type, JSON.stringify(judgement), input.facility ? JSON.stringify(input.facility) : null, JSON.stringify(fin), JSON.stringify(result), req.user!.id],
        );
      } else {
        const no = Number((await q.query(`select coalesce(max(round_no), 0) + 1 as n from assessment_rounds where case_id = $1`, [caseId])).rows[0].n);
        round = { id: uuidv7(), round_no: no };
        await q.query(
          `insert into assessment_rounds (id, case_id, round_no, state, method_version, activity_type, judgement, facility, inputs, outputs, prepared_by)
           values ($1,$2,$3,'preparing',$4,$5,$6,$7,$8,$9,$10)`,
          [round.id, caseId, no, method.version, input.activity_type, JSON.stringify(judgement), input.facility ? JSON.stringify(input.facility) : null, JSON.stringify(fin), JSON.stringify(result), req.user!.id],
        );
      }
      if (c.state !== "scoring") await this.cases.move(q, c, "scoring", req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.scored", entityType: "assessment_round", entityId: round.id, after: { method_version: method.version, judgement, credit_limit: result.creditLimit } });
      return { round_id: round.id, round_no: round.round_no, method_version: method.version, result: summarise(result) };
    });
  }

  async sendForApproval(req: AppRequest, caseId: string, summary: string) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      if (c.state !== "scoring") throw err.state("Sending for approval", c.state);
      const round = (await q.query(`select * from assessment_rounds where case_id = $1 and state in ('preparing','sent_back') order by round_no desc limit 1 for update`, [caseId])).rows[0];
      if (!round) throw err.state("Sending for approval", "no prepared round");
      transition("round", ROUND, round.state as RoundState, "pending_approval");
      await q.query(`update assessment_rounds set state = 'pending_approval', summary = $2 where id = $1`, [round.id, summary]);
      await this.cases.move(q, c, "pending_approval", req.user!.id);
      await closeWorkflowTasks(q, "case", caseId, req.user!.id);
      await staffTask(q, { title: `بررسی و ارسال حد اعتباری پرونده ${c.case_no} برای مدیر صندوق`, linkedType: "case", linkedId: caseId, role: "compliance_officer", key: "case.to_ceo", dueInHours: 48 });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.limit_sent_for_approval", entityType: "assessment_round", entityId: round.id });
      return { round_id: round.id, state: "pending_approval" };
    });
  }

  /**
   * Compliance officer, on the analyst's round (fund rules revised 2026-11-27 — no separate credit approval):
   * sends it to the fund manager (the fund's CEO) with a comment, or back to the analyst with the reason.
   * Never on a round they prepared themselves.
   */
  async toCeo(req: AppRequest, caseId: string, comment: string) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      if (c.state !== "pending_approval") throw err.state("Sending to the fund manager", c.state);
      const round = await this.roundIn(q, caseId, "pending_approval");
      if (round.prepared_by === req.user!.id) throw err.self();
      transition("round", ROUND, "pending_approval", "ceo_review");
      await q.query(`update assessment_rounds set state = 'ceo_review', compliance_comment = $2, compliance_by = $3, compliance_at = now() where id = $1`, [round.id, comment, req.user!.id]);
      await closeWorkflowTasks(q, "case", caseId, req.user!.id);
      await staffTask(q, { title: `تصمیم درباره‌ی حد اعتباری پرونده ${c.case_no}`, description: comment, linkedType: "case", linkedId: caseId, role: "fund_manager", key: "case.ceo_decision", dueInHours: 72 });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.limit_to_ceo", entityType: "assessment_round", entityId: round.id, after: { comment } });
      return { round_state: "ceo_review" };
    });
  }

  async sendBack(req: AppRequest, caseId: string, reason: string) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      if (c.state !== "pending_approval") throw err.state("Sending back", c.state);
      const round = await this.roundIn(q, caseId, "pending_approval");
      if (round.prepared_by === req.user!.id) throw err.self();
      transition("round", ROUND, "pending_approval", "sent_back");
      await q.query(`update assessment_rounds set state = 'sent_back', decision_reason = $2, compliance_by = $3, compliance_at = now() where id = $1`, [round.id, reason, req.user!.id]);
      await closeWorkflowTasks(q, "case", caseId, req.user!.id);
      await this.cases.move(q, c, "sent_back_to_analyst", req.user!.id, reason);
      await staffTask(q, { title: `بازنگری محاسبه‌ی حد اعتباری پرونده ${c.case_no}`, description: reason, linkedType: "case", linkedId: caseId, role: "analyst", key: "case.rescore", dueInHours: 48 });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.limit_sent_back", entityType: "assessment_round", entityId: round.id, after: { reason } });
      return { round_state: "sent_back", case_state: "sent_back_to_analyst" };
    });
  }

  /**
   * Fund manager (the fund's CEO): confirms the committee meeting on the limit was held, may edit the numbers (guarantee and facility ceilings
   * per collateral), accepts or declines, and comments. Goes back to the compliance officer.
   */
  async ceoDecision(req: AppRequest, caseId: string, input: { meeting_held: true; meeting_date: string; decision: "accept" | "decline"; comment: string;
    overrides?: { guarantee?: Partial<Record<string, string>>; facility?: Partial<Record<string, string>> } | null }) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      const round = await this.roundIn(q, caseId, "ceo_review");
      if (round.prepared_by === req.user!.id) throw err.self();
      const to: RoundState = input.decision === "accept" ? "ceo_accepted" : "ceo_declined";
      transition("round", ROUND, "ceo_review", to);
      const overrides = input.decision === "accept" && input.overrides && (Object.keys(input.overrides.guarantee ?? {}).length || Object.keys(input.overrides.facility ?? {}).length) ? input.overrides : null;
      await q.query(
        `update assessment_rounds set state = $2, committee_meeting_on = $3, ceo_decision = $4, ceo_comment = $5, ceo_overrides = $6, ceo_by = $7, ceo_at = now() where id = $1`,
        [round.id, to, input.meeting_date, input.decision, input.comment, overrides ? JSON.stringify(overrides) : null, req.user!.id],
      );
      await closeWorkflowTasks(q, "case", caseId, req.user!.id);
      await staffTask(q, { title: `اعلام نتیجه‌ی اعتبارسنجی پرونده ${c.case_no} به شرکت`, description: input.comment, linkedType: "case", linkedId: caseId, role: "compliance_officer", key: "case.release", dueInHours: 48 });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: `case.limit_${to}`, entityType: "assessment_round", entityId: round.id, after: { meeting_date: input.meeting_date, comment: input.comment, overrides } });
      return { round_state: to };
    });
  }

  /** Compliance officer: releases the CEO's decision to the company with an explanation of the numbers; issues the limit. */
  async release(req: AppRequest, caseId: string, note: string) {
    return this.db.tx(async (q) => {
      const c = await this.cases.caseById(q, caseId, true);
      const round = (await q.query(`select * from assessment_rounds where case_id = $1 and state in ('ceo_accepted','ceo_declined') for update`, [caseId])).rows[0];
      if (!round) throw err.state("Releasing the result", "no CEO decision");
      const to: RoundState = round.state === "ceo_accepted" ? "approved" : "declined";
      transition("round", ROUND, round.state as RoundState, to);
      await q.query(`update assessment_rounds set state = $2, note_to_applicant = $3, released_by = $4, released_at = now() where id = $1`, [round.id, to, note, req.user!.id]);
      await closeWorkflowTasks(q, "case", caseId, req.user!.id);
      let limit: any = null;
      if (to === "approved") {
        limit = await this.issueLimit(q, c, round);
        await this.cases.move(q, c, "limit_issued", req.user!.id);
        await q.query(`update orgs set is_applicant = true, updated_at = now() where id = $1`, [c.org_id]);
        await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.limit_issued", params: { no: c.case_no } });
      } else {
        await this.cases.move(q, c, "declined", req.user!.id, round.ceo_comment);
        await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.declined", params: { no: c.case_no, note } });
      }
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: `case.limit_released_${to}`, entityType: "assessment_round", entityId: round.id, after: { note, limit_rials: limit?.limit_rials } });
      return { round_state: to, credit_limit: limit };
    });
  }

  private async roundIn(q: Queryable, caseId: string, state: RoundState) {
    const r = (await q.query(`select * from assessment_rounds where case_id = $1 and state = $2 for update`, [caseId, state])).rows[0];
    if (!r) throw err.state("This step", `no round in ${state}`);
    return r;
  }

  /** Issues the limit from the round's result and the CEO's edits (the norm scales with an edited limit, so usage stays consistent). */
  private async issueLimit(q: Queryable, c: any, round: any) {
    const r = round.outputs;
    const ceilings: Record<string, Record<string, string>> = { guarantee: {}, facility: {} };
    for (const k of COLLATERAL_CLASSES) {
      ceilings.guarantee[k] = round.ceo_overrides?.guarantee?.[k] ?? toRials(r.guarantee.ceiling[k]).toString();
      ceilings.facility[k] = round.ceo_overrides?.facility?.[k] ?? toRials(r.facility.ceiling[k]).toString();
    }
    const computed = toRials(r.creditLimit);
    const limitRials = BigInt(ceilings.guarantee.cheque);
    const norm = computed > 0n ? (toRials(r.normCeiling) * limitRials) / computed : toRials(r.normCeiling);
    const today = tehranToday();
    await q.query(`update credit_limits set status = 'superseded' where org_id = $1 and status = 'active'`, [c.org_id]);
    const id = uuidv7();
    const validTo = addJalaliMonths(today, LIMIT_VALIDITY_MONTHS);
    await q.query(
      `insert into credit_limits (id, org_id, case_id, round_id, limit_rials, norm_ceiling_rials, ra, re, ceilings, valid_from, valid_to) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, c.org_id, c.id, round.id, limitRials.toString(), norm.toString(), round.judgement.ra, round.judgement.re, JSON.stringify(ceilings), today, validTo],
    );
    return { id, limit_rials: limitRials.toString(), valid_to: validTo, edited_by_ceo: !!round.ceo_overrides };
  }

  async rounds(caseId: string) {
    const r = await this.db.query(`select * from assessment_rounds where case_id = $1 order by round_no`, [caseId]);
    return r.rows.map((x: any) => ({
      id: x.id, round_no: x.round_no, state: x.state, method_version: x.method_version, activity_type: x.activity_type, judgement: x.judgement, facility: x.facility,
      result: summarise(x.outputs), summary: x.summary, prepared_by: x.prepared_by, prepared_at: x.prepared_at, decided_by: x.decided_by, decided_at: x.decided_at,
      decision_reason: x.decision_reason, note_to_applicant: x.note_to_applicant,
      compliance_comment: x.compliance_comment, compliance_at: x.compliance_at, committee_meeting_on: x.committee_meeting_on ? isoFromUtcDate(x.committee_meeting_on) : null,
      ceo_decision: x.ceo_decision, ceo_comment: x.ceo_comment, ceo_overrides: x.ceo_overrides, ceo_at: x.ceo_at, released_at: x.released_at,
    }));
  }

  // ================================================================== credit limit and usage (§7.5)

  async activeLimit(q: Queryable, orgId: string) {
    const l = (await q.query(`select * from credit_limits where org_id = $1 and status = 'active'`, [orgId])).rows[0];
    if (!l) return null;
    if (isoFromUtcDate(l.valid_to) < tehranToday()) return null; // expired, job not run yet
    return l;
  }

  /** Norm usage, in rials. The ledger runs in million rials (as the method does) and is converted back. */
  async limitStatus(q: Queryable, orgId: string, staff: boolean) {
    const l = await this.activeLimit(q, orgId);
    if (!l) return null;
    const usages = (await q.query(`select * from limit_usages where org_id = $1 order by created_at`, [orgId])).rows;
    const m = (r: string | bigint) => Number(BigInt(r)) / 1e6;
    const ledger = usageLedger(m(l.norm_ceiling_rials) * collateralFactor(l), usages.map((u: any) => ({ id: u.id, amount: m(u.amount_rials), ra: Number(u.ra), re: Number(u.re), active: u.active })));
    const ra = Number(l.ra), re = Number(l.re);
    const available = Math.max(ledger.remaining, 0) * ra * re;
    const used = usages.filter((u: any) => u.active).reduce((s: bigint, u: any) => s + BigInt(u.amount_rials), 0n);
    return {
      id: l.id, limit: String(l.limit_rials), valid_from: isoFromUtcDate(l.valid_from), valid_to: isoFromUtcDate(l.valid_to),
      used: used.toString(), available: toRials(available).toString(),
      ceilings: l.ceilings, collateral: l.collateral ?? "cheque", adjusted: !!l.adjusted_from,
      ...(staff ? {
        norm_ceiling: String(l.norm_ceiling_rials), remaining_norm: toRials(ledger.remaining).toString(), ra, re, adjustment: l.adjustment ?? null,
        usages: ledger.rows.map((r, i) => ({ ...publicUsage(usages[i]), deduction: toRials(r.deduction).toString(), remaining_after: toRials(r.remainingAfter).toString() })),
      } : {}),
    };
  }

  /** A-74: what the applicant sees — ceilings, validity, usage and the fund's note; never the coefficients (Q6). */
  async myLimit(req: AppRequest) {
    const c = await this.cases.caseOf(this.db, req.org!.id);
    const status = await this.limitStatus(this.db, req.org!.id, false);
    const round = (await this.db.query(`select note_to_applicant from assessment_rounds where case_id = $1 and state = 'approved' order by round_no desc limit 1`, [c.id])).rows[0];
    return { case_state: c.state, limit: status, note: round?.note_to_applicant ?? null };
  }

  async staffLimit(orgId: string) {
    const s = await this.limitStatus(this.db, orgId, true);
    if (!s) throw err.noLimit();
    return s;
  }

  /** Existing guarantees and facilities the company holds with the fund draw on the norm too (workbook ledger). */
  async addUsage(req: AppRequest, orgId: string, input: { source_type: "existing_guarantee" | "existing_facility"; description: string; amount: string; ra: number; re: number }) {
    return this.db.tx(async (q) => {
      if (!(await this.activeLimit(q, orgId))) throw err.noLimit();
      const id = uuidv7();
      await q.query(
        `insert into limit_usages (id, org_id, source_type, description, amount_rials, ra, re, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, orgId, input.source_type, input.description, input.amount, input.ra, input.re, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), orgId, action: "limit.usage_added", entityType: "limit_usage", entityId: id, after: input });
      return this.limitStatus(q, orgId, true);
    });
  }

  /**
   * S-11 "limit check": the analyst sets the project's Ra and Re (with a reason); project ceiling = remaining norm × Ra × Re.
   * If the requested amount fits, the application moves on (D-C22: the steps after this — due diligence, committee,
   * contracts — are not specified yet). Nothing is held: the amount is deducted from the limit only when the financing
   * is approved (decided 2026-11-17), so that approval must check the limit again.
   */
  async checkApplication(req: AppRequest, appId: string, input: { ra: number; re: number; reason: string }) {
    return this.db.tx(async (q) => {
      const a = await this.apps.load(q, appId, undefined, true);
      if (a.status !== "credit_assessment") throw err.state("A limit check", a.status);
      const l = await this.activeLimit(q, a.applicant_org_id);
      if (!l) throw err.noLimit();
      const usages = (await q.query(`select * from limit_usages where org_id = $1 order by created_at`, [a.applicant_org_id])).rows;
      const m = (r: string | bigint) => Number(BigInt(r)) / 1e6;
      const amount = BigInt(a.requested_amount);
      const chk = limitCheck(m(l.norm_ceiling_rials) * collateralFactor(l), usages.map((u: any) => ({ id: u.id, amount: m(u.amount_rials), ra: Number(u.ra), re: Number(u.re), active: u.active })),
        { ra: input.ra, re: input.re, amount: m(amount) });
      const usageId: string | null = null; // nothing is held until the financing is approved
      const id = uuidv7();
      await q.query(
        `insert into application_limit_checks (id, application_id, credit_limit_id, ra, re, reason, amount_rials, remaining_norm_rials, project_ceiling_rials, fits, usage_id, checked_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, a.id, l.id, input.ra, input.re, input.reason, amount.toString(), toRials(Math.max(chk.remainingNorm, 0)).toString(), toRials(chk.projectCeiling).toString(), chk.fits, usageId, req.user!.id],
      );
      if (chk.fits) await this.apps.move(q, a, "due_diligence", req.user!.id, "limit check passed", { limit_check_id: id });
      await this.audit.append(q, { ...actor(req), orgId: a.applicant_org_id, action: chk.fits ? "application.limit_check_passed" : "application.limit_check_failed", entityType: "application", entityId: a.id, after: { ...input, project_ceiling: toRials(chk.projectCeiling).toString() } });
      return {
        id, fits: chk.fits, amount: amount.toString(), project_ceiling: toRials(chk.projectCeiling).toString(), remaining_norm: toRials(Math.max(chk.remainingNorm, 0)).toString(),
        shortfall: toRials(chk.shortfall).toString(), application_status: a.status,
      };
    });
  }

  /** Daily: expire credit limits past their validity; close cases left without activity (Q9; plan/07 §2). */
  async housekeeping(inactiveDays = 90) {
    const res = await withLease(this.db, "cases.housekeeping", 600, async () => {
      const today = tehranToday();
      const out = { limits_expired: 0, cases_closed: 0 };
      const limits = (await this.db.query(`select * from credit_limits where status = 'active' and valid_to < $1`, [today])).rows;
      for (const l of limits) {
        await this.db.tx(async (q) => {
          const r = await q.query(`update credit_limits set status = 'expired' where id = $1 and status = 'active' returning id`, [l.id]);
          if (!r.rows[0]) return;
          const c = await this.cases.caseById(q, l.case_id, true);
          if (c.state === "limit_issued") await this.cases.move(q, c, "expired", null, "credit limit validity ended");
          await this.notifications.notify(q, { to: { orgId: l.org_id, orgRoles: ["org_admin"] }, event: "case.limit_expired", params: { no: c.case_no } });
          await this.audit.append(q, { actorType: "system", orgId: l.org_id, action: "limit.expired", entityType: "credit_limit", entityId: l.id });
          out.limits_expired++;
        });
      }
      const idle = (await this.db.query(
        `select id from cases where state in ('opened','in_preparation','returned') and last_activity_at < now() - ($1 || ' days')::interval`, [String(inactiveDays)],
      )).rows;
      for (const row of idle) {
        await this.db.tx(async (q) => {
          const c = await this.cases.caseById(q, row.id, true);
          if (!["opened", "in_preparation", "returned"].includes(c.state)) return;
          await this.cases.move(q, c, "closed_inactive", null, `no activity for ${inactiveDays} days`);
          await closeWorkflowTasks(q, "case", c.id, null);
          await this.notifications.notify(q, { to: { orgId: c.org_id, orgRoles: ["org_admin"] }, event: "case.closed_inactive", params: { no: c.case_no, days: inactiveDays } });
          await this.audit.append(q, { actorType: "system", orgId: c.org_id, action: "case.closed_inactive", entityType: "case", entityId: c.id });
          out.cases_closed++;
        });
      }
      return out;
    });
    return res ?? { skipped: "another worker holds the lease" };
  }

  async releaseUsage(req: AppRequest, usageId: string, reason: string) {
    return this.db.tx(async (q) => {
      const u = (await q.query(`select * from limit_usages where id = $1 for update`, [usageId])).rows[0];
      if (!u) throw Errors.notFound("Usage");
      if (!u.active) throw err.state("Releasing", "already released");
      await q.query(`update limit_usages set active = false, released_by = $2, released_at = now(), release_reason = $3 where id = $1`, [usageId, req.user!.id, reason]);
      await this.audit.append(q, { ...actor(req), orgId: u.org_id, action: "limit.usage_released", entityType: "limit_usage", entityId: usageId, after: { reason } });
      return this.limitStatus(q, u.org_id, true);
    });
  }
}

export interface ScoreInput {
  activity_type: ActivityType;
  guarantee: { rc: number; ra: number; re: number };
  reasons: { rc: string; ra: string; re: string };
  facility?: { rc: number; ra: number; re: number } | null;
  /** Needed to use calculation B when it is higher: the trial balance was checked against the tax returns and other documents. */
  trial_balance_check?: { confirmed: boolean; note: string } | null;
}

function tariffView(t: any) {
  return {
    version: t.version, effective_from: t.effective_from instanceof Date ? isoFromUtcDate(t.effective_from) : t.effective_from,
    assessment_fee_tehran: String(t.assessment_fee_tehran), assessment_fee_outside: String(t.assessment_fee_outside), application_fee: String(t.application_fee),
    servicing_fee_bps: t.servicing_fee_bps, investor_fee_bps: t.investor_fee_bps, platform_share_bps: t.platform_share_bps, note: t.note, created_by: t.created_by, created_at: t.created_at,
  };
}

const publicUsage = (u: any) => ({ id: u.id, source_type: u.source_type, source_id: u.source_id, description: u.description, amount: String(u.amount_rials), ra: Number(u.ra), re: Number(u.re), active: u.active, released_at: u.released_at });

/** The scoring result for the fund panel (S-18, S-19), amounts converted to rials. */
function summarise(r: any): any {
  const rials = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toRials(v).toString()]));
  // per period, for the committee: each period separately, the trial balance marked (it is not annualised)
  const periods = (x: any) => (x.periods ?? []).map((p: any, i: number) => ({
    ...p, sales: toRials(x.statements[i].sales).toString(), profit_before_tax: toRials(x.statements[i].profitBeforeTax).toString(), margin: x.ratios[i].profitability,
    growth: i < x.statements.length - 1 ? (x.statements[i].sales - x.statements[i + 1].sales) / x.statements[i + 1].sales : null,
  }));
  return {
    ...(r.alternatives ? {
      chosen: r.chosen, b_higher: r.b_higher, trial_balance_check: r.trial_balance_check,
      alternatives: {
        a: { ...summariseOne(r.alternatives.a), periods: periods(r.alternatives.a) },
        b: r.alternatives.b ? { ...summariseOne(r.alternatives.b), periods: periods(r.alternatives.b) } : null,
        b_error: r.alternatives.b_error,
      },
    } : {}),
    ...summariseOne(r),
  };
}

function summariseOne(r: any) {
  const rials = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toRials(v).toString()]));
  return {
    credit_limit: toRials(r.creditLimit).toString(), norm_ceiling: toRials(r.normCeiling).toString(),
    guarantee: { norm: rials(r.guarantee.norm), ceiling: rials(r.guarantee.ceiling) },
    facility: { norm: rials(r.facility.norm), ceiling: rials(r.facility.ceiling) },
    coefficients: r.coefficients, bands: r.bands, avg_margin: r.avgMargin, avg_growth: r.avgGrowth, c1: r.c1, c2: r.c2,
    ratios: r.ratios, method_version: r.methodVersion,
  };
}

/**
 * A limit based on stronger collateral than the method's default (the fund manager's adjustment, D-C33) scales the
 * capacity: available amounts and project ceilings grow by the ratio of that collateral's ceiling to the default's.
 * Scaling the norm by this factor is exact: each usage then consumes amount / (Ra × Re × factor) of the original norm.
 */
function collateralFactor(l: any): number {
  const g = l.ceilings?.guarantee;
  const base = Number(g?.cheque ?? 0), chosen = Number(g?.[l.collateral ?? "cheque"] ?? 0);
  return base > 0 && chosen > 0 ? chosen / base : 1;
}
