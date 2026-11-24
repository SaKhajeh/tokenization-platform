import { OrgsService } from "./orgs/orgs.service.js";
/** HTTP endpoints for milestone M-C (part 1): applicant onboarding, initiatives + applications, notifications, jobs. */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { TicketsService } from "./tickets/tickets.service.js";
import { LimitsService } from "./cases/limits.service.js";
import { z } from "zod";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import { StepUp } from "./common/stepup.js";
import { Idempotent } from "./common/idempotency.js";
import type { AppRequest } from "./common/context.js";
import { parse, zIsoDate, zUuid } from "./common/zod.js";
import { ApplicationsService, INVESTMENT_TYPES } from "./applications/applications.service.js";
import { NotificationsService } from "./notifications/notifications.service.js";
import { KybService } from "./kyb/kyb.service.js";

const zId = z.object({ id: zUuid });
const zOrgId = z.object({ org_id: zUuid });
const zRial = z.string().regex(/^[1-9]\d{0,17}$/, "amount in rials, digits only");
const zRate = z.string().regex(/^0\.\d{1,6}$/, "rate as a decimal: annual (0.235) or monthly (0.056) per proposed_rate_basis");
const zText = (min: number, max: number) => z.string().trim().min(min).max(max);

const zInitiative = z.object({
  title: zText(3, 200),
  description: zText(20, 5000),
  sector: zText(2, 100),
  location: zText(2, 200),
  started_on: zIsoDate,
  progress_summary: zText(10, 3000),
  evidence_doc_ids: z.array(zUuid).max(30),
});

const zApplicationFields = {
  investment_type: z.enum(INVESTMENT_TYPES),
  requested_amount: zRial,
  min_amount: zRial.nullable().optional(),
  proposed_rate: zRate,
  proposed_rate_basis: z.enum(["annual", "monthly"]).optional(),
  proposed_duration_days: z.number().int().min(30).max(3650),
  proposed_rule: z.enum(["all_or_nothing", "keep_raised"]),
  use_of_funds: zText(10, 3000),
  repayment_source: zText(10, 3000),
  proposed_guarantees: z.array(z.object({ type: zText(2, 60), description: zText(3, 500), amount: zRial.optional() })).max(10),
  document_ids: z.array(zUuid).max(30),
};

// ------------------------------------------------------------------ applicant onboarding (D14: companies apply; the fund issues)

@Controller()
export class ApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  @Get("initiatives")
  @OrgRoute()
  initiatives(@Req() req: AppRequest) {
    return this.apps.listInitiatives(req);
  }

  @Post("initiatives")
  @OrgRoute("org_admin", "preparer")
  @Idempotent()
  createInitiative(@Req() req: AppRequest, @Body() body: unknown) {
    return this.apps.createInitiative(req, parse(zInitiative, body));
  }

  @Patch("initiatives/:id")
  @OrgRoute("org_admin", "preparer")
  updateInitiative(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.apps.updateInitiative(req, parse(zId, p).id, parse(zInitiative.partial(), body));
  }

  @Get("applications")
  @OrgRoute()
  list(@Req() req: AppRequest) {
    return this.apps.list(req);
  }

  @Get("applications/:id")
  @OrgRoute()
  get(@Req() req: AppRequest, @Param() p: unknown) {
    return this.apps.get(req, parse(zId, p).id);
  }

  @Post("applications")
  @OrgRoute("org_admin", "preparer")
  @Idempotent()
  create(@Req() req: AppRequest, @Body() body: unknown) {
    return this.apps.create(req, parse(z.object({ initiative_id: zUuid, ...zApplicationFields }), body));
  }

  @Patch("applications/:id")
  @OrgRoute("org_admin", "preparer")
  update(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.apps.update(req, parse(zId, p).id, parse(z.object(zApplicationFields).partial(), body));
  }

  @Post("applications/:id/request-approval")
  @HttpCode(200)
  @OrgRoute("org_admin", "preparer")
  requestApproval(@Req() req: AppRequest, @Param() p: unknown) {
    return this.apps.requestApproval(req, parse(zId, p).id);
  }

  @Post("applications/:id/submit")
  @HttpCode(200)
  @OrgRoute("org_admin", "approver")
  @StepUp()
  @Idempotent()
  submit(@Req() req: AppRequest, @Param() p: unknown) {
    return this.apps.submit(req, parse(zId, p).id);
  }

  @Post("applications/:id/withdraw")
  @HttpCode(200)
  @OrgRoute("org_admin", "approver")
  withdraw(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.apps.withdraw(req, parse(zId, p).id, parse(z.object({ reason: zText(3, 1000) }), body).reason);
  }

  @Get("admin/applications")
  @StaffOnly("analyst", "fund_manager", "compliance_officer", "auditor", "super_admin")
  adminList(@Query() query: unknown) {
    return this.apps.adminList(parse(z.object({ status: z.string().max(40).optional() }), query).status);
  }

  @Get("admin/applications/:id")
  @StaffOnly("analyst", "fund_manager", "compliance_officer", "auditor", "super_admin")
  adminGet(@Param() p: unknown) {
    return this.apps.adminGet(parse(zId, p).id);
  }

  @Post("admin/applications/:id/start-screening")
  @HttpCode(200)
  @StaffOnly("analyst")
  start(@Req() req: AppRequest, @Param() p: unknown) {
    return this.apps.startScreening(req, parse(zId, p).id);
  }

  @Post("admin/applications/:id/screening")
  @HttpCode(200)
  @StaffOnly("analyst")
  screen(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(
      z.object({
        checklist: z.array(z.object({ item: zText(2, 200), ok: z.boolean(), note: z.string().max(500).optional() })).min(1).max(50),
        outcome: z.enum(["pass", "return", "reject"]),
        comment: z.string().trim().max(3000).optional(),
        return_items: z.array(z.object({ title: zText(3, 200), description: z.string().max(1000).optional() })).max(30).optional(),
      }),
      body,
    );
    return this.apps.screen(req, parse(zId, p).id, b);
  }
}

// ------------------------------------------------------------------ notifications

@Controller()
export class NotificationsController {
  constructor(private readonly n: NotificationsService) {}

  @Get("notifications")
  list(@Req() req: AppRequest, @Query() query: unknown) {
    const f = parse(z.object({ unread: z.enum(["true", "false"]).optional() }), query);
    return this.n.list(req.user!.id, f.unread === "true");
  }

  @Post("notifications/read-all")
  @HttpCode(200)
  readAll(@Req() req: AppRequest) {
    return this.n.markAllRead(req.user!.id);
  }

  @Post("notifications/:id/read")
  @HttpCode(200)
  read(@Req() req: AppRequest, @Param() p: unknown) {
    return this.n.markRead(req.user!.id, parse(zId, p).id);
  }
}

// ------------------------------------------------------------------ manual job runs (ops / tests)

@Controller()
export class JobsController {
  constructor(private readonly kyb: KybService, private readonly apps: ApplicationsService, private readonly n: NotificationsService, private readonly tickets: TicketsService, private readonly limits: LimitsService, private readonly orgs: OrgsService) {}

  @Post("admin/jobs/:name/run")
  @HttpCode(200)
  @StaffOnly("super_admin")
  run(@Param() p: unknown) {
    const { name } = parse(z.object({ name: z.enum(["kyb-expiry", "application-expiry", "sms", "ticket-escalation", "visit-reminders", "case-housekeeping", "invitations"]) }), p);
    if (name === "kyb-expiry") return this.kyb.runExpiry();
    if (name === "application-expiry") return this.apps.expireInactive();
    if (name === "ticket-escalation") return this.tickets.escalateOverdue();
    if (name === "visit-reminders") return this.limits.remindVisits();
    if (name === "case-housekeeping") return this.limits.housekeeping();
    if (name === "invitations") return this.orgs.deliverQueuedInvitations();
    return this.n.sendQueuedSms();
  }
}
