import { describe, it, expect } from "vitest";
import {
  buildSchedule,
  holderPayout,
  issuerDue,
  jalaliToIso,
  parseRate,
  returnPerUnit,
  yearFraction,
  isLeapJalaliYear,
} from "../src/index.js";

// face value 10,000,000 toman = 100,000,000 rial; 23% simple annual return
const FACE = 100_000_000n;
const J = jalaliToIso;

describe("Jalali leap years (sanity of the calendar library)", () => {
  it("1399 and 1403 are leap; 1400–1402 and 1404 are not", () => {
    expect(isLeapJalaliYear(1399)).toBe(true);
    expect(isLeapJalaliYear(1403)).toBe(true);
    for (const y of [1400, 1401, 1402, 1404]) expect(isLeapJalaliYear(y)).toBe(false);
  });
  it("Esfand 30 exists only in leap years", () => {
    expect(J("1403/12/30")).toBe("2025-03-20");
    expect(() => J("1404/12/30")).toThrow();
  });
});

describe("parseRate", () => {
  it("accepts decimals and percentages, reduced", () => {
    expect(parseRate("0.23")).toEqual({ num: 23n, den: 100n });
    expect(parseRate("23%")).toEqual({ num: 23n, den: 100n });
    expect(parseRate("23.5%")).toEqual({ num: 47n, den: 200n });
    expect(parseRate("0")).toEqual({ num: 0n, den: 1n });
  });
  it("rejects junk, negatives and absurd rates", () => {
    for (const s of ["", "abc", "-0.1", "1e2", "0.2.3"]) expect(() => parseRate(s)).toThrow();
    expect(() => parseRate("10.01")).toThrow(/too large/);
  });
});

describe("yearFraction (issue date included, maturity excluded)", () => {
  it("a full common Jalali year is 365 days of 1/365", () => {
    expect(yearFraction(J("1404/01/01"), J("1405/01/01"))).toEqual({ days365: 365, days366: 0, totalDays: 365 });
  });
  it("a full leap Jalali year is 366 days of 1/366", () => {
    expect(yearFraction(J("1403/01/01"), J("1404/01/01"))).toEqual({ days365: 0, days366: 366, totalDays: 366 });
  });
  it("splits a period that crosses Nowruz", () => {
    // 1403/07/01 .. 1403/12/30 = 6 × 30 = 180 days in leap 1403; 1404/01/01 .. 1404/06/31 = 186 days in common 1404
    expect(yearFraction(J("1403/07/01"), J("1404/07/01"))).toEqual({ days365: 186, days366: 180, totalDays: 366 });
  });
  it("spans several years", () => {
    const yf = yearFraction(J("1402/06/15"), J("1405/06/15"));
    expect(yf.days365 + yf.days366).toBe(yf.totalDays);
    expect(yf.days366).toBe(366); // all of 1403
  });
  it("rejects zero or negative periods", () => {
    expect(() => yearFraction("2025-01-01", "2025-01-01")).toThrow();
    expect(() => yearFraction("2025-01-02", "2025-01-01")).toThrow();
  });
});

describe("returnPerUnit — rounding down to the rial", () => {
  it("one full common year returns exactly face × rate", () => {
    expect(returnPerUnit({ faceValuePerUnit: FACE, annualRate: "0.23", issueDate: J("1404/01/01"), maturityDate: J("1405/01/01") })).toBe(23_000_000n);
  });
  it("one full leap year also returns exactly face × rate (366 days of 1/366)", () => {
    expect(returnPerUnit({ faceValuePerUnit: FACE, annualRate: "23%", issueDate: J("1403/01/01"), maturityDate: J("1404/01/01") })).toBe(23_000_000n);
  });
  it("period crossing Nowruz: 180/366 + 186/365 of a year", () => {
    // floor(100,000,000 × 0.23 × (180/366 + 186/365)) = 23,032,023 (checked independently with exact fractions)
    expect(returnPerUnit({ faceValuePerUnit: FACE, annualRate: "0.23", issueDate: J("1403/07/01"), maturityDate: J("1404/07/01") })).toBe(23_032_023n);
  });
  it("a one-day series in a common year", () => {
    // floor(23,000,000 / 365) = 63,013
    expect(returnPerUnit({ faceValuePerUnit: FACE, annualRate: "0.23", issueDate: J("1404/05/10"), maturityDate: J("1404/05/11") })).toBe(63_013n);
  });
  it("zero rate returns zero", () => {
    expect(returnPerUnit({ faceValuePerUnit: FACE, annualRate: "0", issueDate: J("1404/01/01"), maturityDate: J("1405/01/01") })).toBe(0n);
  });
  it("very large face values do not overflow or lose precision", () => {
    const face = 10n ** 18n;
    const r = returnPerUnit({ faceValuePerUnit: face, annualRate: "0.35", issueDate: J("1404/01/01"), maturityDate: J("1405/01/01") });
    expect(r).toBe(35n * 10n ** 16n);
  });
  it("rejects a non-positive face value", () => {
    expect(() => returnPerUnit({ faceValuePerUnit: 0n, annualRate: "0.2", issueDate: "2025-01-01", maturityDate: "2026-01-01" })).toThrow();
  });
});

describe("schedule and payouts", () => {
  const terms = { faceValuePerUnit: FACE, annualRate: "0.23", issueDate: J("1405/08/15"), maturityDate: J("1406/08/15") };

  it("builds a single bullet row at maturity", () => {
    const s = buildSchedule(terms);
    expect(s).toHaveLength(1);
    expect(s[0].dueDate).toBe(terms.maturityDate);
    expect(s[0].principalPerUnit).toBe(FACE);
    expect(s[0].totalPerUnit).toBe(FACE + s[0].returnPerUnit);
  });

  it("holder payout is per-unit amounts × units (never fractional)", () => {
    const [row] = buildSchedule(terms);
    const p = holderPayout(row, 10n);
    expect(p.principal).toBe(1_000_000_000n);
    expect(p.total).toBe(row.totalPerUnit * 10n);
    expect(p.principal + p.ret).toBe(p.total);
    expect(() => holderPayout(row, -1n)).toThrow();
  });

  it("issuer due equals the sum of all holders' payouts", () => {
    const schedule = buildSchedule(terms);
    const holdings = [600n, 400n, 300n, 120n, 50n, 330n];
    const issued = holdings.reduce((a, b) => a + b, 0n);
    const due = issuerDue(schedule, issued)[0].amount;
    const sum = holdings.map((u) => holderPayout(schedule[0], u).total).reduce((a, b) => a + b, 0n);
    expect(due).toBe(sum);
  });
});
