import { describe, expect, it } from "vitest";
import golden from "./fixtures/workbook-golden.json";
import {
  band, DEFAULT_SCORING_METHOD, financialAnalysis, FinancialYear, FINANCIAL_FIELDS, limitCheck, matrixValue, scoreCase, ScoringInput,
  ScoringInputError, statement, toRials, usageLedger, validateScoringMethod,
} from "../src/index.js";

const close = (actual: number | null, expected: number | null, label: string) => {
  if (expected === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  const tol = Math.max(1e-9, Math.abs(expected) * 1e-12);
  if (Math.abs((actual as number) - expected) > tol) expect(actual, label).toBe(expected);
};

const get = (o: any, path: string) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

describe("matches the fund's workbook cell by cell (40 random companies, recalculated by LibreOffice)", () => {
  for (const c of (golden as any).cases) {
    it(c.id, () => {
      const r = scoreCase(c.input as ScoringInput);
      const a = financialAnalysis(r.statements);
      const l = usageLedger(r.normCeiling, c.usages);
      const all = { ...r, analysis: a, ledger: l };
      for (const [name, expected] of Object.entries(c.expected as Record<string, number | null>)) {
        close(get(all, name) ?? null, expected, `${c.id} ${name}`);
      }
    });
  }
  it("covers enough of the method", () => {
    const cases = (golden as any).cases;
    const cells = cases.reduce((n: number, c: any) => n + Object.keys(c.expected).length, 0);
    expect(cases.length).toBe(40);
    expect(cells).toBeGreaterThan(9000);
    expect(new Set(cases.map((c: any) => c.expected["coefficients.cp"])).size).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map((c: any) => c.input.activityType)).size).toBe(5);
  });
});

// doc 07 §7.7 — the sample company on the screens
const zero = Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, 0])) as unknown as FinancialYear;
const year = (sales: number, pbt: number): FinancialYear => ({
  ...zero, cash: 116_000, tangibleFixed: 141_500, payables: 60_000, longLoans: 62_500, capital: 135_000, sales, cogs: sales - pbt,
});
const sample: ScoringInput = {
  activityType: "production_line",
  years: [year(310_000, 40_500), year(205_000, 21_700), year(138_000, 12_500)],
  guarantee: { rc: 0.9, ra: 0.8, re: 0.7 },
};

describe("worked example (plan/07 §7.7)", () => {
  const r = scoreCase(sample);
  it("bands and coefficients", () => {
    expect(r.avgGrowth).toBeCloseTo(0.499, 3);
    expect(r.avgMargin).toBeCloseTo(0.115, 3);
    expect(r.bands).toEqual({ growth: 3, margin: 4, c1: 3, c2: 4 });
    expect(r.coefficients).toMatchObject({ cp: 0.5, cr: 0.5, betaGuarantee: 15, betaFacility: 12 });
    expect(r.coefficients.crl).toBeCloseTo(0.905, 3);
  });
  it("ceilings per collateral, and the credit limit", () => {
    expect(r.guarantee.ceiling.cheque).toBeCloseTo(234_360, 6);
    expect(r.guarantee.ceiling.mortgage_2).toBeCloseTo(351_540, 6);
    expect(r.guarantee.ceiling.mortgage_1).toBeCloseTo(585_900, 6);
    expect(Math.round(r.facility.ceiling.cheque)).toBe(61_326);
    expect(Math.round(r.facility.ceiling.mortgage_2)).toBe(91_988);
    expect(Math.round(r.facility.ceiling.mortgage_1)).toBe(153_314);
    expect(r.normCeiling).toBeCloseTo(418_500, 6);
    expect(r.creditLimit).toBe(r.guarantee.ceiling.cheque);
    expect(toRials(r.creditLimit)).toBe(234_360_000_000n);
  });
  it("usage ledger and limit check (D-C5: amount ÷ (Ra × Re))", () => {
    const used = [{ id: "g1", amount: 60_000, ra: 0.8, re: 0.7, active: true }];
    const l = usageLedger(r.normCeiling, used);
    expect(l.rows[0].deduction).toBeCloseTo(107_142.857, 3);
    expect(l.remaining).toBeCloseTo(311_357.143, 3);
    const chk = limitCheck(r.normCeiling, used, { ra: 0.8, re: 0.7, amount: 174_360 });
    expect(chk.projectCeiling).toBeCloseTo(174_360, 6); // = 234,360 − 60,000
    expect(chk.fits).toBe(true);
    const over = limitCheck(r.normCeiling, used, { ra: 0.8, re: 0.7, amount: 180_000 });
    expect(over.fits).toBe(false);
    expect(over.shortfall).toBeCloseTo(5_640, 6);
    // a cancelled guarantee releases its deduction
    expect(usageLedger(r.normCeiling, [{ ...used[0], active: false }]).remaining).toBeCloseTo(418_500, 6);
    // a riskier project gets less from the same remaining norm
    expect(limitCheck(r.normCeiling, used, { ra: 0.5, re: 0.5, amount: 1 }).projectCeiling).toBeCloseTo(77_839.29, 2);
  });
  it("facility coefficients can differ from the guarantee ones (workbook M24:M26)", () => {
    const r2 = scoreCase({ ...sample, facility: { rc: 0.5, ra: 0.5, re: 0.5 } });
    expect(r2.guarantee.ceiling.cheque).toBeCloseTo(234_360, 6);
    expect(r2.facility.norm.cheque).toBeCloseTo(56_000 * 12 * 0.125 * 0.5 * r2.coefficients.crl * 0.4, 6);
  });
});

describe("bands and the matrix", () => {
  it("upper-inclusive bands", () => {
    const b = DEFAULT_SCORING_METHOD.growthBands;
    expect([1.0001, 1, 0.5, 0.0001, 0, -0.5, -0.50001].map((x) => band(x, b))).toEqual([5, 4, 3, 3, 2, 1, 1]);
  });
  it("W4: C1 above 0.5 with C2 exactly −0.25 gives 0.2 (the workbook gives 0)", () => {
    const m = DEFAULT_SCORING_METHOD;
    expect(matrixValue(m, band(0.6, m.c1Bands), band(-0.25, m.c2Bands))).toBe(0.2);
  });
  it("the matrix is the one in doc 07", () => {
    const m = DEFAULT_SCORING_METHOD;
    expect(matrixValue(m, 5, 5)).toBe(1);
    expect(matrixValue(m, 4, 4)).toBe(0.7);
    expect(matrixValue(m, 3, 1)).toBe(0);
    expect(matrixValue(m, 1, 5)).toBe(0.2);
  });
});

describe("refuses what the workbook would turn into #VALUE! / #DIV/0! (W5)", () => {
  it("missing activity type, bad coefficients, zero sales", () => {
    expect(() => scoreCase({ ...sample, activityType: "" as any })).toThrow(ScoringInputError);
    expect(() => scoreCase({ ...sample, guarantee: { rc: 1.2, ra: 0.8, re: 0.7 } })).toThrow(/guarantee.rc/);
    const noSales: ScoringInput = { ...sample, years: [sample.years[0], sample.years[1], { ...sample.years[2], sales: 0, cogs: 0 }] };
    try {
      scoreCase(noSales);
      throw new Error("should fail");
    } catch (e) {
      expect((e as ScoringInputError).problems).toEqual(["sales of Y-2 is zero"]);
    }
  });
  it("usage needs Ra and Re above zero", () => {
    expect(() => usageLedger(100, [{ id: "x", amount: 1, ra: 0, re: 0.5, active: true }])).toThrow(/Ra and Re/);
  });
});

describe("statements", () => {
  it("computes totals and the balance check", () => {
    const s = statement(sample.years[0]);
    expect(s).toMatchObject({ currentAssets: 116_000, currentLiabilities: 60_000, workingCapital: 56_000, totalAssets: 257_500, totalLiabilities: 122_500, equity: 135_000, balanceDifference: 0, profitBeforeTax: 40_500, tax: 10_125, netProfit: 30_375 });
    expect(statement({ ...sample.years[0], cash: 116_001 }).balanceDifference).toBe(1);
  });
});

describe("scoring method versions", () => {
  it("the default is valid; broken ones are reported", () => {
    expect(validateScoringMethod(DEFAULT_SCORING_METHOD)).toEqual([]);
    const bad = { ...DEFAULT_SCORING_METHOD, marginWeights: [0.5, 0.3, 0.3] as const, growthBands: [1, 1, 0, -0.5] as const };
    expect(validateScoringMethod(bad)).toEqual(["growthBands must be 4 strictly decreasing thresholds", "marginWeights must be three weights summing to 1"]);
  });
  it("a method change flows into the result", () => {
    const m = { ...DEFAULT_SCORING_METHOD, version: 2, collateral: { ...DEFAULT_SCORING_METHOD.collateral, cheque: 0.5 } };
    const r = scoreCase(sample, m);
    expect(r.methodVersion).toBe(2);
    expect(r.creditLimit).toBeCloseTo(234_360 * 1.25, 6);
  });
});
