/** HTTP endpoints for the credit case (plan/07 §2–§6). One case per organisation: the applicant side uses /case. */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { ACTIVITY_TYPES, COMMENT_TARGETS, FINANCIAL_FIELDS, FORM_SECTIONS, NOTE_RECIPIENT_ROLES, REVIEW_REASONS, STATEMENT_TYPES, NO_TAX_RETURN_REASONS } from "@tp/domain";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import { StepUp } from "./common/stepup.js";
import { Idempotent } from "./common/idempotency.js";
import type { AppRequest } from "./common/context.js";
import { parse, zUuid } from "./common/zod.js";
import { FundToolsService } from "./cases/fund-tools.service.js";
import { CasesService } from "./cases/cases.service.js";
import { CommentsService } from "./cases/comments.service.js";
import { LimitsService } from "./cases/limits.service.js";
import { ReportService } from "./cases/report.service.js";
import { zIsoDate } from "./common/zod.js";

const zId = z.object({ id: zUuid });
const zItem = z.object({ itemId: zUuid });
const zText = (min: number, max: number) => z.string().trim().min(min).max(max);
const zYear = z.coerce.number().int().min(1380).max(1500);
// Form sections are free-form JSON (validated for completeness by the domain rules), capped in size.
const zSectionData = z.record(z.unknown()).refine((d) => JSON.stringify(d).length <= 200_000, "section too large");

@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService, private readonly comments: CommentsService, private readonly limits: LimitsService, private readonly report: ReportService, private readonly tools: FundToolsService) {}

  // ------------------------------------------------------------------ applicant

  /** A-05b: invest and/or get financing. Financing opens the credit case once KYB is submitted. */
  @Put("org/purposes")
  @OrgRoute("org_admin")
  purposes(@Req() req: AppRequest, @Body() body: unknown) {
    return this.cases.setPurposes(req, parse(z.object({ invest: z.boolean(), financing: z.boolean() }), body));
  }

  @Get("case")
  @OrgRoute()
  mine(@Req() req: AppRequest) {
    return this.cases.mine(req);
  }

  @Put("case/sections/:section")
  @OrgRoute("org_admin", "preparer")
  saveSection(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const { section } = parse(z.object({ section: z.enum(FORM_SECTIONS) }), p);
    return this.cases.saveSection(req, section, parse(z.object({ data: zSectionData }), body).data as Record<string, any>);
  }

  @Put("case/fiscal-year")
  @OrgRoute("org_admin", "preparer")
  fiscalYear(@Req() req: AppRequest, @Body() body: unknown) {
    return this.cases.setFiscalYear(req, parse(z.object({ latest_fiscal_year: zYear }), body).latest_fiscal_year);
  }

  @Put("case/financials/:year")
  @OrgRoute("org_admin", "preparer")
  financials(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const { year } = parse(z.object({ year: zYear }), p);
    const b = parse(z.object({ statement_type: z.enum(STATEMENT_TYPES), figures: z.record(z.enum(FINANCIAL_FIELDS), z.string()) }), body);
    return this.cases.saveFinancials(req, year, b as any);
  }

  @Put("case/letter")
  @OrgRoute("org_admin", "preparer")
  letter(@Req() req: AppRequest, @Body() body: unknown) {
    return this.cases.saveLetter(req, parse(z.object({ text: zText(20, 5000) }), body).text);
  }

  @Post("case/letter/sign")
  @HttpCode(200)
  @OrgRoute("org_admin", "approver")
  @StepUp()
  signLetter(@Req() req: AppRequest) {
    return this.cases.signLetter(req);
  }

  @Post("case/items/:itemId/files")
  @OrgRoute("org_admin", "preparer")
  @Idempotent()
  addFile(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({ document_id: zUuid, link_url: z.string().url().max(500).nullable().optional(), alt_reason: z.enum(NO_TAX_RETURN_REASONS).nullable().optional() }), body);
    return this.cases.addFile(req, parse(zItem, p).itemId, b);
  }

  @Delete("case/items/:itemId/files/:fileId")
  @OrgRoute("org_admin", "preparer")
  removeFile(@Req() req: AppRequest, @Param() p: unknown) {
    const { itemId, fileId } = parse(z.object({ itemId: zUuid, fileId: zUuid }), p);
    return this.cases.removeFile(req, itemId, fileId);
  }

  /** «ندارم» for optional items. */
  @Post("case/items/:itemId/not-available")
  @HttpCode(200)
  @OrgRoute("org_admin", "preparer")
  notAvailable(@Req() req: AppRequest, @Param() p: unknown) {
    return this.cases.notAvailable(req, parse(zItem, p).itemId);
  }

  /** Submit or resubmit; the step-up also signs the CEO's commitment (تعهدنامه). */
  @Post("case/submit")
  @HttpCode(200)
  @OrgRoute("org_admin", "approver")
  @StepUp()
  @Idempotent()
  submit(@Req() req: AppRequest, @Body() body: unknown) {
    parse(z.object({ commitment_accepted: z.literal(true) }), body);
    return this.cases.submit(req);
  }

  @Post("case/withdraw")
  @HttpCode(200)
  @OrgRoute("org_admin")
  @StepUp()
  withdraw(@Req() req: AppRequest, @Body() body: unknown) {
    return this.cases.withdraw(req, parse(z.object({ reason: zText(3, 1000) }), body).reason);
  }

  /** The applicant replies in a thread (an item, a form section, a figure, or the case). */
  @Post("case/comments")
  @OrgRoute("org_admin", "preparer", "approver")
  reply(@Req() req: AppRequest, @Body() body: unknown) {
    return this.comments.applicantReply(req, parse(zComment, body));
  }

  /** D-C13: issue (or return) the assessment-fee invoice; it is paid through /invoices/:id/pay. */
  @Post("case/fee")
  @HttpCode(200)
  @OrgRoute("org_admin", "preparer", "approver")
  fee(@Req() req: AppRequest) {
    return this.limits.feeInvoice(req);
  }

  @Get("case/visit")
  @OrgRoute()
  visit(@Req() req: AppRequest) {
    return this.limits.myVisit(req);
  }

  @Post("case/visit/confirm")
  @HttpCode(200)
  @OrgRoute("org_admin", "preparer", "approver")
  confirmVisit(@Req() req: AppRequest) {
    return this.limits.confirmVisit(req);
  }

  @Post("case/visit/change-request")
  @HttpCode(200)
  @OrgRoute("org_admin", "preparer", "approver")
  changeVisit(@Req() req: AppRequest, @Body() body: unknown) {
    return this.limits.requestOtherDate(req, parse(z.object({ message: zText(3, 2000) }), body).message);
  }

  /** A-74: credit limit, validity, usage and the fund's note. */
  @Get("case/limit")
  @OrgRoute()
  myLimit(@Req() req: AppRequest) {
    return this.limits.myLimit(req);
  }

  // ------------------------------------------------------------------ fund: configuration

  @Get("admin/tariffs")
  @StaffOnly("fund_manager", "analyst", "finance_officer", "auditor", "super_admin")
  tariffs() {
    return this.limits.tariff();
  }

  @Put("admin/tariffs")
  @StaffOnly("fund_manager")
  @StepUp()
  setTariff(@Req() req: AppRequest, @Body() body: unknown) {
    const rial = z.string().regex(/^(0|[1-9]\d{0,17})$/);
    const bps = z.number().int().min(0).max(10000);
    return this.limits.setTariff(req, parse(z.object({
      effective_from: zIsoDate, assessment_fee_tehran: rial, assessment_fee_outside: rial, application_fee: rial,
      servicing_fee_bps: bps, investor_fee_bps: bps, platform_share_bps: bps, note: z.string().max(1000).nullable().optional(),
    }), body));
  }

  @Get("admin/scoring-method")
  @StaffOnly("compliance_officer", "ceo", "fund_manager", "analyst", "auditor", "super_admin")
  method() {
    return this.limits.method();
  }

  @Put("admin/scoring-method")
  @StaffOnly("fund_manager")
  @StepUp()
  setMethod(@Req() req: AppRequest, @Body() body: unknown) {
    const unit = z.number().min(0).max(1);
    const bands = z.tuple([z.number(), z.number(), z.number(), z.number()]);
    const b = parse(z.object({
      beta: z.record(z.enum(ACTIVITY_TYPES), z.object({ guarantee: z.number().min(0).max(100), facility: z.number().min(0).max(100) })),
      matrix: z.array(z.array(unit).length(5)).length(5),
      growthBands: bands, marginBands: bands, c1Bands: bands, c2Bands: bands,
      collateral: z.object({ cheque: z.number().positive().max(2), mortgage_2: z.number().positive().max(2), mortgage_1: z.number().positive().max(2) }),
      marginWeights: z.array(unit).min(3).max(4), // 3 periods (workbook, v1) or 4 (since v2)
      crl: z.object({ a: z.number(), b: z.number() }),
      taxRate: unit,
      limitCollateral: z.enum(["cheque", "mortgage_2", "mortgage_1"]),
      note: z.string().max(1000).optional(),
    }).strict(), body);
    return this.limits.setMethod(req, b as any);
  }

  // ------------------------------------------------------------------ fund

  /** Message to the applicant, or an internal note with recipients (roles or named staff). */
  @Post("admin/cases/:id/comments")
  @StaffOnly("analyst", "technical_expert", "fund_manager", "compliance_officer")
  comment(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(zComment.extend({
      type: z.enum(["to_applicant", "internal"]),
      recipients: z.array(z.union([z.object({ role: z.enum(NOTE_RECIPIENT_ROLES) }), z.object({ userId: zUuid })])).max(10).optional(),
    }), body);
    return this.comments.staffComment(req, parse(zId, p).id, b as any);
  }

  // ------------------------------------------------------------------ fund feedback 2026-11-25 (master plan §6 item 25)

  /** Templates the fund offers for checklist items (e.g. the lease agreement), with download links. */
  @Get("case/templates")
  @OrgRoute()
  caseTemplates() {
    return this.tools.templates();
  }

  @Get("admin/checklist-templates")
  @StaffOnly("ceo", "analyst", "fund_manager", "compliance_officer", "super_admin")
  adminTemplates() {
    return this.tools.templates();
  }

  @Post("admin/checklist-templates/:code/upload-url")
  @StaffOnly("fund_manager", "credit_manager", "super_admin")
  templateUpload(@Req() req: AppRequest, @Param("code") code: string, @Body() body: unknown) {
    const b = parse(z.object({ filename: z.string().min(1).max(200), mime: z.string().max(120), size: z.number().int().positive().max(20 * 1024 * 1024) }), body);
    return this.tools.templateUpload(req, parse(z.string().regex(/^\d-\d$/), code), b);
  }

  @Post("admin/checklist-templates/:code/complete")
  @StaffOnly("fund_manager", "credit_manager", "super_admin")
  @HttpCode(200)
  templateComplete(@Req() req: AppRequest, @Param("code") code: string, @Body() body: unknown) {
    const b = parse(z.object({ document_id: zUuid, sha256: z.string().regex(/^[0-9a-f]{64}$/) }), body);
    return this.tools.templateComplete(req, parse(z.string().regex(/^\d-\d$/), code), b.document_id, b.sha256);
  }

  /** Compliance officer: sends the credit-approved result to the CEO with a comment (fund rules 2026-11-26). */
  @Post("admin/cases/:id/to-ceo")
  @StaffOnly("compliance_officer")
  @HttpCode(200)
  toCeo(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.limits.toCeo(req, parse(zId, p).id, parse(z.object({ comment: zText(5, 3000) }), body).comment);
  }

  /** CEO: confirms the committee meeting was held, may edit the ceilings, accepts or declines with a comment. */
  @Post("admin/cases/:id/ceo-decision")
  @StaffOnly("ceo")
  @StepUp()
  @HttpCode(200)
  ceoDecision(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const rials = z.string().regex(/^\d{1,18}$/);
    const set = z.object({ cheque: rials.optional(), mortgage_2: rials.optional(), mortgage_1: rials.optional() }).strict();
    const b = parse(z.object({
      meeting_held: z.literal(true), meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), decision: z.enum(["accept", "decline"]), comment: zText(5, 3000),
      overrides: z.object({ guarantee: set.optional(), facility: set.optional() }).nullable().optional(),
    }), body);
    return this.limits.ceoDecision(req, parse(zId, p).id, b);
  }

  /** Compliance officer: releases the result to the company with an explanation of the numbers; issues the limit. */
  @Post("admin/cases/:id/release")
  @StaffOnly("compliance_officer")
  @HttpCode(200)
  releaseResult(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.limits.release(req, parse(zId, p).id, parse(z.object({ note_to_applicant: zText(5, 3000) }), body).note_to_applicant);
  }

  /** مدیر اعتبارات divides cases between analysts. */
  @Post("admin/cases/:id/assign")
  @StaffOnly("credit_manager")
  @HttpCode(200)
  assign(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.tools.assign(req, parse(zId, p).id, parse(z.object({ analyst_id: zUuid }), body).analyst_id);
  }

  @Get("admin/orgs/:id/fee-exemptions")
  @StaffOnly("fund_manager", "credit_manager", "finance_officer", "analyst", "auditor")
  exemptions(@Param() p: unknown) {
    return this.tools.exemptions(parse(zId, p).id);
  }

  /** The fund manager exempts a company from a fee in advance (e.g. a free assessment). */
  @Post("admin/orgs/:id/fee-exemptions")
  @StaffOnly("fund_manager")
  @StepUp()
  grantExemption(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({ charge_point: z.enum(["case_submission", "after_screening"]), reason: zText(5, 500) }), body);
    return this.tools.grantExemption(req, parse(zId, p).id, b);
  }

  @Delete("admin/orgs/:id/fee-exemptions/:exemptionId")
  @StaffOnly("fund_manager")
  revokeExemption(@Req() req: AppRequest, @Param() p: unknown) {
    const x = parse(z.object({ id: zUuid, exemptionId: zUuid }), p);
    return this.tools.revokeExemption(req, x.id, x.exemptionId);
  }

  /** The fund manager raises or lowers an issued limit through Rc/Ra/Re and the collateral class. */
  @Post("admin/orgs/:id/credit-limit/adjust")
  @StaffOnly("fund_manager")
  @StepUp()
  adjustLimit(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({ rc: zCoef.optional(), ra: zCoefPositive.optional(), re: zCoefPositive.optional(),
      collateral: z.enum(["cheque", "mortgage_2", "mortgage_1"]).optional(), reason: zText(5, 1000) }), body);
    return this.tools.adjustLimit(req, parse(zId, p).id, b);
  }

  /** Staff directory for pickers (visit visitor, note recipients): active staff with a role, optionally one role. */
  @Get("admin/staff")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "finance_officer", "super_admin")
  staffList(@Query() query: unknown) {
    return this.comments.staffDirectory(parse(z.object({ role: z.string().max(40).optional() }), query).role);
  }
  /** «یادداشت‌های داخلی برای شما». */
  @Get("admin/notes")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "super_admin")
  notes(@Req() req: AppRequest) {
    return this.comments.myNotes(req);
  }

  /** §6a: open a case file in the viewer, or download it — both logged. */
  @Get("admin/cases/:id/files/:fileId/:action")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor")
  openFile(@Req() req: AppRequest, @Param() p: unknown) {
    const { id, fileId, action } = parse(z.object({ id: zUuid, fileId: zUuid, action: z.enum(["view", "download"]) }), p);
    return this.cases.openFile(req, id, fileId, action);
  }

  @Get("admin/cases")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin")
  list(@Query() query: unknown) {
    return this.cases.list(parse(z.object({ state: z.string().max(40).optional() }), query).state);
  }

  @Get("admin/cases/:id")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin")
  get(@Param() p: unknown) {
    return this.cases.get(parse(zId, p).id);
  }

  @Post("admin/cases/:id/start-review")
  @HttpCode(200)
  @StaffOnly("analyst")
  startReview(@Req() req: AppRequest, @Param() p: unknown) {
    return this.cases.startReview(req, parse(zId, p).id);
  }

  @Post("admin/cases/:id/items/:itemId/review")
  @HttpCode(200)
  @StaffOnly("analyst")
  reviewItem(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const { id, itemId } = parse(z.object({ id: zUuid, itemId: zUuid }), p);
    return this.cases.review(req, id, { type: "item", id: itemId }, parse(zReview, body));
  }

  @Post("admin/cases/:id/sections/:section/review")
  @HttpCode(200)
  @StaffOnly("analyst")
  reviewSection(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const { id, section } = parse(z.object({ id: zUuid, section: z.enum(FORM_SECTIONS) }), p);
    return this.cases.review(req, id, { type: "section", id: section }, parse(zReview, body));
  }

  @Post("admin/cases/:id/requests")
  @StaffOnly("analyst")
  request(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.cases.requestDocument(req, parse(zId, p).id, parse(z.object({ title: zText(3, 200), message: zText(3, 2000) }), body));
  }

  @Post("admin/cases/:id/return")
  @HttpCode(200)
  @StaffOnly("analyst")
  returnCase(@Req() req: AppRequest, @Param() p: unknown) {
    return this.cases.returnCase(req, parse(zId, p).id);
  }

  @Post("admin/cases/:id/documents-complete")
  @HttpCode(200)
  @StaffOnly("analyst")
  complete(@Req() req: AppRequest, @Param() p: unknown) {
    return this.cases.documentsComplete(req, parse(zId, p).id);
  }

  @Put("admin/cases/:id/financials/:year/:field")
  @StaffOnly("analyst")
  verify(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const { id, year, field } = parse(z.object({ id: zUuid, year: zYear, field: z.enum(FINANCIAL_FIELDS) }), p);
    const b = parse(z.object({ value: z.string().regex(/^-?(0|[1-9]\d{0,14})$/, "whole million rials"), reason: zText(3, 1000) }), body);
    return this.cases.verifyCell(req, id, year, field, b);
  }

  @Post("admin/cases/:id/financials/lock")
  @HttpCode(200)
  @StaffOnly("analyst")
  lock(@Req() req: AppRequest, @Param() p: unknown) {
    return this.cases.lockFinancials(req, parse(zId, p).id);
  }

  // ------------------------------------------------------------------ fund: visit, scoring, approval, limit

  /** §7.6: credit-bureau / Sana inquiry for the company or a director. */
  @Post("admin/cases/:id/inquiries")
  @StaffOnly("analyst")
  inquiry(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({
      subject_type: z.enum(["company", "person"]), subject_national_id: z.string().regex(/^\d{10,11}$/), bureau: zText(2, 200), inquiry_date: zIsoDate,
      result: z.enum(["pass", "fail"]), sana_registered: z.boolean(), description: z.string().max(3000).nullable().optional(), document_id: zUuid.nullable().optional(),
    }), body);
    return this.report.addInquiry(req, parse(zId, p).id, b);
  }

  /** The fund's report (S-18/S-19): pre-filled from the case, with inquiries, red flags, ratios and the analysis sheet. */
  @Get("admin/cases/:id/report")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin")
  caseReport(@Param() p: unknown) {
    return this.report.report(parse(zId, p).id);
  }

  @Get("admin/cases/:id/visit")
  @StaffOnly("ceo", "analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin")
  staffVisit(@Param() p: unknown) {
    return this.limits.staffVisit(parse(zId, p).id);
  }
  @Post("admin/cases/:id/visit")
  @StaffOnly("analyst")
  proposeVisit(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.limits.proposeVisit(req, parse(zId, p).id, parse(z.object({ visit_date: zIsoDate, visit_time: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/), visitor_id: zUuid }), body));
  }

  @Post("admin/cases/:id/visit/report")
  @HttpCode(200)
  @StaffOnly("analyst", "technical_expert")
  reportVisit(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.limits.reportVisit(req, parse(zId, p).id, parse(z.object({ findings: zText(10, 10000), photo_doc_ids: z.array(zUuid).max(30).optional() }), body));
  }

  @Post("admin/cases/:id/items/:itemId/original-received")
  @HttpCode(200)
  @StaffOnly("analyst", "technical_expert")
  original(@Req() req: AppRequest, @Param() p: unknown) {
    const { id, itemId } = parse(z.object({ id: zUuid, itemId: zUuid }), p);
    return this.limits.originalReceived(req, id, itemId);
  }

  /** S-19: run the method with Rc, Ra, Re and a reason for each (D-C4). */
  @Post("admin/cases/:id/scoring")
  @HttpCode(200)
  @StaffOnly("analyst")
  score(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({
      activity_type: z.enum(ACTIVITY_TYPES), guarantee: zJ,
      reasons: z.object({ rc: zText(5, 2000), ra: zText(5, 2000), re: zText(5, 2000) }),
      facility: zJ.nullable().optional(),
      trial_balance_check: z.object({ confirmed: z.boolean(), note: zText(5, 2000) }).nullable().optional(),
    }), body);
    return this.limits.score(req, parse(zId, p).id, b);
  }

  @Post("admin/cases/:id/scoring/submit")
  @HttpCode(200)
  @StaffOnly("analyst")
  sendForApproval(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.limits.sendForApproval(req, parse(zId, p).id, parse(z.object({ summary: zText(10, 5000) }), body).summary);
  }

  @Get("admin/cases/:id/rounds")
  @StaffOnly("compliance_officer", "ceo", "analyst", "fund_manager", "auditor", "super_admin")
  rounds(@Param() p: unknown) {
    return this.limits.rounds(parse(zId, p).id);
  }

  @Post("admin/cases/:id/decision")
  @HttpCode(200)
  @StaffOnly("fund_manager", "credit_manager") // the credit manager may approve limits too (fund feedback 2026-11-25); never the preparer
  @StepUp()
  decide(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({
      decision: z.enum(["approve", "send_back", "decline"]), reason: z.string().trim().max(3000).optional(), note_to_applicant: z.string().trim().max(3000).optional(),
    }).refine((x) => x.decision === "approve" || (x.reason && x.reason.length >= 5), "a reason is required to send back or decline"), body);
    return this.limits.decide(req, parse(zId, p).id, b);
  }

  @Get("admin/orgs/:id/credit-limit")
  @StaffOnly("compliance_officer", "ceo", "analyst", "fund_manager", "finance_officer", "auditor", "super_admin")
  staffLimit(@Param() p: unknown) {
    return this.limits.staffLimit(parse(zId, p).id);
  }

  @Post("admin/orgs/:id/limit-usages")
  @StaffOnly("analyst")
  addUsage(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({
      source_type: z.enum(["existing_guarantee", "existing_facility"]), description: zText(3, 500),
      amount: z.string().regex(/^[1-9]\d{0,17}$/), ra: zCoefPositive, re: zCoefPositive,
    }), body);
    return this.limits.addUsage(req, parse(zId, p).id, b);
  }

  /** S-11: limit check for an application in credit assessment (the project's Ra and Re, with a reason). */
  @Post("admin/applications/:id/limit-check")
  @HttpCode(200)
  @StaffOnly("analyst")
  limitCheck(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({ ra: zCoefPositive, re: zCoefPositive, reason: zText(5, 2000) }), body);
    return this.limits.checkApplication(req, parse(zId, p).id, b);
  }

  @Post("admin/limit-usages/:id/release")
  @HttpCode(200)
  @StaffOnly("analyst", "fund_manager")
  release(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.limits.releaseUsage(req, parse(zId, p).id, parse(z.object({ reason: zText(3, 500) }), body).reason);
  }
}

/**
 * Rc, Ra and Re: 0..1 with at most three decimals. The database keeps them as numeric(4,3); a finer value was
 * rounded there while the limit had been computed with the unrounded one (and a value below 0.0005 became 0,
 * which the usage tables reject with a server error).
 */
const threeDecimals = (x: number) => Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-9;
const zCoef = z.number().min(0).max(1).refine(threeDecimals, "at most three decimals");
const zCoefPositive = z.number().gt(0).max(1).refine(threeDecimals, "at most three decimals");
const zJ = z.object({ rc: zCoef, ra: zCoef, re: zCoef });

const zComment = z.object({
  target_type: z.enum(COMMENT_TARGETS),
  target_id: z.string().min(1).max(80),
  body: z.string().trim().min(1).max(5000),
  file_version: z.number().int().positive().nullable().optional(),
});

const zReview = z.object({
  decision: z.enum(["accept", "needs_fix", "reject"]),
  reason_code: z.enum(REVIEW_REASONS).optional(),
  message: z.string().trim().max(3000).optional(),
});
