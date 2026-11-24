/**
 * Credit limit (حد اعتباری) — the fund's scoring method, re-implemented from its workbook
 * (sheets «گزارش ارزیابی» and «تحلیل مالی»). Spec: plan/07-case-file-and-credit-scoring.md §5, §7, §8.
 *
 * Units: all amounts are in MILLION RIALS, as in the workbook. The method multiplies amounts by
 * real coefficients (β, Rc, Ra, Re, Cp, Cr), so it works in IEEE doubles exactly like the spreadsheet;
 * `toRials` converts a result to bigint rials when it is stored or shown.
 *
 * Differences from the workbook, all decided in doc 07:
 *  - D-C5 / W2: the norm-usage deduction divides by (Ra × Re), not (Ra + Re).
 *  - W4: the Cr matrix uses "≤ −0.25" for the lowest band everywhere (one cell used "< −0.25").
 *  - W5: a missing activity type or a zero denominator the method needs is an error, not #DIV/0!.
 *  - W9: "profit base" (سود مبنا) is dropped.
 * Ratios that only inform the report return null instead of an error when the denominator is 0.
 */

// ------------------------------------------------------------------ inputs (doc 07 §5)

/** One fiscal year of the financial summary, in million rials, exactly the workbook's input cells. */
export interface FinancialYear {
  // assets (E5:E17)
  cash: number;               // موجودی نقد و بانک
  shortInvestments: number;   // سرمایه‌گذاری‌های کوتاه‌مدت
  receivables: number;        // اسناد و حساب‌های دریافتنی
  otherReceivables: number;   // سایر اسناد و حساب‌های دریافتنی
  inventory: number;          // موجودی کالا
  prepayments: number;        // پیش پرداخت‌ها
  otherCurrentAssets: number; // سایر دارایی‌های جاری
  tangibleFixed: number;      // دارایی‌های ثابت مشهود
  intangible: number;         // دارایی‌های ثابت نامشهود
  longInvestments: number;    // سرمایه گذاری‌ها و مشارکت‌های بلندمدت
  otherNonCurrent: number;    // سایر دارایی‌های غیرجاری
  partnersCurrentAsset: number; // جاری شرکاء (asset side)
  // liabilities and equity (K5:K17)
  payables: number;           // اسناد و حساب‌های پرداختنی
  otherPayables: number;      // سایر اسناد و حساب‌های پرداختنی
  shortLoans: number;         // تسهیلات کوتاه مدت
  advancesReceived: number;   // پیش دریافت‌ها
  otherCurrentLiabilities: number; // سایر بدهی‌های جاری
  longLoans: number;          // تسهیلات بلند مدت
  longLiabilities: number;    // بدهی‌های بلند مدت
  partnersCurrentEquity: number; // جاری شرکاء (equity side)
  reserves: number;           // اندوخته و ذخایر
  capital: number;            // سرمایه
  retainedEarnings: number;   // سود و زیان انباشته
  // profit and loss (S5:S13)
  sales: number;              // فروش خالص و درآمد ارائه خدمات و سایر درآمدها
  cogs: number;               // بهای تمام شده کالای فروش رفته و خدمات
  sga: number;                // هزینه‌های فروش، اداری و عمومی
  otherOperatingNet: number;  // سایر درآمدها (هزینه‌های) عملیاتی — subtracted, as in the workbook
  financialCosts: number;     // هزینه‌های مالی
  nonOperatingExpenses: number; // هزینه‌های غیرعملیاتی
  nonOperatingIncome: number; // درآمدهای غیرعملیاتی
}

export const FINANCIAL_FIELDS = [
  "cash", "shortInvestments", "receivables", "otherReceivables", "inventory", "prepayments", "otherCurrentAssets",
  "tangibleFixed", "intangible", "longInvestments", "otherNonCurrent", "partnersCurrentAsset",
  "payables", "otherPayables", "shortLoans", "advancesReceived", "otherCurrentLiabilities", "longLoans", "longLiabilities",
  "partnersCurrentEquity", "reserves", "capital", "retainedEarnings",
  "sales", "cogs", "sga", "otherOperatingNet", "financialCosts", "nonOperatingExpenses", "nonOperatingIncome",
] as const satisfies readonly (keyof FinancialYear)[];

export type ActivityType =
  | "production_contracting"  // تولیدی - پیمانکاری
  | "production_line"         // تولیدی - خط تولید
  | "production_trading"      // تولیدی - بازرگانی
  | "services_contracting"    // خدماتی - پیمانکاری
  | "trading_contracting";    // بازرگانی - پیمانکاری

export const ACTIVITY_TYPES = ["production_contracting", "production_line", "production_trading", "services_contracting", "trading_contracting"] as const satisfies readonly ActivityType[];

export type CollateralClass = "cheque" | "mortgage_2" | "mortgage_1";
export const COLLATERAL_CLASSES: readonly CollateralClass[] = ["cheque", "mortgage_2", "mortgage_1"];

// ------------------------------------------------------------------ method (versioned config, doc 07 §9)

/** Five bands, highest first: band 5 if x > b[0], band 4 if b[1] < x ≤ b[0], … band 1 if x ≤ b[3]. */
export type Bands = readonly [number, number, number, number];

export interface ScoringMethod {
  version: number;
  beta: Record<ActivityType, { guarantee: number; facility: number }>;
  /** matrix[row band 5..1][column band 5..1] (index 0 = band 5). Same table for Cp and Cr. */
  matrix: readonly (readonly number[])[];
  growthBands: Bands;   // Cp rows: average sales growth
  marginBands: Bands;   // Cp columns: average profit-to-sales
  c1Bands: Bands;       // Cr rows: (current assets − current liabilities) ÷ sales
  c2Bands: Bands;       // Cr columns: equity ÷ sales
  collateral: Record<CollateralClass, number>;
  /** Weights of Y0, Y-1, Y-2 in the average profit-to-sales. */
  marginWeights: readonly [number, number, number];
  /** Crl = clamp(a − b × debt-to-assets of Y0, 0, 1). */
  crl: { a: number; b: number };
  /** Income tax on profit before tax (used only for net profit in the report; W6: not floored). */
  taxRate: number;
  /** Collateral class whose guarantee ceiling is the announced credit limit (D-C2). */
  limitCollateral: CollateralClass;
}

export const DEFAULT_SCORING_METHOD: ScoringMethod = {
  version: 1,
  beta: {
    production_contracting: { guarantee: 15, facility: 12 },
    production_line: { guarantee: 15, facility: 12 },
    production_trading: { guarantee: 12, facility: 11 },
    services_contracting: { guarantee: 12, facility: 11 },
    trading_contracting: { guarantee: 7, facility: 10 },
  },
  matrix: [
    [1.0, 0.8, 0.6, 0.4, 0.2],
    [0.8, 0.7, 0.5, 0.3, 0.1],
    [0.6, 0.5, 0.4, 0.2, 0],
    [0.4, 0.3, 0.2, 0.1, 0],
    [0.2, 0.1, 0, 0, 0],
  ],
  growthBands: [1, 0.5, 0, -0.5],
  marginBands: [0.2, 0.1, 0, -0.1],
  c1Bands: [0.5, 0.25, 0, -0.25],
  c2Bands: [0.5, 0.25, 0, -0.25],
  collateral: { cheque: 0.4, mortgage_2: 0.6, mortgage_1: 1.0 },
  marginWeights: [0.5, 0.3, 0.2],
  crl: { a: 1.5, b: 1.25 },
  taxRate: 0.25,
  limitCollateral: "cheque",
};

/** Checks a method before it is saved as a new version. Returns a list of problems (empty = valid). */
export function validateScoringMethod(m: ScoringMethod): string[] {
  const errs: string[] = [];
  const unit = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
  if (!Number.isInteger(m.version) || m.version < 1) errs.push("version must be a positive integer");
  for (const [k, b] of Object.entries(m.beta)) if (!(b.guarantee >= 0) || !(b.facility >= 0)) errs.push(`beta.${k} must be >= 0`);
  if (m.matrix.length !== 5 || m.matrix.some((r) => r.length !== 5 || r.some((v) => !unit(v)))) errs.push("matrix must be 5×5 with values in 0..1");
  for (const [name, b] of Object.entries({ growthBands: m.growthBands, marginBands: m.marginBands, c1Bands: m.c1Bands, c2Bands: m.c2Bands }))
    if (b.length !== 4 || !(b[0] > b[1] && b[1] > b[2] && b[2] > b[3])) errs.push(`${name} must be 4 strictly decreasing thresholds`);
  for (const c of COLLATERAL_CLASSES) if (!(m.collateral[c] > 0)) errs.push(`collateral.${c} must be > 0`);
  const w = m.marginWeights;
  if (w.length !== 3 || w.some((x) => !unit(x)) || Math.abs(w[0] + w[1] + w[2] - 1) > 1e-9) errs.push("marginWeights must be three weights summing to 1");
  if (!unit(m.taxRate)) errs.push("taxRate must be in 0..1");
  return errs;
}

// ------------------------------------------------------------------ statements and ratios

export interface Statement extends FinancialYear {
  currentAssets: number;
  fixedAssets: number;
  totalAssets: number;
  currentLiabilities: number;
  totalLiabilities: number;
  equity: number;
  totalLiabilitiesAndEquity: number;
  /** total assets − (liabilities + equity); must be 0 to submit (doc 07 §5). */
  balanceDifference: number;
  workingCapital: number;
  grossProfit: number;
  operatingProfit: number;
  profitBeforeTax: number;
  tax: number;
  netProfit: number;
}

export function statement(y: FinancialYear, taxRate = DEFAULT_SCORING_METHOD.taxRate): Statement {
  const currentAssets = y.cash + y.shortInvestments + y.receivables + y.otherReceivables + y.inventory + y.prepayments + y.otherCurrentAssets;
  const fixedAssets = y.tangibleFixed + y.intangible + y.longInvestments + y.otherNonCurrent + y.partnersCurrentAsset;
  const totalAssets = currentAssets + fixedAssets;
  const currentLiabilities = y.payables + y.otherPayables + y.shortLoans + y.advancesReceived + y.otherCurrentLiabilities;
  const totalLiabilities = y.longLiabilities + y.longLoans + currentLiabilities;
  const equity = y.partnersCurrentEquity + y.reserves + y.capital + y.retainedEarnings;
  const totalLiabilitiesAndEquity = totalLiabilities + equity;
  const grossProfit = y.sales - y.cogs;
  const operatingProfit = grossProfit - y.sga - y.otherOperatingNet;
  const profitBeforeTax = operatingProfit - y.financialCosts - y.nonOperatingExpenses + y.nonOperatingIncome;
  const tax = profitBeforeTax * taxRate;
  return {
    ...y, currentAssets, fixedAssets, totalAssets, currentLiabilities, totalLiabilities, equity, totalLiabilitiesAndEquity,
    balanceDifference: totalAssets - totalLiabilitiesAndEquity, workingCapital: currentAssets - currentLiabilities,
    grossProfit, operatingProfit, profitBeforeTax, tax, netProfit: profitBeforeTax - tax,
  };
}

/** a ÷ b, or null when b is 0 (the workbook shows #DIV/0!). */
const div = (a: number, b: number): number | null => (b === 0 || !Number.isFinite(b) ? null : a / b);

/** The scoring ratios of sheet «گزارش ارزیابی» (rows 22–31), one year. */
export interface ScoringRatios {
  profitability: number | null;     // profit before tax ÷ sales
  returnOnAssets: number | null;    // profit before tax ÷ total assets
  interestCoverage: number | null;  // operating profit ÷ financial costs
  currentRatio: number | null;
  quickRatio: number | null;        // (cash + short investments + receivables + other receivables) ÷ current liabilities
  debtToAssets: number | null;
  equityRatio: number | null;
  collectionMonths: number | null;  // (receivables + other receivables) ÷ (sales ÷ 12)
  inventoryMonths: number | null;   // inventory × 12 ÷ cost of goods sold
  assetTurnover: number | null;
}

export function scoringRatios(s: Statement): ScoringRatios {
  const salesPerMonth = div(s.sales, 12);
  return {
    profitability: div(s.profitBeforeTax, s.sales),
    returnOnAssets: div(s.profitBeforeTax, s.totalAssets),
    interestCoverage: div(s.operatingProfit, s.financialCosts),
    currentRatio: div(s.currentAssets, s.currentLiabilities),
    quickRatio: div(s.cash + s.shortInvestments + s.receivables + s.otherReceivables, s.currentLiabilities),
    debtToAssets: div(s.totalLiabilities, s.totalAssets),
    equityRatio: div(s.equity, s.totalAssets),
    collectionMonths: salesPerMonth === null ? null : div(s.receivables + s.otherReceivables, salesPerMonth),
    inventoryMonths: div(s.inventory * 12, s.cogs),
    assetTurnover: div(s.sales, s.totalAssets),
  };
}

/** Sheet «تحلیل مالی»: the analysis shown next to the score (W7: these definitions are for display only). */
export interface FinancialAnalysis {
  years: {
    currentRatio: number | null; quickRatio: number | null; currentAssetsToTotal: number | null; debtToAssets: number | null;
    debtToEquity: number | null; currentLiabilitiesToEquity: number | null; fixedAssetsToEquity: number | null; equityRatio: number | null;
    interestCoverage: number | null; cogsToSales: number | null; grossMargin: number | null; netMargin: number | null;
    returnOnAssets: number | null; returnOnEquity: number | null; leverageBenefit: number | null; assetTurnover: number | null;
    collectionMonths: number | null; inventoryMonths: number | null; operatingCycleMonths: number | null; inventoryToWorkingCapital: number | null;
  }[];
  /** Year-on-year change, latest first: [Y0 vs Y-1, Y-1 vs Y-2]. */
  trends: { sales: number | null; operatingProfit: number | null; equity: number | null; workingCapital: number | null }[];
  /** Y0 vs Y-1: change and % change. */
  horizontal: Record<"currentAssets" | "fixedAssets" | "currentLiabilities" | "nonCurrentLiabilities" | "equity" | "totalAssets", { y0: number; y1: number; change: number; pct: number | null }>;
  /** Index of each line vs Y-2 (= 1), per year latest first. */
  index: Record<"currentAssets" | "fixedAssets" | "currentLiabilities" | "nonCurrentLiabilities" | "totalLiabilities" | "equity" | "totalAssets", (number | null)[]>;
  /** Common-size: each line ÷ total assets, per year latest first. */
  commonSize: Record<"currentAssets" | "fixedAssets" | "currentLiabilities" | "nonCurrentLiabilities" | "totalLiabilities" | "equity", (number | null)[]>;
}

export function financialAnalysis(st: readonly Statement[]): FinancialAnalysis {
  const nonCur = (s: Statement) => s.longLoans + s.longLiabilities;
  const years = st.map((s) => {
    const roa = div(s.netProfit, s.totalAssets);
    const roe = div(s.netProfit, s.equity);
    const coll = div((s.receivables + s.otherReceivables) * 12, s.sales);
    const inv = div(s.inventory * 12, s.cogs);
    return {
      currentRatio: div(s.currentAssets, s.currentLiabilities),
      quickRatio: div(s.currentAssets - (s.inventory + s.prepayments), s.currentLiabilities),
      currentAssetsToTotal: div(s.currentAssets, s.totalAssets),
      debtToAssets: div(s.totalLiabilities, s.totalAssets),
      debtToEquity: div(s.totalLiabilities, s.equity),
      currentLiabilitiesToEquity: div(s.currentLiabilities, s.equity),
      fixedAssetsToEquity: div(s.fixedAssets, s.equity),
      equityRatio: div(s.equity, s.totalAssets),
      interestCoverage: div(s.operatingProfit, s.financialCosts),
      cogsToSales: div(s.cogs, s.sales),
      grossMargin: div(s.grossProfit, s.sales),
      netMargin: div(s.netProfit, s.sales),
      returnOnAssets: roa,
      returnOnEquity: roe,
      leverageBenefit: roe === null || roa === null ? null : div(roe, roa),
      assetTurnover: div(s.sales, s.totalAssets),
      collectionMonths: coll,
      inventoryMonths: inv,
      operatingCycleMonths: coll === null || inv === null ? null : inv + coll,
      inventoryToWorkingCapital: div(s.inventory, s.workingCapital),
    };
  });
  const ch = (a: number, b: number) => div(a - b, b);
  const trends = [0, 1].filter((i) => st[i + 1]).map((i) => ({
    sales: ch(st[i].sales, st[i + 1].sales),
    operatingProfit: ch(st[i].operatingProfit, st[i + 1].operatingProfit),
    equity: ch(st[i].equity, st[i + 1].equity),
    workingCapital: div(st[i].workingCapital, st[i + 1].workingCapital), // the workbook divides, it does not subtract
  }));
  const [a, b] = st;
  const h = (x: number, y: number) => ({ y0: x, y1: y, change: x - y, pct: div(x - y, y) });
  const horizontal = {
    currentAssets: h(a.currentAssets, b.currentAssets), fixedAssets: h(a.fixedAssets, b.fixedAssets),
    currentLiabilities: h(a.currentLiabilities, b.currentLiabilities), nonCurrentLiabilities: h(nonCur(a), nonCur(b)),
    equity: h(a.equity, b.equity), totalAssets: h(a.totalAssets, b.totalAssets),
  };
  const base = st[st.length - 1];
  const idx = (f: (s: Statement) => number) => st.map((s) => div(f(s), f(base)));
  const cs = (f: (s: Statement) => number) => st.map((s) => div(f(s), s.totalAssets));
  return {
    years, trends, horizontal,
    index: {
      currentAssets: idx((s) => s.currentAssets), fixedAssets: idx((s) => s.fixedAssets), currentLiabilities: idx((s) => s.currentLiabilities),
      nonCurrentLiabilities: idx(nonCur), totalLiabilities: idx((s) => s.totalLiabilities), equity: idx((s) => s.equity), totalAssets: idx((s) => s.totalAssets),
    },
    commonSize: {
      currentAssets: cs((s) => s.currentAssets), fixedAssets: cs((s) => s.fixedAssets), currentLiabilities: cs((s) => s.currentLiabilities),
      nonCurrentLiabilities: cs(nonCur), totalLiabilities: cs((s) => s.totalLiabilities), equity: cs((s) => s.equity),
    },
  };
}

// ------------------------------------------------------------------ coefficients

/** Band 5..1 for a value (upper-inclusive bands, doc 07 §7.3). */
export function band(x: number, b: Bands): 1 | 2 | 3 | 4 | 5 {
  if (x > b[0]) return 5;
  if (x > b[1]) return 4;
  if (x > b[2]) return 3;
  if (x > b[3]) return 2;
  return 1;
}

export const matrixValue = (m: ScoringMethod, row: number, col: number) => m.matrix[5 - row][5 - col];

export class ScoringInputError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Cannot score: ${problems.join("; ")}`);
  }
}

/** Analyst inputs (doc 07 D-C4: set with a written reason until the fund's rubric exists). */
export interface Judgement {
  rc: number; // behavioural risk
  ra: number; // technical & operational
  re: number; // environment & market
}

export interface ScoringInput {
  activityType: ActivityType;
  /** Latest year first: [Y0, Y-1, Y-2]. */
  years: readonly [FinancialYear, FinancialYear, FinancialYear];
  guarantee: Judgement;
  /** The workbook has separate Rc/Ra/Re cells for short-term facilities (M24:M26); defaults to `guarantee`. */
  facility?: Judgement;
}

export interface CeilingSet {
  /** Before Ra × Re. */ norm: Record<CollateralClass, number>;
  /** Final. */ ceiling: Record<CollateralClass, number>;
}

export interface ScoringResult {
  methodVersion: number;
  statements: [Statement, Statement, Statement];
  ratios: [ScoringRatios, ScoringRatios, ScoringRatios];
  avgMargin: number;
  avgGrowth: number;
  guaranteeBase: number;  // net sales Y0
  facilityBase: number;   // max(working capital Y0, 0)
  c1: number;
  c2: number;
  bands: { growth: number; margin: number; c1: number; c2: number };
  coefficients: {
    betaGuarantee: number; betaFacility: number; cp: number; cr: number; crlRaw: number; crl: number;
    guarantee: Judgement; facility: Judgement;
  };
  guarantee: CeilingSet;
  /** Short-term facility: norm = base × β_f × Rc × Ra × Re × Cp × Crl × k; ceiling = min(norm, guarantee ceiling). */
  facility: CeilingSet;
  /** Company-level norm ceiling that the usage ledger draws down: sales × β × Rc × Cp × Cr × Cc(limit collateral). */
  normCeiling: number;
  /** D-C2: the announced credit limit = guarantee ceiling with the limit collateral (cheque and promissory note). */
  creditLimit: number;
}

function checkJudgement(j: Judgement, label: string, errs: string[]) {
  for (const k of ["rc", "ra", "re"] as const) {
    const v = j[k];
    if (!Number.isFinite(v) || v < 0 || v > 1) errs.push(`${label}.${k} must be between 0 and 1`);
  }
}

export function scoreCase(input: ScoringInput, method: ScoringMethod = DEFAULT_SCORING_METHOD): ScoringResult {
  const errs: string[] = [];
  const beta = method.beta[input.activityType];
  if (!beta) errs.push("activity type is required");
  if (input.years?.length !== 3) errs.push("three fiscal years are required (Q4: fewer years are not scored)");
  checkJudgement(input.guarantee, "guarantee", errs);
  const fj = input.facility ?? input.guarantee;
  if (input.facility) checkJudgement(input.facility, "facility", errs);
  if (errs.length) throw new ScoringInputError(errs);

  const st = input.years.map((y) => statement(y, method.taxRate)) as [Statement, Statement, Statement];
  const [s0, s1, s2] = st;
  st.forEach((s, i) => {
    if (s.sales === 0) errs.push(`sales of Y-${i} is zero`);
    // Negative net sales make every ratio and band meaningless (a loss over negative sales reads as a profit margin)
    // and flip the sign of every ceiling, so the "credit limit" came out negative. The workbook has no rule for it.
    else if (s.sales < 0) errs.push(`sales of Y-${i} is negative`);
  });
  if (s0.totalAssets === 0) errs.push("total assets of Y0 is zero");
  if (errs.length) throw new ScoringInputError(errs);

  const ratios = st.map(scoringRatios) as [ScoringRatios, ScoringRatios, ScoringRatios];
  const [w0, w1, w2] = method.marginWeights;
  const avgMargin = w0 * ratios[0].profitability! + w1 * ratios[1].profitability! + w2 * ratios[2].profitability!;
  const avgGrowth = ((s1.sales - s2.sales) / s2.sales + (s0.sales - s1.sales) / s1.sales) / 2;
  const guaranteeBase = s0.sales;
  const facilityBase = s0.workingCapital > 0 ? s0.workingCapital : 0;
  const c1 = s0.workingCapital / guaranteeBase;
  const c2 = s0.equity / guaranteeBase;

  const bands = { growth: band(avgGrowth, method.growthBands), margin: band(avgMargin, method.marginBands), c1: band(c1, method.c1Bands), c2: band(c2, method.c2Bands) };
  const cp = matrixValue(method, bands.growth, bands.margin);
  const cr = matrixValue(method, bands.c1, bands.c2);
  const crlRaw = method.crl.a - method.crl.b * ratios[0].debtToAssets!;
  const crl = crlRaw < 0 ? 0 : crlRaw > 1 ? 1 : crlRaw;

  const g = input.guarantee;
  const guarantee: CeilingSet = { norm: {} as any, ceiling: {} as any };
  const facility: CeilingSet = { norm: {} as any, ceiling: {} as any };
  for (const k of COLLATERAL_CLASSES) {
    const cc = method.collateral[k];
    // Same multiplication order as the workbook (Z10, Z11, F35) so results match to the last bit.
    guarantee.norm[k] = guaranteeBase * beta.guarantee * g.rc * cp * cr * cc;
    guarantee.ceiling[k] = guarantee.norm[k] * g.ra * g.re;
    facility.norm[k] = facilityBase * beta.facility * fj.rc * fj.ra * fj.re * cp * crl * cc;
    facility.ceiling[k] = facility.norm[k] > guarantee.ceiling[k] ? guarantee.ceiling[k] : facility.norm[k];
  }
  const normCeiling = guaranteeBase * beta.guarantee * g.rc * cp * cr * method.collateral[method.limitCollateral];

  return {
    methodVersion: method.version, statements: st, ratios, avgMargin, avgGrowth, guaranteeBase, facilityBase, c1, c2, bands,
    coefficients: { betaGuarantee: beta.guarantee, betaFacility: beta.facility, cp, cr, crlRaw, crl, guarantee: g, facility: fj },
    guarantee, facility, normCeiling, creditLimit: guarantee.ceiling[method.limitCollateral],
  };
}

// ------------------------------------------------------------------ norm usage ledger (doc 07 §7.5, D-C5)

export interface Usage {
  id: string;
  amount: number; // million rials
  ra: number;
  re: number;
  active: boolean;
}

export interface UsageRow extends Usage {
  remainingBefore: number;
  /** Largest amount this item could take given the norm left before it: remaining × Ra × Re. */
  ceiling: number;
  /** Norm consumed: amount ÷ (Ra × Re) while active, else 0 (D-C5). */
  deduction: number;
  remainingAfter: number;
}

export function usageLedger(normCeiling: number, usages: readonly Usage[]): { rows: UsageRow[]; used: number; remaining: number } {
  let remaining = normCeiling;
  const rows: UsageRow[] = [];
  for (const u of usages) {
    if (!(u.ra > 0 && u.ra <= 1 && u.re > 0 && u.re <= 1)) throw new ScoringInputError([`usage ${u.id}: Ra and Re must be in (0, 1]`]);
    if (!(u.amount >= 0)) throw new ScoringInputError([`usage ${u.id}: amount must be >= 0`]);
    const before = remaining;
    const deduction = u.active ? u.amount / (u.ra * u.re) : 0;
    remaining = before - deduction;
    rows.push({ ...u, remainingBefore: before, ceiling: before * u.ra * u.re, deduction, remainingAfter: remaining });
  }
  return { rows, used: normCeiling - remaining, remaining };
}

/**
 * Limit check for a new financing (doc 07 §9, S-11): the project's own Ra and Re against the norm left.
 * project ceiling = remaining norm × Ra × Re; the approved amount may not exceed it.
 */
export function limitCheck(normCeiling: number, usages: readonly Usage[], project: { ra: number; re: number; amount: number }) {
  const { remaining, used } = usageLedger(normCeiling, usages);
  const ceiling = Math.max(remaining, 0) * project.ra * project.re;
  return { remainingNorm: remaining, usedNorm: used, projectCeiling: ceiling, fits: project.amount <= ceiling + 1e-9, shortfall: Math.max(project.amount - ceiling, 0) };
}

/** Million rials → whole rials (nearest rial; inputs are in million rials, so finer precision is noise). */
export function toRials(millionRials: number): bigint {
  if (!Number.isFinite(millionRials)) throw new Error("not a finite amount");
  return BigInt(Math.round(millionRials * 1_000_000));
}
