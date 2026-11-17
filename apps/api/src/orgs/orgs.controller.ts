import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { OrgsService } from "./orgs.service.js";
import { OrgRoute, Req } from "../common/guards.js";
import { StepUp } from "../common/stepup.js";
import { Idempotent } from "../common/idempotency.js";
import type { AppRequest } from "../common/context.js";
import { parse, zUuid } from "../common/zod.js";

const zRole = z.enum(["org_admin", "preparer", "approver", "viewer"]);

@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post("orgs")
  @Idempotent()
  create(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(
      z.object({
        legal_name: z.string().trim().min(3).max(200),
        national_id: z.string().min(11).max(11),
        legal_form: z.string().max(60).optional(),
        registration_no: z.string().max(30).optional(),
      }),
      body,
    );
    return this.orgs.create(req, b);
  }

  @Get("orgs/current")
  @OrgRoute()
  current(@Req() req: AppRequest) {
    return this.orgs.current(req);
  }

  @Patch("orgs/current")
  @OrgRoute("org_admin")
  @StepUp()
  update(@Req() req: AppRequest, @Body() body: unknown) {
    return this.orgs.updateSettings(req, parse(z.object({ single_user_mode: z.boolean() }), body));
  }

  @Get("orgs/current/members")
  @OrgRoute()
  members(@Req() req: AppRequest) {
    return this.orgs.members(req);
  }

  @Patch("orgs/current/members/:id")
  @OrgRoute("org_admin")
  @StepUp()
  updateMember(@Req() req: AppRequest, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(
      z.object({ role: zRole.optional(), status: z.enum(["active", "suspended", "removed"]).optional() }).refine((x) => x.role || x.status, "role or status required"),
      body,
    );
    return this.orgs.updateMember(req, parse(zUuid, id), b);
  }

  @Get("orgs/current/invitations")
  @OrgRoute("org_admin")
  invitations(@Req() req: AppRequest) {
    return this.orgs.listInvitations(req);
  }

  @Post("orgs/current/invitations")
  @OrgRoute("org_admin")
  @StepUp()
  @Idempotent()
  invite(@Req() req: AppRequest, @Body() body: unknown) {
    return this.orgs.invite(req, parse(z.object({ destination: z.string().min(5).max(254), role: zRole }), body));
  }

  @Delete("orgs/current/invitations/:id")
  @OrgRoute("org_admin")
  @HttpCode(204)
  async revoke(@Req() req: AppRequest, @Param("id") id: string) {
    await this.orgs.revokeInvitation(req, parse(zUuid, id));
  }

  @Post("invitations/accept")
  @HttpCode(200)
  accept(@Req() req: AppRequest, @Body() body: unknown) {
    return this.orgs.accept(req, parse(z.object({ token: z.string().min(20).max(100) }), body).token);
  }
}
