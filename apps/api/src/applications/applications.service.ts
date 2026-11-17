/**
 * Initiatives and funding applications (PRD FR-APP-1..5), from draft through screening (FR-ASM-1).
 * Credit assessment, due diligence and committee follow in M-D.
 *
 * Status changes go through the APPLICATION state machine in @tp/domain, so illegal jumps are impossible.
 * Submitting is maker–checker: a preparer prepares, an approver submits (with step-up). In single-user mode the same
 * person may do both, still with step-up (D17).
 */
import { Inject, Injectable } from "@nestjs/common";
import { APPLICATION, ApplicationStatus, canTransition, isoFromUtcDate, jalaliYearOf } from "@tp/domain";
import { DB, Db, Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { kybRequired } from "../deposits/deposits.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { formatMoney } from "@tp/domain";

/** Today's date in Tehran (UTC+03:30), as an ISO date. */
export const tehranToday = () => isoFromUtcDate(new Date(Date.now() + 3.5 * 3600_000));

export const INVESTMENT_TYPES = ["project_finance", "working_capital", "equipment", "research_commercialisation"] as const;

export interface InitiativeInput {
  title: string;
  description: string;
  sector: string;
  location: string;
  started_on: string;
  progress_summary: string;
  evidence_doc_ids: string[];
}

export interface ApplicationInput {
  initiative_id: string;
  investment_type: (typeof INVESTMENT_TYPES)[number];
  requested_amount: string;
  min_amount?: string | null;
  proposed_rate: string;
  /** D26: "monthly" means proposed_rate is per month (e.g. 0.056). Defaults to annual. */
  proposed_rate_basis?: "annual" | "monthly";
  proposed_duration_days: number;
  proposed_rule: "all_or_nothing" | "keep_raised";
  use_of_funds: string;
  repayment_source: string;
  proposed_guarantees: { type: string; description: string; amount?: string }[];
  document_ids: string[];
}

const err = {
  transition: (from: string, to: string) =>
    new ApiError(409, "ILLEGAL_TRANSITION", `Cannot go from ${from} to ${to}`, "این تغییر وضعیت برای درخواست مجاز نیست.", { from, to }),
  notEditable: () => new ApiError(409, "NOT_EDITABLE", "Only drafts and returned applications can be edited", "فقط پیش‌نویس یا درخواست برگشتی قابل ویرایش است."),
  noLimit: () => new ApiError(403, "CREDIT_LIMIT_REQUIRED", "The organisation needs a valid credit limit from the fund", "برای درخواست تأمین مالی، شرکت باید حد اعتباری معتبر از صندوق داشته باشد."),
  notStarted: () => new ApiError(422, "INITIATIVE_NOT_STARTED", "Only initiatives that have already started can be funded", "فقط طرح‌هایی که آغاز شده‌اند قابل تأمین مالی هستند."),
  noEvidence: () => new ApiError(422, "EVIDENCE_REQUIRED", "Attach evidence that the initiative has started", "مدرکی از آغاز طرح پیوست کنید."),
  docs: () => new ApiError(422, "DOCUMENT_INVALID", "Documents must be uploaded documents of this organisation", "اسناد باید از اسناد بارگذاری‌شده‌ی همین شرکت باشند."),
  notPrepared: () => new ApiError(409, "NOT_PREPARED", "A preparer must first send it for approval", "ابتدا تهیه‌کننده باید درخواست را برای تأیید بفرستد."),
  makerChecker: () =>
    new ApiError(403, "MAKER_CHECKER", "The approver must be someone other than the preparer (unless single-user mode)", "تأییدکننده باید فردی غیر از تهیه‌کننده باشد (مگر در حالت تک‌کاربره)."),
  openItems: (n: number) => new ApiError(409, "RETURN_ITEMS_OPEN", `${n} returned item(s) still open`, `${n} مورد اصلاحی هنوز انجام نشده است.`, { open: n }),
  conflict: () => new ApiError(403, "CONFLICT_OF_INTEREST", "Reviewers cannot handle their own organisation", "بررسی پرونده سازمانی که عضو آن هستید مجاز نیست."),
  reason: () => new ApiError(422, "REASON_REQUIRED", "A reason is required", "ذکر دلیل الزامی است."),
  returnItems: () => new ApiError(422, "RETURN_ITEMS_REQUIRED", "List what the applicant must fix", "موارد اصلاحی را برای متقاضی مشخص کنید."),
};

const view = (a: any) => ({
  id: a.id, application_no: a.application_no, initiative_id: a.initiative_id, applicant_org_id: a.applicant_org_id, status: a.status,
  investment_type: a.investment_type, requested_amount: String(a.requested_amount), min_amount: a.min_amount === null ? null : String(a.min_amount),
  proposed_rate: String(a.proposed_rate), proposed_rate_basis: a.proposed_rate_basis, assessment_invoice_id: a.assessment_invoice_id ?? null,
  proposed_duration_days: a.proposed_duration_days, proposed_rule: a.proposed_rule,
  use_of_funds: a.use_of_funds, repayment_source: a.repayment_source, proposed_guarantees: a.proposed_guarantees, document_ids: a.document_ids,
  prepared_by: a.prepared_by, prepared_at: a.prepared_at, submitted_by: a.submitted_by, submitted_at: a.submitted_at, single_user: a.single_user,
  last_activity_at: a.last_activity_at, created_at: a.created_at,
});

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pricing: PricingService,
  ) {}

  // ------------------------------------------------------------------ helpers

  async move(q: Queryable, a: any, to: ApplicationStatus, actorId: string | null, reason?: string | null, details?: unknown) {
    if (!canTransition(APPLICATION, a.status as ApplicationStatus, to)) throw err.transition(a.status, to);
    await q.query(`update applications set status=$2, last_activity_at=now(), updated_at=now() where id=$1`, [a.id, to]);
    await q.query(`insert into application_events (application_id, from_status, to_status, actor_id, reason, details) values ($1,$2,$3,$4,$5,$6)`, [
      a.id, a.status, to, actorId, reason ?? null, details === undefined ? null : JSON.stringify(details),
    ]);
    a.status = to;
    // an application that ends gives back any part of the credit limit deducted for it (deduction happens at approval)
    if (["withdrawn", "rejected", "expired"].includes(to)) {
      await q.query(
        `update limit_usages set active = false, released_by = $2, released_at = now(), release_reason = $3 where source_type = 'application' and source_id = $1 and active`,
        [a.id, actorId, `application ${to}`],
      );
    }
  }

  private async docsOk(q: Queryable, orgId: string, ids: string[]) {
    if (!ids.length) return true;
    const r = await q.query(`select id from documents where id = any($1::uuid[]) and org_id = $2 and status = 'uploaded'`, [ids, orgId]);
    return r.rows.length === new Set(ids).size;
  }

  private async kybValid(q: Queryable, orgId: string) {
    return !!(await q.query(`select 1 from orgs where id = $1 and status = 'active' and kyb_expires_at > now()`, [orgId])).rows[0];
  }

  async load(q: Queryable, id: string, orgId?: string, lock = false) {
    const a = (await q.query(`select * from applications where id = $1 ${orgId ? "and applicant_org_id = $2" : ""} ${lock ? "for update" : ""}`, orgId ? [id, orgId] : [id])).rows[0];
    if (!a) throw Errors.notFound("Application");
    return a;
  }

  // ------------------------------------------------------------------ initiatives

  async createInitiative(req: AppRequest, input: InitiativeInput) {
    const orgId = req.org!.id;
    if (!(await this.kybValid(this.db, orgId))) throw kybRequired();
    if (!(await this.docsOk(this.db, orgId, input.evidence_doc_ids))) throw err.docs();
    const id = uuidv7();
    return this.db.tx(async (q) => {
      const row = (
        await q.query(
          `insert into initiatives (id, applicant_org_id, title, description, sector, location, started_on, progress_summary, evidence_doc_ids, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [id, orgId, input.title, input.description, input.sector, input.location, input.started_on, input.progress_summary, input.evidence_doc_ids, req.user!.id],
        )
      ).rows[0];
      await this.audit.append(q, { ...actor(req), orgId, action: "initiative.created", entityType: "initiative", entityId: id, after: { title: input.title } });
      return row;
    });
  }

  async listInitiatives(req: AppRequest) {
    return (await this.db.query(`select * from initiatives where applicant_org_id = $1 order by created_at desc`, [req.org!.id])).rows;
  }

  async updateInitiative(req: AppRequest, id: string, input: Partial<InitiativeInput>) {
    const orgId = req.org!.id;
    if (input.evidence_doc_ids && !(await this.docsOk(this.db, orgId, input.evidence_doc_ids))) throw err.docs();
    return this.db.tx(async (q) => {
      const i = (await q.query(`select * from initiatives where id = $1 and applicant_org_id = $2 for update`, [id, orgId])).rows[0];
      if (!i) throw Errors.notFound("Initiative");
      // Locked while an application for it is with the fund (the fund reviews what was submitted).
      const busy = (await q.query(`select 1 from applications where initiative_id = $1 and status not in ('draft','returned','rejected','withdrawn','expired')`, [id])).rows[0];
      if (busy) throw new ApiError(409, "INITIATIVE_LOCKED", "An application for this initiative is under review", "درخواست این طرح در حال بررسی است و طرح قابل ویرایش نیست.");
      const m = { ...i, ...input };
      const row = (
        await q.query(
          `update initiatives set title=$2, description=$3, sector=$4, location=$5, started_on=$6, progress_summary=$7, evidence_doc_ids=$8, updated_at=now()
           where id=$1 returning *`,
          [id, m.title, m.description, m.sector, m.location, m.started_on, m.progress_summary, m.evidence_doc_ids],
        )
      ).rows[0];
      await this.audit.append(q, { ...actor(req), orgId, action: "initiative.updated", entityType: "initiative", entityId: id });
      return row;
    });
  }

  // ------------------------------------------------------------------ applications (applicant side)

  async create(req: AppRequest, input: ApplicationInput) {
    const orgId = req.org!.id;
    if (!(await this.kybValid(this.db, orgId))) throw kybRequired();
    const ini = (await this.db.query(`select * from initiatives where id = $1 and applicant_org_id = $2`, [input.initiative_id, orgId])).rows[0];
    if (!ini) throw Errors.notFound("Initiative");
    if (!(await this.docsOk(this.db, orgId, input.document_ids))) throw err.docs();
    return this.db.tx(async (q) => {
      const n = Number((await q.query(`select nextval('application_no_seq') as n`)).rows[0].n);
      const no = `APP-${jalaliYearOf(tehranToday())}-${String(n).padStart(4, "0")}`;
      const id = uuidv7();
      const row = (
        await q.query(
          `insert into applications (id, application_no, initiative_id, applicant_org_id, investment_type, requested_amount, min_amount, proposed_rate,
             proposed_duration_days, proposed_rule, use_of_funds, repayment_source, proposed_guarantees, document_ids, created_by, proposed_rate_basis)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
          [id, no, input.initiative_id, orgId, input.investment_type, input.requested_amount, input.min_amount ?? null, input.proposed_rate,
            input.proposed_duration_days, input.proposed_rule, input.use_of_funds, input.repayment_source, JSON.stringify(input.proposed_guarantees),
            input.document_ids, req.user!.id, input.proposed_rate_basis ?? "annual"],
        )
      ).rows[0];
      await q.query(`insert into application_events (application_id, from_status, to_status, actor_id) values ($1, null, 'draft', $2)`, [id, req.user!.id]);
      await this.audit.append(q, { ...actor(req), orgId, action: "application.created", entityType: "application", entityId: id, after: { application_no: no } });
      return view(row);
    });
  }

  async update(req: AppRequest, id: string, input: Partial<Omit<ApplicationInput, "initiative_id">>) {
    const orgId = req.org!.id;
    if (input.document_ids && !(await this.docsOk(this.db, orgId, input.document_ids))) throw err.docs();
    return this.db.tx(async (q) => {
      const a = await this.load(q, id, orgId, true);
      if (!["draft", "returned"].includes(a.status)) throw err.notEditable();
      const m = { ...a, ...input, proposed_guarantees: input.proposed_guarantees ?? a.proposed_guarantees };
      if (m.min_amount !== null && m.min_amount !== undefined && BigInt(m.min_amount) > BigInt(m.requested_amount))
        throw new ApiError(422, "MIN_ABOVE_REQUESTED", "Minimum amount cannot exceed the requested amount", "حداقل مبلغ نمی‌تواند بیشتر از مبلغ درخواستی باشد.");
      // Any edit after preparation needs a fresh approval.
      const row = (
        await q.query(
          `update applications set investment_type=$2, requested_amount=$3, min_amount=$4, proposed_rate=$5, proposed_duration_days=$6, proposed_rule=$7,
             use_of_funds=$8, repayment_source=$9, proposed_guarantees=$10, document_ids=$11, proposed_rate_basis=$12, prepared_by=null, prepared_at=null,
             last_activity_at=now(), updated_at=now() where id=$1 returning *`,
          [id, m.investment_type, String(m.requested_amount), m.min_amount === null || m.min_amount === undefined ? null : String(m.min_amount), String(m.proposed_rate),
            m.proposed_duration_days, m.proposed_rule, m.use_of_funds, m.repayment_source, JSON.stringify(m.proposed_guarantees), m.document_ids,
            m.proposed_rate_basis ?? "annual"],
        )
      ).rows[0];
      await this.audit.append(q, { ...actor(req), orgId, action: "application.updated", entityType: "application", entityId: id });
      return view(row);
    });
  }

  /** Rules that must hold when an application is prepared and again when it is submitted. */
  private async checkSubmittable(q: Queryable, a: any) {
    if (!(await this.kybValid(q, a.applicant_org_id))) throw kybRequired();
    // plan/07 §1, D-C6: a funding application needs a valid credit limit (replaces applicant onboarding, FR-ISS-1)
    const limit = (await q.query(`select 1 from credit_limits where org_id = $1 and status = 'active' and valid_to >= $2`, [a.applicant_org_id, tehranToday()])).rows[0];
    if (!limit) throw err.noLimit();
    const ini = (await q.query(`select * from initiatives where id = $1`, [a.initiative_id])).rows[0];
    const started = typeof ini.started_on === "string" ? ini.started_on : isoFromUtcDate(ini.started_on);
    if (started > tehranToday()) throw err.notStarted(); // D10: only initiatives already started
    if (!ini.evidence_doc_ids?.length) throw err.noEvidence();
  }

  async requestApproval(req: AppRequest, id: string) {
    const orgId = req.org!.id;
    return this.db.tx(async (q) => {
      const a = await this.load(q, id, orgId, true);
      if (!["draft", "returned"].includes(a.status)) throw err.notEditable();
      await this.checkSubmittable(q, a);
      await q.query(`update applications set prepared_by=$2, prepared_at=now(), last_activity_at=now(), updated_at=now() where id=$1`, [id, req.user!.id]);
      await this.notifications.notify(q, {
        to: { orgId, orgRoles: ["approver", "org_admin"] }, event: "application.approval_needed",
        params: { no: a.application_no, id },
      });
      await this.audit.append(q, { ...actor(req), orgId, action: "application.prepared", entityType: "application", entityId: id });
      return { id, prepared_by: req.user!.id };
    });
  }

  async submit(req: AppRequest, id: string) {
    const orgId = req.org!.id;
    return this.db.tx(async (q) => {
      const a = await this.load(q, id, orgId, true);
      if (!a.prepared_by) throw err.notPrepared();
      const single = req.org!.singleUserMode;
      if (a.prepared_by === req.user!.id && !single) throw err.makerChecker();
      await this.checkSubmittable(q, a);
      if (a.status === "returned") {
        const open = (await q.query(`select count(*)::int as n from tasks where linked_type='application' and linked_id=$1 and workflow_key='application.return_item' and status in ('open','in_progress')`, [id])).rows[0].n;
        if (open > 0) throw err.openItems(open);
      }
      const to: ApplicationStatus = a.status === "returned" ? "resubmitted" : "submitted";
      await this.move(q, a, to, req.user!.id);
      await q.query(`update applications set submitted_by=$2, submitted_at=now(), single_user=$3 where id=$1`, [id, req.user!.id, a.prepared_by === req.user!.id]);
      const name = (await q.query(`select legal_name from orgs where id = $1`, [orgId])).rows[0].legal_name;
      await staffTask(q, {
        title: `بررسی اولیه درخواست ${a.application_no} (${name})`, linkedType: "application", linkedId: id, role: "analyst",
        key: "application.screen", dueInHours: 72,
      });
      await this.notifications.notify(q, { to: { orgId }, event: "application.submitted", params: { no: a.application_no, id } });
      await this.audit.append(q, { ...actor(req), orgId, action: `application.${to}`, entityType: "application", entityId: id });
      return { id, status: to };
    });
  }

  async withdraw(req: AppRequest, id: string, reason: string) {
    const orgId = req.org!.id;
    return this.db.tx(async (q) => {
      const a = await this.load(q, id, orgId, true);
      await this.move(q, a, "withdrawn", req.user!.id, reason);
      await this.cancelOpenInvoice(q, id, req.user!.id, `application withdrawn: ${reason}`);
      await q.query(`update tasks set status='cancelled', updated_at=now() where linked_type='application' and linked_id=$1 and status in ('open','in_progress')`, [id]);
      await this.audit.append(q, { ...actor(req), orgId, action: "application.withdrawn", entityType: "application", entityId: id, after: { reason } });
      return { id, status: "withdrawn" };
    });
  }

  async list(req: AppRequest) {
    const r = await this.db.query(
      `select a.*, i.title as initiative_title from applications a join initiatives i on i.id = a.initiative_id where a.applicant_org_id = $1 order by a.created_at desc`,
      [req.org!.id],
    );
    return r.rows.map((a: any) => ({ ...view(a), initiative_title: a.initiative_title }));
  }

  /** Applicant view: the application, its history, the fund's open requests (tasks) and the latest screening outcome. */
  async get(req: AppRequest, id: string) {
    const a = await this.load(this.db, id, req.org!.id);
    return this.withContext(a, false);
  }

  private async withContext(a: any, internal: boolean) {
    const events = (await this.db.query(`select from_status, to_status, reason, at from application_events where application_id = $1 order by id`, [a.id])).rows;
    const tasks = (
      await this.db.query(
        `select id, title, description, status, due_date, assignee_role from tasks where linked_type='application' and linked_id=$1 and org_id is not null order by created_at`,
        [a.id],
      )
    ).rows;
    const screening = (await this.db.query(`select outcome, comment, return_items, checklist, at from screening_results where application_id = $1 order by at desc limit 1`, [a.id])).rows[0];
    const initiative = (await this.db.query(`select * from initiatives where id = $1`, [a.initiative_id])).rows[0];
    return {
      ...view(a),
      initiative,
      events,
      applicant_tasks: tasks,
      // the fund's internal checklist is not shown to the applicant, only the outcome, comment and items to fix
      screening: screening ? { outcome: screening.outcome, comment: screening.comment, return_items: screening.return_items, at: screening.at, ...(internal ? { checklist: screening.checklist } : {}) } : null,
    };
  }

  // ------------------------------------------------------------------ fund side (screening)

  async adminList(status?: string) {
    const r = await this.db.query(
      `select a.id, a.application_no, a.status, a.requested_amount, a.investment_type, a.submitted_at, a.last_activity_at, o.legal_name, i.title
       from applications a join orgs o on o.id = a.applicant_org_id join initiatives i on i.id = a.initiative_id
       where a.status <> 'draft' and ($1::text is null or a.status = $1) order by a.submitted_at nulls last limit 200`,
      [status ?? null],
    );
    return r.rows.map((x: any) => ({ ...x, requested_amount: String(x.requested_amount) }));
  }

  async adminGet(id: string) {
    const a = await this.load(this.db, id);
    if (a.status === "draft") throw Errors.notFound("Application"); // drafts are private to the applicant
    const org = (await this.db.query(`select id, legal_name, national_id, kyb_expires_at from orgs where id = $1`, [a.applicant_org_id])).rows[0];
    return { ...(await this.withContext(a, true)), applicant: org };
  }

  private async notMember(q: Queryable, orgId: string, userId: string) {
    if ((await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status <> 'removed'`, [orgId, userId])).rows[0]) throw err.conflict();
  }

  async startScreening(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const a = await this.load(q, id, undefined, true);
      await this.notMember(q, a.applicant_org_id, req.user!.id);
      await this.move(q, a, "screening", req.user!.id);
      await q.query(`update applications set analyst_id = $2 where id = $1`, [id, req.user!.id]);
      await this.notifications.notify(q, { to: { orgId: a.applicant_org_id }, event: "application.screening_started", params: { no: a.application_no, id } });
      await this.audit.append(q, { ...actor(req), orgId: a.applicant_org_id, action: "application.screening_started", entityType: "application", entityId: id });
      return { id, status: "screening" };
    });
  }

  async screen(
    req: AppRequest,
    id: string,
    input: { checklist: { item: string; ok: boolean; note?: string }[]; outcome: "pass" | "return" | "reject"; comment?: string; return_items?: { title: string; description?: string }[] },
  ) {
    if (input.outcome !== "pass" && !input.comment?.trim()) throw err.reason();
    if (input.outcome === "return" && !input.return_items?.length) throw err.returnItems();
    return this.db.tx(async (q) => {
      const a = await this.load(q, id, undefined, true);
      await this.notMember(q, a.applicant_org_id, req.user!.id);
      if (a.status !== "screening") throw err.transition(a.status, input.outcome === "pass" ? "credit_assessment" : input.outcome === "return" ? "returned" : "rejected");
      await q.query(
        `insert into screening_results (id, application_id, checklist, outcome, comment, return_items, analyst_id) values ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv7(), id, JSON.stringify(input.checklist), input.outcome, input.comment ?? null, JSON.stringify(input.return_items ?? []), req.user!.id],
      );
      let to: ApplicationStatus = input.outcome === "pass" ? "credit_assessment" : input.outcome === "return" ? "returned" : "rejected";
      // D25: if the fund's price list charges for assessment, the applicant pays before credit assessment starts.
      const invoice = to === "credit_assessment"
        ? await this.pricing.issueInvoice(q, { orgId: a.applicant_org_id, linkedType: "application", linkedId: id, chargePoint: "after_screening", actorId: req.user!.id, today: tehranToday() })
        : null;
      if (invoice) {
        to = "awaiting_payment";
        await q.query(`update applications set assessment_invoice_id = $2 where id = $1`, [id, invoice.id]);
      }
      await this.move(q, a, to, req.user!.id, input.comment ?? null, { checklist_failed: input.checklist.filter((c) => !c.ok).map((c) => c.item) });
      await closeWorkflowTasks(q, "application", id, req.user!.id);
      if (to === "returned") {
        // Each item to fix becomes a task in the applicant's inbox; resubmission waits until all are done.
        for (const item of input.return_items!) {
          await q.query(
            `insert into tasks (id, org_id, title, description, linked_type, linked_id, assignee_role, priority, source, workflow_key)
             values ($1,$2,$3,$4,'application',$5,'preparer','p0','workflow','application.return_item')`,
            [uuidv7(), a.applicant_org_id, item.title, item.description ?? null, id],
          );
        }
        // The next round needs a fresh preparer → approver; the earlier submission stays in application_events.
        await q.query(`update applications set prepared_by = null, prepared_at = null, submitted_by = null where id = $1`, [id]);
      }
      if (to === "rejected") await q.query(`update applications set decided_at = now() where id = $1`, [id]);
      if (to === "credit_assessment") await this.creditTask(q, a);
      const event = to === "returned" ? "application.returned" : to === "rejected" ? "application.rejected" : to === "awaiting_payment" ? "application.payment_required" : "application.passed_screening";
      await this.notifications.notify(q, {
        to: { orgId: a.applicant_org_id }, event,
        params: { no: a.application_no, id, reason: input.comment ?? "", items: input.return_items?.length ?? 0, amount: invoice ? formatMoney(invoice.total) : "", invoice_no: invoice?.invoice_no ?? "", invoice_id: invoice?.id ?? "" },
      });
      await this.audit.append(q, { ...actor(req), orgId: a.applicant_org_id, action: `application.screening_${input.outcome}`, entityType: "application", entityId: id, after: { comment: input.comment ?? null } });
      return { id, status: to };
    });
  }

  private async creditTask(q: Queryable, a: any) {
    await staffTask(q, { title: `اعتبارسنجی درخواست ${a.application_no}`, linkedType: "application", linkedId: a.id, role: "analyst", key: "application.credit", dueInHours: 120 });
  }

  private async cancelOpenInvoice(q: Queryable, applicationId: string, by: string | null, reason: string) {
    await q.query(
      `update invoices set status='cancelled', closed_by=$2, closed_reason=$3, closed_at=now() where linked_type='application' and linked_id=$1 and status='issued'`,
      [applicationId, by, reason],
    );
  }

  /** Called by InvoicesService when the assessment invoice is paid or waived (D25): credit assessment starts. */
  async assessmentSettled(q: Queryable, applicationId: string, actorId: string, how: "paid" | "waived") {
    const a = await this.load(q, applicationId, undefined, true);
    await this.move(q, a, "credit_assessment", actorId, how === "waived" ? "assessment fee waived" : "assessment fee paid");
    await this.creditTask(q, a);
    await this.notifications.notify(q, { to: { orgId: a.applicant_org_id }, event: "application.passed_screening", params: { no: a.application_no, id: a.id } });
    await this.audit.append(q, { actorType: how === "paid" ? "user" : "staff", actorUserId: actorId, orgId: a.applicant_org_id, action: "application.assessment_started", entityType: "application", entityId: a.id, after: { how } });
  }

  // ------------------------------------------------------------------ expiry job

  /** Drafts and returned applications with no activity for `days` expire (FR-APP-5). */
  async expireInactive(days = 60) {
    const rows = (
      await this.db.query(`select * from applications where status in ('draft','returned','awaiting_payment') and last_activity_at < now() - ($1 || ' days')::interval`, [String(days)])
    ).rows;
    let n = 0;
    for (const a of rows) {
      await this.db.tx(async (q) => {
        const cur = await this.load(q, a.id, undefined, true);
        if (!["draft", "returned", "awaiting_payment"].includes(cur.status)) return;
        await this.move(q, cur, "expired", null, `no activity for ${days} days`);
        await this.cancelOpenInvoice(q, a.id, null, `application expired after ${days} days`);
        await q.query(`update tasks set status='cancelled', updated_at=now() where linked_type='application' and linked_id=$1 and status in ('open','in_progress')`, [a.id]);
        await this.notifications.notify(q, { to: { orgId: a.applicant_org_id }, event: "application.expired", params: { no: a.application_no, id: a.id }, dedupeKey: `application.expired:${a.id}` });
        await this.audit.append(q, { actorType: "system", orgId: a.applicant_org_id, action: "application.expired", entityType: "application", entityId: a.id });
        n++;
      });
    }
    return { expired: n };
  }
}
