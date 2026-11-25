/**
 * The fund's assessment report (plan/07 §7.6, S-18/S-19): inquiries per subject, red flags, and everything the
 * workbook's report asks for, assembled from the form, the items, the visit and the figures — never retyped.
 */
import { Inject, Injectable } from "@nestjs/common";
import { casePeople, financialAnalysis, isoFromUtcDate, scoringRatios, statement, toFinancialYear, figureProblems, scoringYears } from "@tp/domain";
import { DB, type Db } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";

const err = {
  subject: () => new ApiError(422, "INQUIRY_SUBJECT_UNKNOWN", "The subject must be the company or one of its directors", "موضوع استعلام باید شرکت یا یکی از مدیران آن باشد."),
};

const d = (v: any) => (v instanceof Date ? isoFromUtcDate(v) : v);

@Injectable()
export class ReportService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService) {}

  private async loadCase(id: string) {
    const c = (await this.db.query(`select c.*, o.legal_name, o.national_id, o.legal_form from cases c join orgs o on o.id = c.org_id where c.id = $1`, [id])).rows[0];
    if (!c) throw Errors.notFound("Case");
    return c;
  }

  private async sections(caseId: string) {
    const rows = (await this.db.query(`select section, data from case_sections where case_id = $1`, [caseId])).rows;
    return Object.fromEntries(rows.map((r: any) => [r.section, r.data])) as Record<string, any>;
  }

  async addInquiry(req: AppRequest, caseId: string, input: {
    subject_type: "company" | "person"; subject_national_id: string; bureau: string; inquiry_date: string; result: "pass" | "fail"; sana_registered: boolean; description?: string | null; document_id?: string | null;
  }) {
    const c = await this.loadCase(caseId);
    const secs = await this.sections(caseId);
    const directors = casePeople(secs.board).filter((p) => p.roles.includes("ceo") || p.roles.includes("board"));
    const name = input.subject_type === "company"
      ? input.subject_national_id === c.national_id ? c.legal_name : null
      : directors.find((p) => p.national_id === input.subject_national_id)?.name ?? null;
    if (!name) throw err.subject();
    if (input.document_id && !(await this.db.query(`select 1 from documents where id = $1 and org_id = $2`, [input.document_id, c.org_id])).rows[0]) throw Errors.notFound("Document");
    return this.db.tx(async (q) => {
      const id = uuidv7();
      await q.query(
        `insert into case_inquiries (id, case_id, subject_type, subject_national_id, subject_name, bureau, inquiry_date, result, sana_registered, description, document_id, recorded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, caseId, input.subject_type, input.subject_national_id, name, input.bureau, input.inquiry_date, input.result, input.sana_registered, input.description ?? null, input.document_id ?? null, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.inquiry_recorded", entityType: "case", entityId: caseId, after: { subject: input.subject_national_id, result: input.result, sana: input.sana_registered } });
      return { id, subject_name: name };
    });
  }

  async report(caseId: string) {
    const c = await this.loadCase(caseId);
    const s = await this.sections(caseId);
    const people = casePeople(s.board);
    const directors = people.filter((p) => p.roles.includes("ceo") || p.roles.includes("board"));
    const signatories = people.filter((p) => p.signing_right);

    // ---- inquiries: the latest per subject
    const inq = (await this.db.query(`select * from case_inquiries where case_id = $1 order by inquiry_date, recorded_at`, [caseId])).rows;
    const latest = new Map<string, any>();
    for (const i of inq) latest.set(i.subject_national_id, i);
    const subjects = [{ national_id: c.national_id, name: c.legal_name, type: "company" }, ...directors.map((p) => ({ national_id: p.national_id, name: p.name, type: "person" }))];
    const inquiries = subjects.map((x) => {
      const i = latest.get(x.national_id);
      return { subject_type: x.type, national_id: x.national_id, name: x.name, inquiry: i ? { bureau: i.bureau, date: d(i.inquiry_date), result: i.result, sana_registered: i.sana_registered, description: i.description } : null };
    });

    // ---- red flags (§7.6)
    const kyb = (await this.db.query(`select bounced_cheques, risk_flags from kyb_cases where org_id = $1 order by version desc limit 1`, [c.org_id])).rows[0];
    const decl = s.banks_facilities?.declaration ?? {};
    const flags: { code: string; detail?: unknown }[] = [];
    if ((kyb?.bounced_cheques ?? 0) > 0 || decl.returned_cheques === true) flags.push({ code: "returned_cheques", detail: { registry_count: kyb?.bounced_cheques ?? null, declared: decl.returned_cheques === true } });
    if (decl.overdue_debts === true) flags.push({ code: "overdue_debts" });
    for (const x of inquiries) {
      if (x.inquiry?.result === "fail") flags.push({ code: "inquiry_failed", detail: { name: x.name, bureau: x.inquiry.bureau } });
      if (x.inquiry && !x.inquiry.sana_registered) flags.push({ code: "not_in_sana", detail: { name: x.name } });
    }
    if (signatories.length === 1) flags.push({ code: "sole_signatory", detail: { name: signatories[0].name } });
    for (const f of (kyb?.risk_flags ?? []) as string[]) flags.push({ code: `kyb:${f}` });
    const missingInquiries = inquiries.filter((x) => !x.inquiry).map((x) => x.name);

    // ---- figures: verified once locked, otherwise declared; scoring ratios and the analysis sheet
    const fin = (await this.db.query(`select * from case_financials where case_id = $1`, [caseId])).rows;
    // the analysis sheet uses the same three years as scoring (a balance-sheet-only latest year is skipped)
    const years = scoringYears(c.latest_fiscal_year, fin.find((r: any) => r.fiscal_year === c.latest_fiscal_year)?.statement_type);
    const rows = years.map((y) => fin.find((r: any) => r.fiscal_year === y));
    const figures = rows.map((r) => (r?.verified ?? r?.declared) ?? null);
    const complete = figures.every((f) => f && !figureProblems(f).length);
    const statements = complete ? figures.map((f) => statement(toFinancialYear(f))) : null;

    // ---- other parts of the report, pre-filled
    const round = (await this.db.query(`select * from assessment_rounds where case_id = $1 order by round_no desc limit 1`, [caseId])).rows[0];
    const visit = (await this.db.query(`select v.*, u.full_name from case_visits v join users u on u.id = v.visitor_id where v.case_id = $1 and v.state = 'done' order by done_at desc limit 1`, [caseId])).rows[0];
    const analyst = c.assigned_analyst ? (await this.db.query(`select full_name from users where id = $1`, [c.assigned_analyst])).rows[0]?.full_name : null;
    const insurance = (await this.db.query(
      `select f.uploaded_at from case_item_files f join case_items i on i.id = f.item_id where i.case_id = $1 and i.code = '3-4' and f.removed_at is null order by f.version desc limit 1`, [caseId],
    )).rows[0];
    const usages = (await this.db.query(`select source_type, description, amount_rials, active from limit_usages where org_id = $1 order by created_at`, [c.org_id])).rows;
    const g = s.general ?? {};
    return {
      case_no: c.case_no, state: c.state, company: { name: c.legal_name, national_id: c.national_id, legal_form: g.legal_form ?? c.legal_form, establishment_date: g.establishment_date ?? null,
        representative: g.representative ?? null, landline: g.landline ?? null },
      activity_type: round?.activity_type ?? null,
      knowledge_based: s.knowledge_based ?? null,
      technology_field: s.knowledge_based?.field ?? null,
      products: (s.company_products?.products ?? []).map((p: any) => ({ name: p.name, main_customers: p.main_customers })),
      history: s.company_products?.history ?? null,
      staff: { insured: s.workforce?.insured ?? null, full_time: s.workforce?.full_time ?? null, insurance_list_uploaded_at: insurance?.uploaded_at ?? null },
      licences: (s.licences_contracts_assets?.licences ?? []).map((l: any) => ({ description: l.description, issuer: l.issuer, expiry: l.expiry })),
      collateral_offered: s.licences_contracts_assets?.collateral_offer ?? null,
      locations: (s.locations?.rows ?? []).map((r: any) => ({ usage: r.usage, province: r.province, address: r.address, area_m2: r.area_m2, ownership: r.ownership })),
      signatories: signatories.map((p) => ({ name: p.name, national_id: p.national_id })),
      inquiries, missing_inquiries: missingInquiries, red_flags: flags,
      statements: years.map((y, i) => ({ fiscal_year: y, statement_type: rows[i]?.statement_type ?? null, source: rows[i]?.verified ? "verified" : rows[i] ? "declared" : null, figures: figures[i] })),
      ratios: statements ? statements.map(scoringRatios) : null,
      analysis: statements ? financialAnalysis(statements) : null,
      history_with_fund: usages.map((u: any) => ({ source_type: u.source_type, description: u.description, amount: String(u.amount_rials), active: u.active })),
      technical_expert: visit?.full_name ?? null, visit_findings: visit?.findings ?? null, evaluator: analyst,
      latest_round: round ? { round_no: round.round_no, state: round.state, judgement: round.judgement, credit_limit: round.outputs?.creditLimit ?? null } : null,
    };
  }
}
