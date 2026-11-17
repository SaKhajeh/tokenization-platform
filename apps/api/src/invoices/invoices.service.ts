/**
 * Service invoices (D25). Issued by the system from the fund's price list (see PricingService.issueInvoice);
 * paid by the applicant from its available balance (it tops up with its payment ID, like any deposit).
 *
 * Paying is a money action: org_admin or approver, with step-up. The ledger entry moves the total from the
 * org's available balance to the fund's and the platform's service revenue (and VAT payable, if any).
 * The fund manager can waive an unpaid invoice with a reason. Either way, the linked application moves on.
 */
import { Inject, Injectable } from "@nestjs/common";
import { formatMoney } from "@tp/domain";
import { DB, Db, Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest } from "../common/context.js";
import { LedgerService, insufficientBalance } from "../ledger/ledger.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { ApplicationsService } from "../applications/applications.service.js";

const err = {
  state: (s: string) => new ApiError(409, "INVOICE_NOT_OPEN", `Invoice is ${s}`, "این صورت‌حساب باز نیست.", { status: s }),
};

const view = (r: any, lines?: any[]) => ({
  id: r.id, invoice_no: r.invoice_no, org_id: r.org_id, linked_type: r.linked_type, linked_id: r.linked_id, charge_point: r.charge_point,
  status: r.status, subtotal: String(r.subtotal), vat_bps: r.vat_bps, vat: String(r.vat), total: String(r.total),
  issued_at: r.issued_at, paid_at: r.paid_at, closed_reason: r.closed_reason, policy_version: r.policy_version,
  ...(lines ? { lines: lines.map((l) => ({ code: l.code, title: l.title, amount: String(l.amount) })) } : {}),
});
// Internal view adds the fund/platform split (staff only).
const staffView = (r: any, lines?: any[]) => ({
  ...view(r, lines), fund_share: String(r.fund_share), platform_share: String(r.platform_share), ledger_entry_id: r.ledger_entry_id,
  ...(lines ? { lines: lines.map((l) => ({ code: l.code, title: l.title, amount: String(l.amount), fund_share_bps: l.fund_share_bps })) } : {}),
});

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly apps: ApplicationsService,
  ) {}

  private lines(q: Queryable, id: string) {
    return q.query(`select * from invoice_lines where invoice_id = $1 order by line_no`, [id]).then((r) => r.rows);
  }

  async listForOrg(req: AppRequest) {
    const r = await this.db.query(`select * from invoices where org_id = $1 order by issued_at desc`, [req.org!.id]);
    return r.rows.map((x) => view(x));
  }

  async getForOrg(req: AppRequest, id: string) {
    const r = (await this.db.query(`select * from invoices where id = $1 and org_id = $2`, [id, req.org!.id])).rows[0];
    if (!r) throw Errors.notFound("Invoice");
    return view(r, await this.lines(this.db, id));
  }

  async adminList(status?: string) {
    const r = await this.db.query(`select i.*, o.legal_name from invoices i join orgs o on o.id = i.org_id ${status ? "where i.status = $1" : ""} order by issued_at desc limit 500`, status ? [status] : []);
    return r.rows.map((x: any) => ({ ...staffView(x), org_name: x.legal_name }));
  }

  async adminGet(id: string) {
    const r = (await this.db.query(`select * from invoices where id = $1`, [id])).rows[0];
    if (!r) throw Errors.notFound("Invoice");
    return staffView(r, await this.lines(this.db, id));
  }

  async pay(req: AppRequest, id: string) {
    const orgId = req.org!.id;
    return this.db.tx(async (q) => {
      const inv = (await q.query(`select * from invoices where id = $1 and org_id = $2 for update`, [id, orgId])).rows[0];
      if (!inv) throw Errors.notFound("Invoice");
      if (inv.status !== "issued") throw err.state(inv.status);
      const total = BigInt(inv.total);
      const avail = await this.ledger.account(q, "org_available", orgId);
      if ((await this.ledger.balance(q, avail)) < total) throw insufficientBalance();
      const lines = [{ account: avail, amount: total }];
      const credit = async (kind: "fund_revenue_services" | "platform_revenue_services" | "vat_payable", amt: bigint) => {
        if (amt > 0n) lines.push({ account: await this.ledger.account(q, kind), amount: -amt });
      };
      await credit("fund_revenue_services", BigInt(inv.fund_share));
      await credit("platform_revenue_services", BigInt(inv.platform_share));
      await credit("vat_payable", BigInt(inv.vat));
      const { entryId } = await this.ledger.post(q, {
        entryType: "invoice_payment", refType: "invoice", refId: id, description: `پرداخت صورت‌حساب ${inv.invoice_no}`,
        postedBy: req.user!.id, idempotencyKey: `invoice:${id}:pay`, lines,
      });
      const row = (
        await q.query(`update invoices set status='paid', paid_by=$2, paid_at=now(), ledger_entry_id=$3 where id=$1 returning *`, [id, req.user!.id, entryId])
      ).rows[0];
      await this.notifications.notify(q, {
        to: { orgId }, event: "invoice.paid", params: { no: inv.invoice_no, id, amount: formatMoney(total) },
      });
      await this.audit.append(q, { ...actor(req), orgId, action: "invoice.paid", entityType: "invoice", entityId: id, after: { total: inv.total, ledger_entry_id: entryId } });
      if (inv.linked_type === "application") await this.apps.assessmentSettled(q, inv.linked_id, req.user!.id, "paid");
      return view(row);
    });
  }

  async waive(req: AppRequest, id: string, reason: string) {
    return this.db.tx(async (q) => {
      const inv = (await q.query(`select * from invoices where id = $1 for update`, [id])).rows[0];
      if (!inv) throw Errors.notFound("Invoice");
      if (inv.status !== "issued") throw err.state(inv.status);
      const row = (
        await q.query(`update invoices set status='waived', closed_by=$2, closed_reason=$3, closed_at=now() where id=$1 returning *`, [id, req.user!.id, reason])
      ).rows[0];
      await this.audit.append(q, { ...actor(req), orgId: inv.org_id, action: "invoice.waived", entityType: "invoice", entityId: id, after: { reason, total: inv.total } });
      if (inv.linked_type === "application") await this.apps.assessmentSettled(q, inv.linked_id, req.user!.id, "waived");
      return staffView(row);
    });
  }
}
