import { addDays, daysBetween, IsoDate, jalaliYearOf, daysInJalaliYear, parseIso } from "./jalali.js";
import type { Rial } from "./money.js";

/**
 * Return engine — PRD §8.3, confirmed defaults D19.
 *
 *   year_fraction = Σ over each day d in [issue, maturity) of 1 / days_in_jalali_year(year_of(d))
 *   return_per_unit = floor(face_value × annual_rate × year_fraction)      (rounded DOWN to the rial)
 *   total_per_unit  = face_value + return_per_unit                          (bullet at maturity)
 *   holder_payout   = total_per_unit × units                                (never fractional)
 *
 * All arithmetic is exact: the rate is a decimal string turned into a fraction, and the year
 * fraction is kept as (days_in_365_years × 366 + days_in_366_years × 365) / (365 × 366).
 * No floating point anywhere.
 */

export interface Rate {
  num: bigint; // e.g. 235
  den: bigint; // e.g. 1000  → 23.5%
}

/** "0.235" | "23.5%" → {num: 235n, den: 1000n}. Rejects negatives and > 1000%. */
export function parseRate(s: string): Rate {
  let t = s.trim();
  let pct = false;
  if (t.endsWith("%")) {
    pct = true;
    t = t.slice(0, -1).trim();
  }
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`Invalid rate: "${s}"`);
  const [i, f = ""] = t.split(".");
  let num = BigInt(i + f);
  let den = 10n ** BigInt(f.length);
  if (pct) den *= 100n;
  if (num * 1n > den * 10n) throw new Error(`Rate too large: "${s}"`);
  const g = gcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  return { num, den };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export interface YearFraction {
  days365: number; // days falling in common (365-day) Jalali years
  days366: number; // days falling in leap (366-day) Jalali years
  totalDays: number;
}

/** Splits the accrual period [issue, maturity) by Jalali year length. */
export function yearFraction(issueDate: IsoDate, maturityDate: IsoDate): YearFraction {
  parseIso(issueDate);
  parseIso(maturityDate);
  const total = daysBetween(issueDate, maturityDate);
  if (total <= 0) throw new Error("maturityDate must be after issueDate");
  let days365 = 0;
  let days366 = 0;
  // Walk Jalali-year segments instead of single days: jump to the next Nowruz each time.
  let cursor = issueDate;
  let remaining = total;
  while (remaining > 0) {
    const jy = jalaliYearOf(cursor);
    // days left in this Jalali year starting from cursor
    let span = 0;
    let probe = cursor;
    // Find the first day whose Jalali year differs (max 366 steps per segment).
    while (span < remaining && jalaliYearOf(probe) === jy) {
      span++;
      probe = addDays(probe, 1);
    }
    if (daysInJalaliYear(jy) === 366) days366 += span;
    else days365 += span;
    remaining -= span;
    cursor = probe;
  }
  return { days365, days366, totalDays: total };
}

export interface SeriesTerms {
  faceValuePerUnit: Rial; // rials
  annualRate: string; // "0.23" or "23%"
  issueDate: IsoDate;
  maturityDate: IsoDate;
}

export interface ScheduleRow {
  seq: number;
  dueDate: IsoDate;
  principalPerUnit: Rial;
  returnPerUnit: Rial;
  totalPerUnit: Rial;
}

const DEN_YEAR = 365n * 366n;

/** Return per unit, rounded down to the rial. */
export function returnPerUnit(t: SeriesTerms): Rial {
  if (t.faceValuePerUnit <= 0n) throw new Error("faceValuePerUnit must be positive");
  const rate = parseRate(t.annualRate);
  const yf = yearFraction(t.issueDate, t.maturityDate);
  const yfNum = BigInt(yf.days365) * 366n + BigInt(yf.days366) * 365n;
  return (t.faceValuePerUnit * rate.num * yfNum) / (rate.den * DEN_YEAR); // bigint division floors for positives
}

/** v1: simple return, bullet at maturity → exactly one row. Frozen at series approval. */
export function buildSchedule(t: SeriesTerms): ScheduleRow[] {
  const r = returnPerUnit(t);
  return [
    {
      seq: 1,
      dueDate: t.maturityDate,
      principalPerUnit: t.faceValuePerUnit,
      returnPerUnit: r,
      totalPerUnit: t.faceValuePerUnit + r,
    },
  ];
}

export function holderPayout(row: ScheduleRow, units: bigint): { principal: Rial; ret: Rial; total: Rial } {
  if (units < 0n) throw new Error("units must be >= 0");
  return { principal: row.principalPerUnit * units, ret: row.returnPerUnit * units, total: row.totalPerUnit * units };
}

/** What the issuer owes at each due date for the issued units. */
export function issuerDue(schedule: ScheduleRow[], issuedUnits: bigint): { dueDate: IsoDate; amount: Rial }[] {
  return schedule.map((r) => ({ dueDate: r.dueDate, amount: r.totalPerUnit * issuedUnits }));
}
