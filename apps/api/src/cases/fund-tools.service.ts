/**
 * Fund tools added from the fund's feedback (2026-11-25, master plan §6 item 25):
 *   - fee exemptions: the fund manager exempts a company from a fee in advance (no invoice while active);
 *   - checklist templates: staff upload the fund's template for a checklist item (e.g. the lease agreement);
 *   - case assignment: the credit manager divides cases between analysts;
 *   - limit adjustment: the fund manager raises or lowers an issued limit through Rc/Ra/Re and the collateral class.
 */
import { Inject, Injectable } from "@nestjs/common";
import { COLLATERAL_CLASSES, checklistItem, toRials, type CollateralClass } from "@tp/domain";
import { DB, type Db } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { STORAGE, type ObjectStorage } from "../integrations/providers.js";
import { ALLOWED_MIME } from "../documents/documents.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { LimitsService } from "./limits.service.js";

const err = {
  exists: () => new ApiError(409, "EXEMPTION_EXISTS", "An active exemption already exists", "این شرکت برای این کارمزد معافیت فعال دارد."),
  noTemplate: () => new ApiError(422, "NO_TEMPLATE_FOR_ITEM", "This checklist item has no template", "برای این مدرک قالبی تعریف نشده است."),
  notAnalyst: () => new ApiError(422, "NOT_AN_ANALYST", "Cases are assigned to analysts", "پرونده فقط به کارشناس اعتباری واگذار می‌شود."),
  noLimit: () => new ApiError(404, "NO_ACTIVE_LIMIT", "The company has no active credit limit", "این شرکت حد اعتباری فعال ندارد."),
  sameLimit: () => new ApiError(422, "ADJUSTMENT_CHANGES_NOTHING", "The adjustment does not change the limit", "این تغییر، حد اعتباری را تغییر نمی‌دهد."),
};

@Injectable()
export class FundToolsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly limits: LimitsService,
  ) {}

  // ================================================================== fee exemptions

  async exemptions(orgId: string) {
    return (await this.db.query(
      `select e.id, e.charge_point, e.reason, e.granted_at, e.revoked_at, u.full_name as granted_by_name
       from fee_exemptions e join users u on u.id = e.granted_by where e.org_id = $1 order by e.granted_at desc`, [orgId],
    )).rows;
  }

  async grantExemption(req: AppRequest, orgId: string, input: { charge_point: "case_submission" | "after_screening"; reason: string }) {
    return this.db.tx(async (q) => {
      if (!(await q.query(`select 1 from orgs where id = $1`, [orgId])).rows[0]) throw Errors.notFound("Organisation");
      if ((await q.query(`select 1 from fee_exemptions where org_id = $1 and charge_point = $2 and revoked_at is null`, [orgId, input.charge_point])).rows[0]) throw err.exists();
      const id = uuidv7();
      await q.query(`insert into fee_exemptions (id, org_id, charge_point, reason, granted_by) values ($1,$2,$3,$4,$5)`, [id, orgId, input.charge_point, input.reason, req.user!.id]);
      // An already-issued, unpaid invoice for that fee is waived with the same reason.
      const linked = input.charge_point === "case_submission"
        ? `linked_type = 'case' and charge_point = 'case_submission'` : `linked_type = 'application' and charge_point = 'after_screening'`;
      const waived = (await q.query(
        `update invoices set status = 'waived', closed_reason = $2, closed_by = $3, closed_at = now() where org_id = $1 and status = 'issued' and ${linked} returning id`,
        [orgId, `معافیت: ${input.reason}`, req.user!.id],
      )).rows.map((r: any) => r.id);
      await this.audit.append(q, { ...actor(req), orgId, action: "fee.exemption_granted", entityType: "org", entityId: orgId, after: { ...input, waived_invoices: waived } });
      return { id, ...input, waived_invoices: waived };
    });
  }

  async revokeExemption(req: AppRequest, orgId: string, id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query(`update fee_exemptions set revoked_at = now(), revoked_by = $3 where id = $1 and org_id = $2 and revoked_at is null returning charge_point`, [id, orgId, req.user!.id]);
      if (!r.rows[0]) throw Errors.notFound("Exemption");
      await this.audit.append(q, { ...actor(req), orgId, action: "fee.exemption_revoked", entityType: "org", entityId: orgId, after: { id } });
      return { id, revoked: true };
    });
  }

  // ================================================================== checklist templates

  /** Templates on offer, with a short-lived download link (applicants and staff). */
  async templates() {
    const rows = (await this.db.query(
      `select t.code, t.updated_at, d.id as document_id, d.filename, d.storage_key from checklist_templates t join documents d on d.id = t.document_id where d.status = 'uploaded' order by t.code`,
    )).rows;
    return Promise.all(rows.map(async (r: any) => ({
      code: r.code, title: checklistItem(r.code)?.title ?? r.code, filename: r.filename, updated_at: r.updated_at,
      url: await this.storage.presignGet(r.storage_key, r.filename, this.cfg.documentUrlTtlSec),
    })));
  }

  async templateUpload(req: AppRequest, code: string, input: { filename: string; mime: string; size: number }) {
    if (!checklistItem(code)?.template) throw err.noTemplate();
    if (!(ALLOWED_MIME as readonly string[]).includes(input.mime)) throw new ApiError(422, "MIME_NOT_ALLOWED", "File type not allowed", "این نوع فایل پذیرفته نمی‌شود.");
    const id = uuidv7();
    const key = `platform/templates/${code}/${id}`;
    return this.db.tx(async (q) => {
      await q.query(
        `insert into documents (id, owner_type, owner_id, org_id, category, access_level, filename, mime, size_bytes, storage_key, uploaded_by)
         values ($1,'platform',$2,null,'checklist_template','public',$3,$4,$5,$6,$2)`,
        [id, req.user!.id, input.filename, input.mime, input.size, key],
      );
      const url = await this.storage.presignPut(key, input.mime, input.size, this.cfg.documentUrlTtlSec);
      return { document_id: id, upload_url: url, method: "PUT", headers: { "content-type": input.mime } };
    });
  }

  /** After the PUT: checks the upload and makes it the item's template (the previous one stays in history). */
  async templateComplete(req: AppRequest, code: string, documentId: string, sha256: string) {
    return this.db.tx(async (q) => {
      const d = (await q.query(`select * from documents where id = $1 and category = 'checklist_template' for update`, [documentId])).rows[0];
      if (!d) throw Errors.notFound("Document");
      const head = await this.storage.head(d.storage_key);
      if (!head || head.size !== Number(d.size_bytes)) throw new ApiError(422, "UPLOAD_INCOMPLETE", "The file was not uploaded completely", "فایل کامل بارگذاری نشد.");
      await q.query(`update documents set status = 'uploaded', sha256 = $2, uploaded_at = now() where id = $1`, [documentId, sha256]);
      await q.query(
        `insert into checklist_templates (code, document_id, updated_by) values ($1,$2,$3)
         on conflict (code) do update set document_id = excluded.document_id, updated_by = excluded.updated_by, updated_at = now()`,
        [code, documentId, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), action: "checklist.template_set", entityType: "checklist_item", entityId: code, after: { document_id: documentId, filename: d.filename } });
      return { code, document_id: documentId, filename: d.filename };
    });
  }

  // ================================================================== case assignment (credit manager)

  async assign(req: AppRequest, caseId: string, analystId: string) {
    return this.db.tx(async (q) => {
      const c = (await q.query(`select id, case_no, assigned_analyst from cases where id = $1 for update`, [caseId])).rows[0];
      if (!c) throw Errors.notFound("Case");
      const ok = (await q.query(`select 1 from staff_roles where user_id = $1 and role in ('analyst','credit_manager') and revoked_at is null`, [analystId])).rows[0];
      if (!ok) throw err.notAnalyst();
      await q.query(`update cases set assigned_analyst = $2 where id = $1`, [caseId, analystId]);
      await this.audit.append(q, { ...actor(req), action: "case.assigned", entityType: "case", entityId: caseId, before: { assigned_analyst: c.assigned_analyst }, after: { assigned_analyst: analystId } });
      return { case_id: caseId, assigned_analyst: analystId };
    });
  }

  // ================================================================== limit adjustment (fund manager)

  /**
   * Recomputes the company's active limit from the approved round's locked figures with new Rc/Ra/Re and/or a
   * different collateral class, and replaces it (same validity; the old row is kept as superseded, with the reason).
   */
  async adjustLimit(req: AppRequest, orgId: string, input: { rc?: number; ra?: number; re?: number; collateral?: CollateralClass; reason: string }) {
    return this.db.tx(async (q) => {
      const cur = (await q.query(`select * from credit_limits where org_id = $1 and status = 'active' for update`, [orgId])).rows[0];
      if (!cur) throw err.noLimit();
      const round = (await q.query(`select * from assessment_rounds where id = $1`, [cur.round_id])).rows[0];
      const c = (await q.query(`select * from cases where id = $1`, [cur.case_id])).rows[0];
      const fin = (await q.query(`select fiscal_year, verified, statement_type from case_financials where case_id = $1`, [cur.case_id])).rows;
      const m = (await q.query(`select * from scoring_methods where version = $1`, [round.method_version])).rows[0];
      const method = { ...m.config, version: m.version };
      const base = cur.adjustment?.judgement ?? { rc: round.judgement.rc, ra: round.judgement.ra, re: round.judgement.re };
      const judgement = { rc: input.rc ?? base.rc, ra: input.ra ?? base.ra, re: input.re ?? base.re };
      const collateral: CollateralClass = input.collateral ?? cur.collateral;
      const r = this.limits.compute(c, fin, method, { activity_type: round.activity_type, guarantee: judgement, reasons: round.judgement.reasons, facility: round.facility ?? undefined } as any);
      const limitRials = toRials(r.guarantee.ceiling[collateral]);
      if (limitRials.toString() === String(cur.limit_rials) && collateral === cur.collateral && JSON.stringify(judgement) === JSON.stringify(base)) throw err.sameLimit();
      const ceilings: Record<string, Record<string, string>> = { guarantee: {}, facility: {} };
      for (const k of COLLATERAL_CLASSES) {
        ceilings.guarantee[k] = toRials(r.guarantee.ceiling[k]).toString();
        ceilings.facility[k] = toRials(r.facility.ceiling[k]).toString();
      }
      await q.query(`update credit_limits set status = 'superseded' where id = $1`, [cur.id]);
      const id = uuidv7();
      const adjustment = { judgement, collateral, reason: input.reason, by: req.user!.id, at: new Date().toISOString(), previous_limit: String(cur.limit_rials) };
      await q.query(
        `insert into credit_limits (id, org_id, case_id, round_id, limit_rials, norm_ceiling_rials, ra, re, ceilings, valid_from, valid_to, collateral, adjusted_from, adjustment)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, orgId, cur.case_id, cur.round_id, limitRials.toString(), toRials(r.normCeiling).toString(), judgement.ra, judgement.re, JSON.stringify(ceilings),
          cur.valid_from, cur.valid_to, collateral, cur.id, JSON.stringify(adjustment)],
      );
      await this.audit.append(q, { ...actor(req), orgId, action: "credit_limit.adjusted", entityType: "credit_limit", entityId: id,
        before: { limit: String(cur.limit_rials), collateral: cur.collateral, judgement: base }, after: { limit: limitRials.toString(), collateral, judgement, reason: input.reason } });
      await this.notifications.notify(q, { to: { orgId }, event: "case.limit_adjusted", params: {} });
      return { id, limit: limitRials.toString(), previous_limit: String(cur.limit_rials), collateral, judgement, valid_to: cur.valid_to };
    });
  }
}
