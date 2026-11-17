import { daysBetween, IsoDate, isoToJalali, jalaliToIso, parseIso } from "./jalali.js";
import type { Rial } from "./money.js";
import { parseRate, returnPerUnit } from "./returnEngine.js";

/**
 * Pricing (master plan D25–D27).
 *
 * D25  The applicant company pays for assessment services (credit scoring, due diligence, …). The fund keeps a
 *      versioned price list; when screening passes, an invoice is issued from it and assessment waits for payment.
 * D26  Two rates per series. The applicant pays the applicant rate; investors earn the investor rate. The difference
 *      (the spread) is the fund's income. Rates can be quoted monthly or annually; both are simple (not compound).
 * D27  At maturity the repayment goes first to the fund's spread, then to investors ("fund_first"). The order is a
 *      fund setting; "investors_first" and "pro_rata" are also supported.
 *
 * Everything is bigint and rounded down to the rial, per unit.
 */

export type RateBasis = "annual" | "monthly";

// ------------------------------------------------------------------ periods

const JALALI_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;
function jparts(iso: IsoDate) {
  const m = JALALI_RE.exec(isoToJalali(iso));
  if (!m) throw new Error(`Unexpected Jalali format for ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Adds whole Jalali months to a date (same day of month). Throws if that day does not exist in the target month. */
export function addJalaliMonths(iso: IsoDate, months: number): IsoDate {
  const j = jparts(iso);
  const idx = j.y * 12 + (j.m - 1) + months;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const s = `${y}/${String(m).padStart(2, "0")}/${String(j.d).padStart(2, "0")}`;
  const out = jalaliToIso(s);
  if (isoToJalali(out) !== s) throw new Error(`Jalali date ${s} does not exist`);
  return out;
}

/**
 * Whole Jalali months between two dates. Monthly-quoted terms must run whole months: the maturity falls on the
 * same Jalali day as the issue date (e.g. ۱۴۰۵/۱۰/۰۱ → ۱۴۰۶/۱۰/۰۱ = 12 months).
 */
export function jalaliMonthsBetween(issue: IsoDate, maturity: IsoDate): number {
  parseIso(issue);
  parseIso(maturity);
  if (daysBetween(issue, maturity) <= 0) throw new Error("maturityDate must be after issueDate");
  const a = jparts(issue);
  const b = jparts(maturity);
  if (a.d !== b.d) throw new Error("Monthly-rate terms must mature on the same Jalali day of the month as the issue date");
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/** Return per unit for one rate, rounded down to the rial. Annual basis uses the Jalali day count (D19). */
export function periodReturnPerUnit(face: Rial, rate: string, basis: RateBasis, issue: IsoDate, maturity: IsoDate): Rial {
  if (face <= 0n) throw new Error("faceValuePerUnit must be positive");
  if (basis === "annual") return returnPerUnit({ faceValuePerUnit: face, annualRate: rate, issueDate: issue, maturityDate: maturity });
  const r = parseRate(rate);
  const months = BigInt(jalaliMonthsBetween(issue, maturity));
  return (face * r.num * months) / r.den;
}

// ------------------------------------------------------------------ two-rate schedule (D26)

export interface SpreadTerms {
  faceValuePerUnit: Rial;
  /** What the applicant company pays, e.g. "0.056" monthly. */
  applicantRate: string;
  /** What investors earn, e.g. "0.04" monthly. Must not exceed applicantRate. */
  investorRate: string;
  rateBasis: RateBasis;
  issueDate: IsoDate;
  maturityDate: IsoDate;
}

export interface SpreadRow {
  seq: number;
  dueDate: IsoDate;
  principalPerUnit: Rial;
  applicantReturnPerUnit: Rial;
  investorReturnPerUnit: Rial;
  /** Fund income per unit = applicant return − investor return. */
  spreadPerUnit: Rial;
  /** What the applicant owes per unit at maturity. */
  applicantTotalPerUnit: Rial;
  /** What an investor receives per unit at maturity. */
  investorTotalPerUnit: Rial;
}

export function rateCompare(a: string, b: string): number {
  const x = parseRate(a);
  const y = parseRate(b);
  const l = x.num * y.den;
  const r = y.num * x.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Bullet schedule with both sides. Frozen with the terms (termsHash covers both rates). */
export function buildSpreadSchedule(t: SpreadTerms): SpreadRow[] {
  if (rateCompare(t.investorRate, t.applicantRate) > 0) throw new Error("investorRate cannot exceed applicantRate");
  const ar = periodReturnPerUnit(t.faceValuePerUnit, t.applicantRate, t.rateBasis, t.issueDate, t.maturityDate);
  const ir = periodReturnPerUnit(t.faceValuePerUnit, t.investorRate, t.rateBasis, t.issueDate, t.maturityDate);
  return [
    {
      seq: 1,
      dueDate: t.maturityDate,
      principalPerUnit: t.faceValuePerUnit,
      applicantReturnPerUnit: ar,
      investorReturnPerUnit: ir,
      spreadPerUnit: ar - ir,
      applicantTotalPerUnit: t.faceValuePerUnit + ar,
      investorTotalPerUnit: t.faceValuePerUnit + ir,
    },
  ];
}

export interface SeriesEconomics {
  principal: Rial;
  applicantDue: Rial;
  investorsDue: Rial;
  fundSpread: Rial;
  /** Fund spread as basis points of principal (e.g. 1920 = 19.2%). */
  spreadBps: number;
}

export function seriesEconomics(row: SpreadRow, units: bigint): SeriesEconomics {
  if (units < 0n) throw new Error("units must be >= 0");
  const principal = row.principalPerUnit * units;
  const fundSpread = row.spreadPerUnit * units;
  return {
    principal,
    applicantDue: row.applicantTotalPerUnit * units,
    investorsDue: row.investorTotalPerUnit * units,
    fundSpread,
    spreadBps: principal === 0n ? 0 : Number((fundSpread * 10000n) / principal),
  };
}

// ------------------------------------------------------------------ repayment waterfall (D27)

export type WaterfallOrder = "fund_first" | "investors_first" | "pro_rata";

export interface WaterfallResult {
  toFund: Rial;
  toInvestors: Rial;
  /** Collected above what is owed (e.g. overpayment); left for manual handling. */
  excess: Rial;
  fundShortfall: Rial;
  investorsShortfall: Rial;
}

/** Splits a collected amount between the fund's spread and the investors' claim. */
export function waterfall(collected: Rial, due: { fund: Rial; investors: Rial }, order: WaterfallOrder): WaterfallResult {
  if (collected < 0n || due.fund < 0n || due.investors < 0n) throw new Error("amounts must be >= 0");
  const total = due.fund + due.investors;
  const usable = collected < total ? collected : total;
  let toFund: Rial;
  let toInvestors: Rial;
  if (order === "fund_first") {
    toFund = usable < due.fund ? usable : due.fund;
    toInvestors = usable - toFund;
  } else if (order === "investors_first") {
    toInvestors = usable < due.investors ? usable : due.investors;
    toFund = usable - toInvestors;
  } else {
    // pro rata by claim; investors get the rounding remainder
    toFund = total === 0n ? 0n : (usable * due.fund) / total;
    toInvestors = usable - toFund;
  }
  return {
    toFund,
    toInvestors,
    excess: collected - usable,
    fundShortfall: due.fund - toFund,
    investorsShortfall: due.investors - toInvestors,
  };
}

/** Per-unit amount for holders from a pool, rounded down; the remainder stays undistributed. */
export function perUnitFromPool(pool: Rial, units: bigint, capPerUnit: Rial): { perUnit: Rial; distributed: Rial; remainder: Rial } {
  if (units <= 0n) return { perUnit: 0n, distributed: 0n, remainder: pool };
  let perUnit = pool / units;
  if (perUnit > capPerUnit) perUnit = capPerUnit;
  const distributed = perUnit * units;
  return { perUnit, distributed, remainder: pool - distributed };
}

// ------------------------------------------------------------------ service invoices (D25)

export interface InvoiceLineInput {
  code: string;
  amount: Rial;
  /** Fund's share of this line in basis points; the platform gets the rest. */
  fundShareBps: number;
}

export interface InvoiceTotals {
  subtotal: Rial;
  vat: Rial;
  total: Rial;
  fundShare: Rial;
  platformShare: Rial;
}

export function invoiceTotals(lines: InvoiceLineInput[], vatBps: number): InvoiceTotals {
  if (!Number.isInteger(vatBps) || vatBps < 0 || vatBps > 10000) throw new Error("vatBps must be 0..10000");
  let subtotal = 0n;
  let fundShare = 0n;
  for (const l of lines) {
    if (l.amount < 0n) throw new Error(`negative amount on ${l.code}`);
    if (!Number.isInteger(l.fundShareBps) || l.fundShareBps < 0 || l.fundShareBps > 10000) throw new Error(`fundShareBps out of range on ${l.code}`);
    subtotal += l.amount;
    fundShare += (l.amount * BigInt(l.fundShareBps)) / 10000n;
  }
  const vat = (subtotal * BigInt(vatBps)) / 10000n;
  return { subtotal, vat, total: subtotal + vat, fundShare, platformShare: subtotal - fundShare };
}

/** Convenience for the fund panel: maturity for N whole Jalali months. */
export const maturityAfterMonths = (issue: IsoDate, months: number): IsoDate => addJalaliMonths(issue, months);
