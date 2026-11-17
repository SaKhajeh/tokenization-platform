/** HTTP endpoints for tickets (plan/07 §6c): every organisation user and every fund staff member. */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { TICKET_CATEGORIES, TICKET_LINKS } from "@tp/domain";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import type { AppRequest } from "./common/context.js";
import { parse, zUuid } from "./common/zod.js";
import { TicketsService } from "./tickets/tickets.service.js";

const zId = z.object({ id: zUuid });
const zBody = z.string().trim().min(1).max(5000);
const zOpen = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(3).max(200),
  body: zBody,
  link_type: z.enum(TICKET_LINKS).nullable().optional(),
  link_id: zUuid.nullable().optional(),
  attachment_doc_ids: z.array(zUuid).max(10).optional(),
}).refine((x) => !x.link_type === !x.link_id, "link_type and link_id go together");
const STAFF = ["analyst", "technical_expert", "fund_manager", "compliance_officer", "finance_officer", "tokenisation_officer", "super_admin"] as const;

@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // ------------------------------------------------------------------ organisation users
  @Get("tickets")
  @OrgRoute()
  mine(@Req() req: AppRequest) {
    return this.tickets.listMine(req);
  }

  @Post("tickets")
  @OrgRoute()
  open(@Req() req: AppRequest, @Body() body: unknown) {
    return this.tickets.open(req, parse(zOpen, body) as any);
  }

  @Get("tickets/:id")
  @OrgRoute()
  get(@Req() req: AppRequest, @Param() p: unknown) {
    return this.tickets.getMine(req, parse(zId, p).id);
  }

  @Post("tickets/:id/messages")
  @HttpCode(200)
  @OrgRoute()
  reply(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.tickets.replyAsApplicant(req, parse(zId, p).id, parse(z.object({ body: zBody, attachment_doc_ids: z.array(zUuid).max(10).optional() }), body));
  }

  @Post("tickets/:id/close")
  @HttpCode(200)
  @OrgRoute()
  close(@Req() req: AppRequest, @Param() p: unknown) {
    return this.tickets.closeAsApplicant(req, parse(zId, p).id);
  }

  // ------------------------------------------------------------------ fund
  @Get("admin/tickets")
  @StaffOnly(...STAFF, "auditor")
  queue(@Req() req: AppRequest, @Query() query: unknown) {
    const f = parse(z.object({ status: z.enum(["waiting_fund", "waiting_applicant", "closed"]).optional(), mine: z.enum(["true", "false"]).optional(), org_id: zUuid.optional() }), query);
    return this.tickets.queue(req, { status: f.status, mine: f.mine === "true", org_id: f.org_id });
  }

  @Post("admin/tickets")
  @StaffOnly(...STAFF)
  openForOrg(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(z.object({ org_id: zUuid, category: z.enum(TICKET_CATEGORIES), subject: z.string().trim().min(3).max(200), body: zBody,
      link_type: z.enum(TICKET_LINKS).nullable().optional(), link_id: zUuid.nullable().optional() }), body);
    return this.tickets.openForOrg(req, b.org_id, b as any);
  }

  @Get("admin/tickets/:id")
  @StaffOnly(...STAFF, "auditor")
  staffGet(@Param() p: unknown) {
    return this.tickets.getForStaff(parse(zId, p).id);
  }

  @Post("admin/tickets/:id/messages")
  @HttpCode(200)
  @StaffOnly(...STAFF)
  staffReply(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.tickets.replyAsFund(req, parse(zId, p).id, parse(z.object({ body: zBody }), body).body);
  }

  @Post("admin/tickets/:id/assign")
  @HttpCode(200)
  @StaffOnly(...STAFF)
  assign(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.tickets.assign(req, parse(zId, p).id, parse(z.object({ user_id: zUuid }), body).user_id);
  }

  @Post("admin/tickets/:id/close")
  @HttpCode(200)
  @StaffOnly(...STAFF)
  staffClose(@Req() req: AppRequest, @Param() p: unknown) {
    return this.tickets.closeAsFund(req, parse(zId, p).id);
  }
}
