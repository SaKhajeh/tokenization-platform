/** HTTP endpoints for pricing (D25–D27): the fund's price list and rate policy, service invoices. */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import { StepUp } from "./common/stepup.js";
import { Idempotent } from "./common/idempotency.js";
import type { AppRequest } from "./common/context.js";
import { parse, zIsoDate, zUuid } from "./common/zod.js";
import { PricingService } from "./pricing/pricing.service.js";
import { InvoicesService } from "./invoices/invoices.service.js";

const zId = z.object({ id: zUuid });
const zRate = z.string().regex(/^0\.\d{1,6}$/, "rate as a decimal, e.g. 0.056");
const zBps = z.number().int().min(0).max(10000);
const zText = (min: number, max: number) => z.string().trim().min(min).max(max);

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Applicants see the fees before they apply (no hidden fees). */
  @Get("pricing/fees")
  @OrgRoute()
  publicFees() {
    return this.pricing.publicFees();
  }

  @Get("admin/pricing/policy")
  @StaffOnly("fund_manager", "analyst", "finance_officer", "tokenisation_officer", "auditor", "super_admin")
  policy() {
    return this.pricing.policy();
  }

  @Put("admin/pricing/policy")
  @StaffOnly("fund_manager")
  @StepUp()
  setPolicy(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(
      z.object({
        rate_basis: z.enum(["annual", "monthly"]),
        default_applicant_rate: zRate,
        default_investor_rate: zRate,
        min_spread: z.string().regex(/^0(\.\d{1,6})?$/).optional(),
        waterfall_order: z.enum(["fund_first", "investors_first", "pro_rata"]),
        vat_bps: zBps,
        note: z.string().trim().max(1000).nullable().optional(),
      }),
      body,
    );
    return this.pricing.setPolicy(req, b);
  }

  @Post("admin/pricing/quote")
  @HttpCode(200)
  @StaffOnly("fund_manager", "analyst")
  quote(@Body() body: unknown) {
    const b = parse(
      z.object({
        amount: z.string().regex(/^[1-9]\d{0,17}$/),
        face_value: z.string().regex(/^[1-9]\d{0,17}$/).optional(),
        applicant_rate: zRate.optional(),
        investor_rate: zRate.optional(),
        rate_basis: z.enum(["annual", "monthly"]).optional(),
        issue_date: zIsoDate,
        months: z.number().int().min(1).max(120),
      }),
      body,
    );
    return this.pricing.quote(b);
  }
}

@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get("invoices")
  @OrgRoute()
  list(@Req() req: AppRequest) {
    return this.invoices.listForOrg(req);
  }

  @Get("invoices/:id")
  @OrgRoute()
  get(@Req() req: AppRequest, @Param() p: unknown) {
    return this.invoices.getForOrg(req, parse(zId, p).id);
  }

  @Post("invoices/:id/pay")
  @HttpCode(200)
  @OrgRoute("org_admin", "approver")
  @StepUp()
  @Idempotent()
  pay(@Req() req: AppRequest, @Param() p: unknown) {
    return this.invoices.pay(req, parse(zId, p).id);
  }

  @Get("admin/invoices")
  @StaffOnly("fund_manager", "finance_officer", "analyst", "auditor", "super_admin")
  adminList(@Query() query: unknown) {
    return this.invoices.adminList(parse(z.object({ status: z.enum(["issued", "paid", "waived", "cancelled"]).optional() }), query).status);
  }

  @Get("admin/invoices/:id")
  @StaffOnly("fund_manager", "finance_officer", "analyst", "auditor", "super_admin")
  adminGet(@Param() p: unknown) {
    return this.invoices.adminGet(parse(zId, p).id);
  }

  @Post("admin/invoices/:id/waive")
  @HttpCode(200)
  @StaffOnly("fund_manager")
  @StepUp()
  waive(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.invoices.waive(req, parse(zId, p).id, parse(z.object({ reason: zText(5, 1000) }), body).reason);
  }
}
