/** HTTP endpoints for the credit case (plan/07 §2–§6). One case per organisation: the applicant side uses /case. */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { COMMENT_TARGETS, FINANCIAL_FIELDS, FORM_SECTIONS, NOTE_RECIPIENT_ROLES, REVIEW_REASONS, STATEMENT_TYPES } from "@tp/domain";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import { StepUp } from "./common/stepup.js";
import { Idempotent } from "./common/idempotency.js";
import type { AppRequest } from "./common/context.js";
import { parse, zUuid } from "./common/zod.js";
import { CasesService } from "./cases/cases.service.js";
import { CommentsService } from "./cases/comments.service.js";

const zId = z.object({ id: zUuid });
const zItem = z.object({ itemId: zUuid });
const zText = (min: number, max: number) => z.string().trim().min(min).max(max);
const zYear = z.coerce.number().int().min(1380).max(1500);
// Form sections are free-form JSON (validated for completeness by the domain rules), capped in size.
const zSectionData = z.record(z.unknown()).refine((d) => JSON.stringify(d).length <= 200_000, "section too large");

@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService, private readonly comments: CommentsService) {}

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
    const b = parse(z.object({ document_id: zUuid, link_url: z.string().url().max(500).nullable().optional() }), body);
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

  /** «یادداشت‌های داخلی برای شما». */
  @Get("admin/notes")
  @StaffOnly("analyst", "technical_expert", "fund_manager", "compliance_officer", "super_admin")
  notes(@Req() req: AppRequest) {
    return this.comments.myNotes(req);
  }

  /** §6a: open a case file in the viewer, or download it — both logged. */
  @Get("admin/cases/:id/files/:fileId/:action")
  @StaffOnly("analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor")
  openFile(@Req() req: AppRequest, @Param() p: unknown) {
    const { id, fileId, action } = parse(z.object({ id: zUuid, fileId: zUuid, action: z.enum(["view", "download"]) }), p);
    return this.cases.openFile(req, id, fileId, action);
  }

  @Get("admin/cases")
  @StaffOnly("analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin")
  list(@Query() query: unknown) {
    return this.cases.list(parse(z.object({ state: z.string().max(40).optional() }), query).state);
  }

  @Get("admin/cases/:id")
  @StaffOnly("analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin")
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
}

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
