/** HTTP endpoints for pricing (D25–D27): the fund's price list and rate policy, service invoices. */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import { StepUp } from "./common/stepup.js";
import { Idempotent } from "./common/idempotency.js";
import type { AppRequest } from "./common/context.js";
import { parse, zIsoDate, zUuid } from "./common/zod.js";
import { CHARGE_POINTS, PricingService } from "./pricing/pricing.service.js";
import { InvoicesService } from "./invoices/invoices.service.js";

const zId = z.object({ id: zUuid });
const zCode = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "lower-case code, e.g. credit_scoring") });
const zRialOrZero = z.string().regex(/^(0|[1-9]\d{0,17})$/, "amount in rials, digits only");
const zRate = z.string().regex(/^0\.\d{1,6}$/, "rate as a decimal, e.g. 0.056");
const zBps = z.number().int().min(0).max(10000);
const zText = (min: number, max: number) => z.string().trim().min(min).max(max);

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Applicants see the prices before they apply (no hidden fees). */
  @Get("pricing/services")
  @OrgRoute()
  publicList() {
    return this.pricing.publicPriceList();
  }

  @Get("admin/pricing/services")
  @StaffOnly("fund_manager", "analyst", "finance_officer", "auditor", "super_admin")
  list(@Query() query: unknown) {
    const f = parse(z.object({ include_retired: z.enum(["true", "false"]).optional() }), query);
    return this.pricing.catalogue({ includeRetired: f.include_retired === "true" });
  }

  @Put("admin/pricing/services/:code")
  @StaffOnly("fund_manager")
  @StepUp()
  upsert(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(
      z.object({
        title: zText(2, 120),
        description: z.string().trim().max(1000).nullable().optional(),
        amount: zRialOrZero,
        fund_share_bps: zBps,
        charge_point: z.enum(CHARGE_POINTS),
      }),
      body,
    );
    return this.pricing.upsertService(req, parse(zCode, p).code, b);
  }

  @Post("admin/pricing/services/:code/retire")
  @HttpCode(200)
  @StaffOnly("fund_manager")
  @StepUp()
  retire(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.pricing.retireService(req, parse(zCode, p).code, parse(z.object({ reason: zText(3, 500) }), body).reason);
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
