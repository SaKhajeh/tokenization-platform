/**
 * Fund pricing settings (master plan D25–D27, plan/07 §6d), edited by the fund manager in the service app:
 *   - fees live in the versioned fee tariff (cases/fees.ts, LimitsService.setTariff): the assessment fee at case
 *     submission and the financing application fee charged when an application passes screening (D-C13);
 *   - the rate policy: default applicant rate, default investor rate, minimum spread, rate basis, repayment order, VAT.
 *
 * Both are versioned and never edited in place: a change adds a new version and the audit log keeps before/after.
 * The per-service price list of D25 (service_catalogue) is retired: the tariff replaced it (doc 07 §6d).
 */
import { activeExemption } from "../cases/fees.js";
import { Inject, Injectable } from "@nestjs/common";
import { buildSpreadSchedule, invoiceTotals, jalaliYearOf, maturityAfterMonths, RateBasis, rateCompare, seriesEconomics, WaterfallOrder } from "@tp/domain";
import { DB, type Db, type Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/errors.js";
import { actor, type AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { currentTariff } from "../cases/fees.js";

export const CHARGE_POINTS = ["after_screening"] as const;
export type ChargePoint = (typeof CHARGE_POINTS)[number];

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

const policyView = (r: any) =>
  r && {
    version: r.version, rate_basis: r.rate_basis, default_applicant_rate: String(r.default_applicant_rate), default_investor_rate: String(r.default_investor_rate),
    min_spread: String(r.min_spread), waterfall_order: r.waterfall_order, vat_bps: r.vat_bps, note: r.note, created_by: r.created_by, created_at: r.created_at,
  };

const dec = (s: string) => s.replace(/0+$/, "").replace(/\.$/, "");

@Injectable()
export class PricingService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService) {}

  /** What an applicant sees before applying: the current fees (no internal split). */
  async publicFees() {
    const t = await currentTariff(this.db);
    const p = await this.policy();
    return {
      vat_bps: p?.vat_bps ?? 0,
      assessment_fee_tehran: t ? String(t.assessment_fee_tehran) : "0",
      assessment_fee_outside: t ? String(t.assessment_fee_outside) : "0",
      application_fee: t ? String(t.application_fee) : "0",
      tariff_version: t?.version ?? null,
    };
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

  /** The financing application fee from the current tariff (D-C13). Returns null when it is zero. */
  async issueInvoice(q: Queryable, i: { orgId: string; linkedType: string; linkedId: string; chargePoint: ChargePoint; actorId: string | null; today: string }) {
    const t = await currentTariff(q);
    if (await activeExemption(q, i.orgId, "after_screening")) return null; // exempted by the fund manager
    const amount = BigInt(t?.application_fee ?? 0);
    if (amount === 0n) return null;
    const p = await this.policy(q);
    const vatBps = p?.vat_bps ?? 0;
    const tot = invoiceTotals([{ code: "application_fee", amount, fundShareBps: 10000 - t.platform_share_bps }], vatBps);
    const n = Number((await q.query(`select nextval('invoice_no_seq') as n`)).rows[0].n);
    const no = `INV-${jalaliYearOf(i.today)}-${String(n).padStart(5, "0")}`;
    const id = uuidv7();
    await q.query(
      `insert into invoices (id, invoice_no, org_id, linked_type, linked_id, charge_point, subtotal, vat_bps, vat, total, fund_share, platform_share, policy_version, issued_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, no, i.orgId, i.linkedType, i.linkedId, i.chargePoint, tot.subtotal.toString(), vatBps, tot.vat.toString(), tot.total.toString(),
        tot.fundShare.toString(), tot.platformShare.toString(), t.version, i.actorId],
    );
    return { id, invoice_no: no, total: tot.total };
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
