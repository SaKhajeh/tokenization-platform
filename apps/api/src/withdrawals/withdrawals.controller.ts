/** Withdrawal endpoints (PRD FR-WDR). Money-moving steps need step-up; staff steps are split between people. */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { OrgRoute, Req, StaffOnly } from "../common/guards.js";
import { StepUp } from "../common/stepup.js";
import { Idempotent } from "../common/idempotency.js";
import type { AppRequest } from "../common/context.js";
import { parse, zUuid } from "../common/zod.js";
import { WithdrawalsService } from "./withdrawals.service.js";

const zId = z.object({ id: zUuid });
const zReason = z.object({ reason: z.string().trim().min(3).max(1000) });

@Controller()
export class WithdrawalsController {
  constructor(private readonly w: WithdrawalsService) {}

  @Get("withdrawals")
  @OrgRoute()
  list(@Req() req: AppRequest) {
    return this.w.list(req);
  }

  @Get("withdrawals/:id")
  @OrgRoute()
  get(@Req() req: AppRequest, @Param() p: unknown) {
    return this.w.get(req, parse(zId, p).id);
  }

  @Post("withdrawals")
  @OrgRoute("org_admin", "preparer")
  @Idempotent()
  request(@Req() req: AppRequest, @Body() body: unknown) {
    return this.w.request(req, parse(z.object({ bank_account_id: zUuid, amount: z.string().regex(/^[1-9]\d{0,17}$/) }), body));
  }

  @Post("withdrawals/:id/approve")
  @HttpCode(200)
  @OrgRoute("org_admin", "approver")
  @StepUp()
  @Idempotent()
  approve(@Req() req: AppRequest, @Param() p: unknown) {
    return this.w.approve(req, parse(zId, p).id);
  }

  @Post("withdrawals/:id/cancel")
  @HttpCode(200)
  @OrgRoute("org_admin", "preparer", "approver")
  cancel(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.w.cancel(req, parse(zId, p).id, parse(zReason, body).reason);
  }

  @Get("admin/withdrawals")
  @StaffOnly("finance_officer", "fund_manager", "compliance_officer", "auditor", "super_admin")
  adminList(@Query() query: unknown) {
    return this.w.adminList(parse(z.object({ status: z.string().max(30).optional() }), query).status);
  }

  @Post("admin/withdrawals/:id/queue")
  @HttpCode(200)
  @StaffOnly("finance_officer")
  queue(@Req() req: AppRequest, @Param() p: unknown) {
    return this.w.queue(req, parse(zId, p).id);
  }

  @Post("admin/withdrawals/:id/fund-approve")
  @HttpCode(200)
  @StaffOnly("fund_manager")
  @StepUp()
  fundApprove(@Req() req: AppRequest, @Param() p: unknown) {
    return this.w.fundApprove(req, parse(zId, p).id);
  }

  @Post("admin/withdrawals/:id/reject")
  @HttpCode(200)
  @StaffOnly("finance_officer", "compliance_officer")
  reject(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.w.reject(req, parse(zId, p).id, parse(zReason, body).reason);
  }

  @Post("admin/withdrawals/:id/send")
  @HttpCode(200)
  @StaffOnly("finance_officer")
  @StepUp()
  send(@Req() req: AppRequest, @Param() p: unknown) {
    return this.w.send(req, parse(zId, p).id);
  }

  @Post("admin/withdrawals/poll")
  @HttpCode(200)
  @StaffOnly("finance_officer", "super_admin")
  poll() {
    return this.w.poll();
  }
}
