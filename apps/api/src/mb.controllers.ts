/** HTTP endpoints for milestone M-B: KYB, bank accounts, wallet, balances, deposits, and the staff queues. */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { OrgRoute, Req, StaffOnly } from "./common/guards.js";
import { StepUp } from "./common/stepup.js";
import { Idempotent } from "./common/idempotency.js";
import type { AppRequest, StaffRole } from "./common/context.js";
import { parse, zIsoDate, zUuid } from "./common/zod.js";
import { KybService } from "./kyb/kyb.service.js";
import { BankAccountsService } from "./bank-accounts/bank-accounts.service.js";
import { DepositsService } from "./deposits/deposits.service.js";
import { LedgerService } from "./ledger/ledger.service.js";
import { ChainService } from "./chain/chain.service.js";
import { DB, Db } from "./db/db.js";

const ALL_STAFF: StaffRole[] = [
  "super_admin", "compliance_officer", "finance_officer", "tokenisation_officer", "analyst", "external_expert", "committee_member", "fund_manager", "auditor",
];
const zId = z.object({ id: zUuid });

// ------------------------------------------------------------------ KYB

@Controller()
export class KybController {
  constructor(private readonly kyb: KybService) {}

  @Get("kyb")
  @OrgRoute()
  current(@Req() req: AppRequest) {
    return this.kyb.current(req);
  }

  @Post("kyb/registry")
  @HttpCode(200)
  @OrgRoute("org_admin")
  registry(@Req() req: AppRequest) {
    return this.kyb.fetchRegistry(req);
  }

  @Post("kyb/submit")
  @OrgRoute("org_admin")
  @StepUp()
  @Idempotent()
  submit(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(
      z.object({
        snapshot_id: zUuid,
        fields: z.object({
          activity: z.string().trim().min(3).max(500),
          address: z.string().trim().min(10).max(500),
          postal_code: z.string().trim().min(10).max(10),
          phone: z.string().trim().min(8).max(15),
          website: z.string().url().max(200).optional(),
          contact_email: z.string().email().max(200).optional(),
        }),
        authority_doc_id: zUuid.optional(),
      }),
      body,
    );
    return this.kyb.submit(req, b);
  }

  @Get("admin/kyb")
  @StaffOnly("compliance_officer", "super_admin", "auditor")
  list(@Query() query: unknown) {
    const f = parse(z.object({ status: z.enum(["in_review", "approved", "rejected", "info_requested", "expired"]).optional() }), query);
    return this.kyb.list(f.status);
  }

  @Get("admin/kyb/:id")
  @StaffOnly("compliance_officer", "super_admin", "auditor")
  get(@Param() p: unknown) {
    return this.kyb.get(parse(zId, p).id);
  }

  @Post("admin/kyb/:id/decision")
  @HttpCode(200)
  @StaffOnly("compliance_officer")
  decide(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(
      z.object({ decision: z.enum(["approve", "reject", "request_info"]), reason: z.string().trim().max(1000).optional(), expires_at: zIsoDate.optional() }),
      body,
    );
    return this.kyb.decide(req, parse(zId, p).id, b);
  }
}

// ------------------------------------------------------------------ bank accounts

@Controller()
export class BankAccountsController {
  constructor(private readonly accounts: BankAccountsService) {}

  @Get("bank-accounts")
  @OrgRoute()
  list(@Req() req: AppRequest) {
    return this.accounts.list(req);
  }

  @Post("bank-accounts")
  @OrgRoute("org_admin")
  @StepUp()
  @Idempotent()
  add(@Req() req: AppRequest, @Body() body: unknown) {
    return this.accounts.add(req, parse(z.object({ iban: z.string().min(24).max(40) }), body));
  }

  @Delete("bank-accounts/:id")
  @OrgRoute("org_admin")
  @StepUp()
  remove(@Req() req: AppRequest, @Param() p: unknown) {
    return this.accounts.remove(req, parse(zId, p).id);
  }

  @Patch("bank-accounts/:id")
  @OrgRoute("org_admin")
  setDefault(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    parse(z.object({ is_default: z.literal(true) }), body);
    return this.accounts.setDefault(req, parse(zId, p).id);
  }

  @Get("admin/bank-accounts/pending")
  @StaffOnly("compliance_officer", "super_admin", "auditor")
  pending() {
    return this.accounts.pending();
  }

  @Post("admin/bank-accounts/:id/review")
  @HttpCode(200)
  @StaffOnly("compliance_officer")
  review(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    return this.accounts.review(req, parse(zId, p).id, parse(z.object({ approved: z.boolean(), reason: z.string().trim().min(3).max(1000) }), body));
  }
}

// ------------------------------------------------------------------ money: balances, deposits, ledger

@Controller()
export class MoneyController {
  constructor(private readonly deposits: DepositsService, private readonly ledger: LedgerService) {}

  @Get("balances")
  @OrgRoute()
  balances(@Req() req: AppRequest) {
    return this.ledger.orgBalances(req.org!.id);
  }

  @Get("ledger/statement")
  @OrgRoute()
  statement(@Req() req: AppRequest, @Query() query: unknown) {
    const f = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }), query);
    return this.ledger.orgStatement(req.org!.id, f.limit);
  }

  @Get("deposit-instructions")
  @OrgRoute()
  instructions(@Req() req: AppRequest) {
    return this.deposits.instructions(req);
  }

  @Get("deposits")
  @OrgRoute()
  list(@Req() req: AppRequest) {
    return this.deposits.listForOrg(req);
  }

  @Post("admin/deposits/poll")
  @HttpCode(200)
  @StaffOnly("finance_officer", "super_admin")
  poll() {
    return this.deposits.poll();
  }

  @Get("admin/deposits/lines")
  @StaffOnly("finance_officer", "compliance_officer", "auditor", "super_admin")
  lines(@Query() query: unknown) {
    const f = parse(z.object({ status: z.enum(["received", "credited", "suspense", "refunded", "failed"]).optional() }), query);
    return this.deposits.lines(f.status);
  }

  @Post("admin/deposits/lines/:id/resolve")
  @HttpCode(200)
  @StaffOnly("compliance_officer")
  resolve(@Req() req: AppRequest, @Param() p: unknown, @Body() body: unknown) {
    const b = parse(z.object({ action: z.enum(["credit", "refund"]), org_id: zUuid.optional(), reason: z.string().trim().min(3).max(1000) }), body);
    return this.deposits.resolve(req, parse(zId, p).id, b);
  }

  @Get("admin/ledger/trial-balance")
  @StaffOnly("finance_officer", "auditor", "super_admin")
  trialBalance() {
    return this.ledger.trialBalance();
  }
}

// ------------------------------------------------------------------ wallet / chain

@Controller()
export class ChainController {
  constructor(private readonly chain: ChainService) {}

  @Get("wallet")
  @OrgRoute()
  wallet(@Req() req: AppRequest) {
    return this.chain.walletForOrg(req);
  }

  @Post("admin/chain/process")
  @HttpCode(200)
  @StaffOnly("tokenisation_officer", "super_admin")
  process() {
    return this.chain.processOutbox();
  }

  @Get("admin/chain/txs")
  @StaffOnly("tokenisation_officer", "super_admin", "auditor")
  txs(@Query() query: unknown) {
    return this.chain.listTxs(parse(z.object({ status: z.enum(["queued", "submitted", "confirmed", "failed"]).optional() }), query).status);
  }

  @Post("admin/chain/txs/:id/retry")
  @HttpCode(200)
  @StaffOnly("tokenisation_officer", "super_admin")
  retry(@Req() req: AppRequest, @Param() p: unknown) {
    return this.chain.retry(req, parse(zId, p).id);
  }
}

// ------------------------------------------------------------------ staff work queue

@Controller()
export class StaffTasksController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Open workflow tasks for any of my staff roles (KYB reviews, held deposits, failed chain txs…). */
  @Get("admin/tasks")
  @StaffOnly(...ALL_STAFF)
  async mine(@Req() req: AppRequest) {
    const r = await this.db.query(
      `select id, title, description, linked_type, linked_id, assignee_role, priority, status, due_date, workflow_key, created_at
       from tasks where org_id is null and status in ('open','in_progress') and assignee_role = any($1::text[])
       order by priority, created_at limit 200`,
      [req.user!.staffRoles],
    );
    return r.rows;
  }
}
