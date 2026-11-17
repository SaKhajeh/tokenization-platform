/**
 * Fund pricing settings (master plan D25–D27), edited by the fund manager in the service app:
 *   - the service price list (credit scoring, due diligence, …) that applicants pay for;
 *   - the rate policy: default applicant rate, default investor rate, minimum spread, rate basis, repayment order, VAT.
 *
 * Both are versioned and never edited in place: a change adds a new version and the audit log keeps before/after.
 * Invoices record the policy version they were issued under; series terms will record theirs (M-D).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  buildSpreadSchedule, invoiceTotals, jalaliYearOf, maturityAfterMonths, RateBasis, rateCompare, seriesEconomics, WaterfallOrder,
} from "@tp/domain";
import { DB, Db, Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";

export const CHARGE_POINTS = ["after_screening"] as const;
export type ChargePoint = (typeof CHARGE_POINTS)[number];

export interface ServiceInput {
  title: string;
  description?: string | null;
  amount: string; // rials
  fund_share_bps: number;
  charge_point: ChargePoint;
}

export interface PolicyInput {
  rate_basis: RateBasis;
  default_applicant_rate: string; // decimal, e.g. "0.056" (per month when rate_basis = monthly)
  default_investor_rate: string;
  min_spread?: string;
  waterfall_order: WaterfallOrder;
  vat_bps: number;
  note?: string | null;
}

export interface QuoteInput {
  amount: string; // rials raised
  face_value?: string;
  applicant_rate?: string;
  investor_rate?: string;
  rate_basis?: RateBasis;
  issue_date: string;
  months: number;
}

const err = {
  spread: () =>
    new ApiError(422, "SPREAD_TOO_SMALL", "The investor rate must be below the applicant rate by at least the minimum spread", "نرخ سرمایه‌گذار باید دست‌کم به اندازه‌ی حداقل اختلاف، کمتر از نرخ متقاضی باشد."),
  noPolicy: () => new ApiError(409, "NO_PRICING_POLICY", "The fund has not set a rate policy yet", "صندوق هنوز سیاست نرخ را تعیین نکرده است."),
  multiple: () => new ApiError(422, "AMOUNT_NOT_MULTIPLE", "Amount must be a multiple of the face value", "مبلغ باید مضربی از ارزش اسمی هر واحد باشد."),
};

const serviceView = (r: any) => ({
  id: r.id, code: r.code, version: r.version, title: r.title, description: r.description, amount: String(r.amount),
  fund_share_bps: r.fund_share_bps, charge_point: r.charge_point, active: r.active, created_by: r.created_by, created_at: r.created_at,
  retired_at: r.retired_at,
});

const policyView = (r: any) =>
  r && {
    version: r.version, rate_basis: r.rate_basis, default_applicant_rate: String(r.default_applicant_rate), default_investor_rate: String(r.default_investor_rate),
    min_spread: String(r.min_spread), waterfall_order: r.waterfall_order, vat_bps: r.vat_bps, note: r.note, created_by: r.created_by, created_at: r.created_at,
  };

const dec = (s: string) => s.replace(/0+$/, "").replace(/\.$/, "");

@Injectable()
export class PricingService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService) {}

  // ------------------------------------------------------------------ price list

  async catalogue(opts: { includeRetired?: boolean } = {}) {
    const r = await this.db.query(
      `select * from service_catalogue ${opts.includeRetired ? "" : "where active"} order by code, version desc`,
    );
    return r.rows.map(serviceView);
  }

  /** What an applicant sees before applying: active services with prices (no internal split). */
  async publicPriceList() {
    const p = await this.policy();
    const rows = (await this.db.query(`select code, title, description, amount, charge_point from service_catalogue where active order by code`)).rows;
    return {
      vat_bps: p?.vat_bps ?? 0,
      services: rows.map((r: any) => ({ code: r.code, title: r.title, description: r.description, amount: String(r.amount), charge_point: r.charge_point })),
    };
  }

  /** Creates a service or replaces its price/terms with a new version. */
  async upsertService(req: AppRequest, code: string, input: ServiceInput) {
    return this.db.tx(async (q) => {
      const cur = (await q.query(`select * from service_catalogue where code = $1 and active for update`, [code])).rows[0];
      const last = (await q.query(`select coalesce(max(version), 0)::int as v from service_catalogue where code = $1`, [code])).rows[0].v;
      if (cur) await q.query(`update service_catalogue set active = false, retired_by = $2, retired_at = now() where id = $1`, [cur.id, req.user!.id]);
      const row = (
        await q.query(
          `insert into service_catalogue (id, code, version, title, description, amount, fund_share_bps, charge_point, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [uuidv7(), code, last + 1, input.title, input.description ?? null, input.amount, input.fund_share_bps, input.charge_point, req.user!.id],
        )
      ).rows[0];
      await this.audit.append(q, {
        ...actor(req), action: cur ? "pricing.service_updated" : "pricing.service_created", entityType: "service", entityId: row.id,
        before: cur ? serviceView(cur) : undefined, after: serviceView(row),
      });
      return serviceView(row);
    });
  }

  async retireService(req: AppRequest, code: string, reason: string) {
    return this.db.tx(async (q) => {
      const cur = (await q.query(`select * from service_catalogue where code = $1 and active for update`, [code])).rows[0];
      if (!cur) throw Errors.notFound("Service");
      await q.query(`update service_catalogue set active = false, retired_by = $2, retired_at = now() where id = $1`, [cur.id, req.user!.id]);
      await this.audit.append(q, { ...actor(req), action: "pricing.service_retired", entityType: "service", entityId: cur.id, before: serviceView(cur), after: { reason } });
      return { code, active: false };
    });
  }

  // ------------------------------------------------------------------ rate policy

  async policy(q: Queryable = this.db) {
    return policyView((await q.query(`select * from pricing_policies order by version desc limit 1`)).rows[0]) ?? null;
  }

  async setPolicy(req: AppRequest, input: PolicyInput) {
    const min = input.min_spread ?? "0";
    // investor + min_spread <= applicant, compared exactly
    const ok = rateCompare(input.default_investor_rate, input.default_applicant_rate) <= 0 &&
      rateCompare(addRates(input.default_investor_rate, min), input.default_applicant_rate) <= 0;
    if (!ok) throw err.spread();
    return this.db.tx(async (q) => {
      await q.query(`lock table pricing_policies in exclusive mode`);
      const before = await this.policy(q);
      const row = (
        await q.query(
          `insert into pricing_policies (id, version, rate_basis, default_applicant_rate, default_investor_rate, min_spread, waterfall_order, vat_bps, note, created_by)
           values ($1, coalesce((select max(version) from pricing_policies), 0) + 1, $2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [uuidv7(), input.rate_basis, input.default_applicant_rate, input.default_investor_rate, min, input.waterfall_order, input.vat_bps, input.note ?? null, req.user!.id],
        )
      ).rows[0];
      await this.audit.append(q, { ...actor(req), action: "pricing.policy_changed", entityType: "pricing_policy", entityId: row.id, before: before ?? undefined, after: policyView(row) });
      return policyView(row);
    });
  }

  /** Preview for the fund panel: what the applicant owes, what investors get and the fund's spread. */
  async quote(input: QuoteInput) {
    const p = await this.policy();
    const applicantRate = input.applicant_rate ?? p?.default_applicant_rate;
    const investorRate = input.investor_rate ?? p?.default_investor_rate;
    const basis = input.rate_basis ?? p?.rate_basis;
    if (!applicantRate || !investorRate || !basis) throw err.noPolicy();
    const face = BigInt(input.face_value ?? "10000000");
    const amount = BigInt(input.amount);
    if (amount % face !== 0n) throw err.multiple();
    const maturity = maturityAfterMonths(input.issue_date, input.months);
    let row;
    try {
      row = buildSpreadSchedule({ faceValuePerUnit: face, applicantRate, investorRate, rateBasis: basis, issueDate: input.issue_date, maturityDate: maturity })[0];
    } catch (e) {
      throw new ApiError(422, "INVALID_TERMS", (e as Error).message, "شرایط واردشده معتبر نیست.");
    }
    const e = seriesEconomics(row, amount / face);
    const str = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
    return {
      rate_basis: basis, applicant_rate: dec(applicantRate), investor_rate: dec(investorRate), issue_date: input.issue_date, maturity_date: maturity,
      units: (amount / face).toString(), per_unit: str({ ...row }), totals: str({ ...e }),
      waterfall_order: p?.waterfall_order ?? "fund_first",
    };
  }

  // ------------------------------------------------------------------ invoices (issued inside the caller's transaction)

  /** Issues an invoice from the active price list for a charge point. Returns null when nothing is charged. */
  async issueInvoice(q: Queryable, i: { orgId: string; linkedType: string; linkedId: string; chargePoint: ChargePoint; actorId: string | null; today: string }) {
    const services = (await q.query(`select * from service_catalogue where active and charge_point = $1 and amount > 0 order by code`, [i.chargePoint])).rows;
    if (!services.length) return null;
    const p = await this.policy(q);
    const vatBps = p?.vat_bps ?? 0;
    const t = invoiceTotals(services.map((s: any) => ({ code: s.code, amount: BigInt(s.amount), fundShareBps: s.fund_share_bps })), vatBps);
    const n = Number((await q.query(`select nextval('invoice_no_seq') as n`)).rows[0].n);
    const no = `INV-${jalaliYearOf(i.today)}-${String(n).padStart(5, "0")}`;
    const id = uuidv7();
    await q.query(
      `insert into invoices (id, invoice_no, org_id, linked_type, linked_id, charge_point, subtotal, vat_bps, vat, total, fund_share, platform_share, policy_version, issued_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, no, i.orgId, i.linkedType, i.linkedId, i.chargePoint, t.subtotal.toString(), vatBps, t.vat.toString(), t.total.toString(),
        t.fundShare.toString(), t.platformShare.toString(), p?.version ?? null, i.actorId],
    );
    let line = 0;
    for (const s of services) {
      await q.query(
        `insert into invoice_lines (invoice_id, line_no, service_id, code, title, amount, fund_share_bps) values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, ++line, s.id, s.code, s.title, String(s.amount), s.fund_share_bps],
      );
    }
    return { id, invoice_no: no, total: t.total };
  }
}

/** Adds two decimal rate strings exactly (for the min-spread check). */
function addRates(a: string, b: string): string {
  const fa = (a.split(".")[1] ?? "").length;
  const fb = (b.split(".")[1] ?? "").length;
  const f = Math.max(fa, fb);
  const ia = BigInt(a.replace(".", "") + "0".repeat(f - fa));
  const ib = BigInt(b.replace(".", "") + "0".repeat(f - fb));
  const s = (ia + ib).toString().padStart(f + 1, "0");
  return f ? `${s.slice(0, -f)}.${s.slice(-f)}` : s;
}
