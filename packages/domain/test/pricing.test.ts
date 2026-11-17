import { describe, expect, it } from "vitest";
import {
  addJalaliMonths, buildSpreadSchedule, invoiceTotals, isoToJalali, jalaliMonthsBetween, jalaliToIso, perUnitFromPool,
  periodReturnPerUnit, seriesEconomics, waterfall, canTransition, APPLICATION,
} from "../src/index.js";

const FACE = 10_000_000n; // 1,000,000 toman per unit
const issue = jalaliToIso("1405/10/01");
const mat12 = jalaliToIso("1406/10/01");

describe("Jalali months", () => {
  it("counts whole months and adds them", () => {
    expect(jalaliMonthsBetween(issue, mat12)).toBe(12);
    expect(jalaliMonthsBetween(issue, jalaliToIso("1406/04/01"))).toBe(6);
    expect(isoToJalali(addJalaliMonths(issue, 18))).toBe("1407/04/01");
    expect(isoToJalali(addJalaliMonths(jalaliToIso("1405/12/15"), 1))).toBe("1406/01/15");
  });
  it("rejects maturities that are not whole months, and days that do not exist", () => {
    expect(() => jalaliMonthsBetween(issue, jalaliToIso("1406/10/05"))).toThrow(/same Jalali day/);
    expect(() => jalaliMonthsBetween(mat12, issue)).toThrow(/after/);
    expect(() => addJalaliMonths(jalaliToIso("1405/06/31"), 1)).toThrow(); // month 7 has 30 days
  });
});

describe("two-rate schedule (D26)", () => {
  // The simulation's example: applicant 5.6% a month, investors 4% a month, 12 months.
  const row = buildSpreadSchedule({ faceValuePerUnit: FACE, applicantRate: "0.056", investorRate: "0.04", rateBasis: "monthly", issueDate: issue, maturityDate: mat12 })[0];

  it("computes each side per unit and the fund spread", () => {
    expect(row.applicantReturnPerUnit).toBe(6_720_000n); // 67.2% of face
    expect(row.investorReturnPerUnit).toBe(4_800_000n); // 48%
    expect(row.spreadPerUnit).toBe(1_920_000n); // 19.2% → fund
    expect(row.applicantTotalPerUnit).toBe(16_720_000n);
    expect(row.investorTotalPerUnit).toBe(14_800_000n);
  });

  it("series economics for 2,000 units (2 billion toman)", () => {
    const e = seriesEconomics(row, 2000n);
    expect(e.principal).toBe(20_000_000_000n);
    expect(e.applicantDue).toBe(33_440_000_000n);
    expect(e.investorsDue).toBe(29_600_000_000n);
    expect(e.fundSpread).toBe(3_840_000_000n);
    expect(e.spreadBps).toBe(1920);
    expect(e.applicantDue).toBe(e.investorsDue + e.fundSpread);
  });

  it("monthly basis rounds down per unit", () => {
    // 3.33% a month for 7 months on 1,000,003 rials → floor(1,000,003 × 0.0333 × 7) = 233,100
    expect(periodReturnPerUnit(1_000_003n, "0.0333", "monthly", issue, jalaliToIso("1406/05/01"))).toBe(233_100n);
  });

  it("annual basis still uses the Jalali day count", () => {
    expect(periodReturnPerUnit(FACE, "0.672", "annual", issue, mat12)).toBe(6_720_000n); // 365 days in non-leap years
  });

  it("refuses an investor rate above the applicant rate; equal rates mean no spread", () => {
    expect(() => buildSpreadSchedule({ faceValuePerUnit: FACE, applicantRate: "0.04", investorRate: "0.045", rateBasis: "monthly", issueDate: issue, maturityDate: mat12 })).toThrow(/cannot exceed/);
    const r = buildSpreadSchedule({ faceValuePerUnit: FACE, applicantRate: "4%", investorRate: "0.04", rateBasis: "monthly", issueDate: issue, maturityDate: mat12 })[0];
    expect(r.spreadPerUnit).toBe(0n);
  });
});

describe("repayment waterfall (D27)", () => {
  const due = { fund: 3_840_000_000n, investors: 29_600_000_000n };

  it("full payment covers both sides in every order", () => {
    for (const o of ["fund_first", "investors_first", "pro_rata"] as const) {
      const w = waterfall(33_440_000_000n, due, o);
      expect(w).toMatchObject({ toFund: due.fund, toInvestors: due.investors, excess: 0n, fundShortfall: 0n, investorsShortfall: 0n });
    }
  });

  it("partial payment: fund first takes its spread before investors", () => {
    const w = waterfall(20_064_000_000n, due, "fund_first"); // 60% paid
    expect(w.toFund).toBe(3_840_000_000n);
    expect(w.toInvestors).toBe(16_224_000_000n);
    expect(w.investorsShortfall).toBe(13_376_000_000n);
  });

  it("investors first and pro rata", () => {
    expect(waterfall(20_000_000_000n, due, "investors_first")).toMatchObject({ toFund: 0n, toInvestors: 20_000_000_000n });
    const p = waterfall(16_720_000_000n, due, "pro_rata"); // exactly half of the total claim
    expect(p.toFund).toBe(1_920_000_000n);
    expect(p.toInvestors).toBe(14_800_000_000n);
  });

  it("overpayment is reported as excess", () => {
    expect(waterfall(33_440_000_100n, due, "fund_first").excess).toBe(100n);
  });

  it("per-unit pool distribution rounds down and caps at the promised amount", () => {
    expect(perUnitFromPool(1_000_000_007n, 100n, 14_800_000n)).toEqual({ perUnit: 10_000_000n, distributed: 1_000_000_000n, remainder: 7n });
    expect(perUnitFromPool(5_000_000_000n, 100n, 14_800_000n).perUnit).toBe(14_800_000n);
  });
});

describe("service invoices (D25)", () => {
  it("sums lines, splits fund and platform shares, adds VAT", () => {
    // 20,000,000 toman: credit scoring 8m, due diligence 9m, guarantee review 3m
    const lines = [
      { code: "credit_scoring", amount: 80_000_000n, fundShareBps: 10000 },
      { code: "due_diligence", amount: 90_000_000n, fundShareBps: 10000 },
      { code: "guarantee_review", amount: 30_000_000n, fundShareBps: 7000 },
    ];
    expect(invoiceTotals(lines, 0)).toEqual({ subtotal: 200_000_000n, vat: 0n, total: 200_000_000n, fundShare: 191_000_000n, platformShare: 9_000_000n });
    expect(invoiceTotals(lines, 1000).total).toBe(220_000_000n);
  });
  it("validates inputs", () => {
    expect(() => invoiceTotals([{ code: "x", amount: -1n, fundShareBps: 0 }], 0)).toThrow();
    expect(() => invoiceTotals([{ code: "x", amount: 1n, fundShareBps: 10001 }], 0)).toThrow();
  });
  it("applications can wait for payment between screening and credit assessment", () => {
    expect(canTransition(APPLICATION, "screening", "awaiting_payment")).toBe(true);
    expect(canTransition(APPLICATION, "awaiting_payment", "credit_assessment")).toBe(true);
    expect(canTransition(APPLICATION, "awaiting_payment", "committee")).toBe(false);
  });
});
