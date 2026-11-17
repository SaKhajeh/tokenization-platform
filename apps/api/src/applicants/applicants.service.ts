/**
 * Applicant onboarding (PRD FR-ISS-1, adjusted by D14: the fund is the only issuer). A KYB-approved company asks to
 * become an applicant ("project company") that may request financing, with tax ID, sector, activity, management team,
 * existing debts and financial statements.
 *
 * Review is two-person: an analyst records a recommendation, then a compliance officer (not the same person, not a
 * member of the org) decides. Approval sets the applicant flag. Nothing changes on-chain: only the fund issues.
 */
import { Inject, Injectable } from "@nestjs/common";
import { DB, Db } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest } from "../common/context.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { kybRequired } from "../deposits/deposits.service.js";

export interface ApplicantProfileInput {
  tax_id: string;
  sector: string;
  main_activity: string;
  management: { name: string; position: string; experience_years?: number }[];
  existing_debts: { lender: string; amount: string; maturity?: string }[];
  financial_doc_ids: string[];
}

const err = {
  open: () => new ApiError(409, "APPLICANT_REQUEST_OPEN", "An applicant request is already under review or approved", "درخواست متقاضی در حال بررسی یا تأییدشده است."),
  docs: () => new ApiError(422, "DOCUMENT_INVALID", "Financial documents must be uploaded documents of this organisation", "صورت‌های مالی باید از اسناد بارگذاری‌شده‌ی همین شرکت باشند."),
  conflict: () => new ApiError(403, "CONFLICT_OF_INTEREST", "Reviewers cannot decide on their own organisation", "بررسی پرونده سازمانی که عضو آن هستید مجاز نیست."),
  state: () => new ApiError(409, "APPLICANT_NOT_IN_REVIEW", "This request is not under review", "این درخواست در وضعیت بررسی نیست."),
  needsAnalyst: () => new ApiError(409, "ANALYST_REVIEW_REQUIRED", "An analyst must review first", "ابتدا کارشناس باید درخواست را بررسی کند."),
  sameReviewer: () => new ApiError(403, "MAKER_CHECKER", "The decision must be made by someone other than the analyst", "تصمیم نهایی باید توسط فردی غیر از کارشناس بررسی‌کننده گرفته شود."),
  reason: () => new ApiError(422, "REASON_REQUIRED", "A reason is required", "ذکر دلیل الزامی است."),
};

const view = (p: any) =>
  p && {
    org_id: p.org_id, status: p.status, version: p.version, tax_id: p.tax_id, sector: p.sector, main_activity: p.main_activity,
    management: p.management, existing_debts: p.existing_debts, financial_doc_ids: p.financial_doc_ids,
    submitted_at: p.submitted_at, analyst_recommendation: p.analyst_recommendation, decided_at: p.decided_at, decision_reason: p.decision_reason,
  };

@Injectable()
export class ApplicantsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async get(req: AppRequest) {
    const p = (await this.db.query(`select * from applicant_profiles where org_id = $1`, [req.org!.id])).rows[0];
    const o = (await this.db.query(`select is_applicant from orgs where id = $1`, [req.org!.id])).rows[0];
    return { is_applicant: o.is_applicant, profile: view(p) ?? null };
  }

  async request(req: AppRequest, input: ApplicantProfileInput) {
    const orgId = req.org!.id;
    const valid = (await this.db.query(`select 1 from orgs where id = $1 and kyb_expires_at > now() and status = 'active'`, [orgId])).rows[0];
    if (!valid) throw kybRequired();
    const docs = (await this.db.query(`select id from documents where id = any($1::uuid[]) and org_id = $2 and status = 'uploaded'`, [input.financial_doc_ids, orgId])).rows;
    if (docs.length !== new Set(input.financial_doc_ids).size) throw err.docs();

    return this.db.tx(async (q) => {
      const cur = (await q.query(`select * from applicant_profiles where org_id = $1 for update`, [orgId])).rows[0];
      if (cur && (cur.status === "in_review" || cur.status === "approved")) throw err.open();
      const vals = [orgId, input.tax_id, input.sector, input.main_activity, JSON.stringify(input.management), JSON.stringify(input.existing_debts), input.financial_doc_ids, req.user!.id];
      const row = cur
        ? (
            await q.query(
              `update applicant_profiles set status='in_review', tax_id=$2, sector=$3, main_activity=$4, management=$5, existing_debts=$6, financial_doc_ids=$7,
                 submitted_by=$8, submitted_at=now(), version=version+1, analyst_id=null, analyst_recommendation=null, analyst_comment=null,
                 analyst_reviewed_at=null, decided_by=null, decided_at=null, decision_reason=null
               where org_id=$1 returning *`,
              vals,
            )
          ).rows[0]
        : (
            await q.query(
              `insert into applicant_profiles (org_id, status, tax_id, sector, main_activity, management, existing_debts, financial_doc_ids, submitted_by)
               values ($1,'in_review',$2,$3,$4,$5,$6,$7,$8) returning *`,
              vals,
            )
          ).rows[0];
      const name = (await q.query(`select legal_name from orgs where id = $1`, [orgId])).rows[0].legal_name;
      await staffTask(q, { title: `بررسی درخواست متقاضی تأمین مالی: ${name}`, linkedType: "applicant_profile", linkedId: orgId, role: "analyst", key: "applicant.review", dueInHours: 72 });
      await this.audit.append(q, { ...actor(req), orgId, action: "applicant.requested", entityType: "applicant_profile", entityId: orgId, after: { version: row.version } });
      return view(row);
    });
  }

  // ------------------------------------------------------------------ fund side

  async list(status?: string) {
    const r = await this.db.query(
      `select p.org_id, o.legal_name, o.national_id, p.status, p.sector, p.version, p.submitted_at, p.analyst_recommendation
       from applicant_profiles p join orgs o on o.id = p.org_id where ($1::text is null or p.status = $1) order by p.submitted_at limit 200`,
      [status ?? null],
    );
    return r.rows;
  }

  async detail(orgId: string) {
    const p = (await this.db.query(`select p.*, o.legal_name, o.national_id from applicant_profiles p join orgs o on o.id = p.org_id where p.org_id = $1`, [orgId])).rows[0];
    if (!p) throw Errors.notFound("Applicant request");
    return { ...view(p), legal_name: p.legal_name, national_id: p.national_id, analyst_comment: p.analyst_comment };
  }

  private async notMember(q: any, orgId: string, userId: string) {
    if ((await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status <> 'removed'`, [orgId, userId])).rows[0]) throw err.conflict();
  }

  async analystReview(req: AppRequest, orgId: string, input: { recommendation: "approve" | "reject" | "request_info"; comment: string }) {
    return this.db.tx(async (q) => {
      const p = (await q.query(`select * from applicant_profiles where org_id = $1 for update`, [orgId])).rows[0];
      if (!p) throw Errors.notFound("Applicant request");
      if (p.status !== "in_review") throw err.state();
      await this.notMember(q, orgId, req.user!.id);
      await q.query(
        `update applicant_profiles set analyst_id=$2, analyst_recommendation=$3, analyst_comment=$4, analyst_reviewed_at=now() where org_id=$1`,
        [orgId, req.user!.id, input.recommendation, input.comment],
      );
      await closeWorkflowTasks(q, "applicant_profile", orgId, req.user!.id);
      const name = (await q.query(`select legal_name from orgs where id = $1`, [orgId])).rows[0].legal_name;
      await staffTask(q, {
        title: `تصمیم درخواست متقاضی: ${name}`, description: `پیشنهاد کارشناس: ${input.recommendation}`,
        linkedType: "applicant_profile", linkedId: orgId, role: "compliance_officer", key: "applicant.decision", dueInHours: 48,
      });
      await this.audit.append(q, { ...actor(req), orgId, action: "applicant.analyst_reviewed", entityType: "applicant_profile", entityId: orgId, after: input });
      return { org_id: orgId, analyst_recommendation: input.recommendation };
    });
  }

  async decide(req: AppRequest, orgId: string, input: { decision: "approve" | "reject" | "request_info"; reason?: string }) {
    if (input.decision !== "approve" && !input.reason?.trim()) throw err.reason();
    return this.db.tx(async (q) => {
      const p = (await q.query(`select * from applicant_profiles where org_id = $1 for update`, [orgId])).rows[0];
      if (!p) throw Errors.notFound("Applicant request");
      if (p.status !== "in_review") throw err.state();
      if (!p.analyst_id) throw err.needsAnalyst();
      if (p.analyst_id === req.user!.id) throw err.sameReviewer();
      await this.notMember(q, orgId, req.user!.id);
      const status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "info_requested";
      await q.query(`update applicant_profiles set status=$2, decided_by=$3, decided_at=now(), decision_reason=$4 where org_id=$1`, [orgId, status, req.user!.id, input.reason ?? null]);
      if (status === "approved") {
        await q.query(`update orgs set is_applicant = true, updated_at = now() where id = $1`, [orgId]);
      }
      await closeWorkflowTasks(q, "applicant_profile", orgId, req.user!.id);
      await this.notifications.notify(q, {
        to: { orgId, orgRoles: ["org_admin"] }, event: `applicant.${status}` as "applicant.approved" | "applicant.rejected" | "applicant.info_requested",
        params: { reason: input.reason ?? "" }, dedupeKey: `applicant.${status}:${orgId}:${p.version}`,
      });
      await this.audit.append(q, { ...actor(req), orgId, action: `applicant.${status}`, entityType: "applicant_profile", entityId: orgId, after: { reason: input.reason ?? null } });
      return { org_id: orgId, status };
    });
  }
}
