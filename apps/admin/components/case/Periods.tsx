"use client";
import { ACTIVITY_FA, COLLATERAL_FA, dec, fa, pct, toman, tomanShort } from "@tp/ui";

export interface Period { fiscal_year: number; trial_balance: boolean; through_month: number | null; sales: string; margin: number | null; growth: number | null }
export interface Calc { credit_limit: string; guarantee: { ceiling: Record<string, string> }; facility: { ceiling: Record<string, string> }; avg_margin: number; avg_growth: number; periods?: Period[] }
const B_ERROR_FA: Record<string, string> = { "spring: no trial balance is accepted": "در بهار تراز آزمایشی پذیرفته نمی‌شود؛ فقط محاسبه‌ی الف", "trial balance missing": "تراز آزمایشی ثبت نشده است" };
const MONTH = ["", "", "", "خرداد", "", "", "شهریور", "", "", "آذر", "", "", "اسفند"];

/** Each period separately, the trial balance marked with the months it covers (it is not annualised) — for the committee. */
export function PeriodsTable({ periods }: { periods: Period[] }) {
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>دوره</th><th>فروش</th><th>حاشیه‌ی سود</th><th>رشد نسبت به دوره‌ی قبل</th></tr></thead>
      <tbody>{periods.map((p) => (
        <tr key={p.fiscal_year} style={p.trial_balance ? { background: "var(--warning-100)" } : undefined}>
          <td>{p.trial_balance ? <>تراز آزمایشی {fa(p.fiscal_year)}<div className="t-small t-muted">تا پایان {MONTH[p.through_month ?? 0] || "—"} ({fa(p.through_month ?? "—")} ماه، سالانه نشده)</div></> : <>صورت مالی {fa(p.fiscal_year)}</>}</td>
          <td className="num">{toman(p.sales)}</td><td>{pct(p.margin)}</td><td>{p.growth === null ? "—" : pct(p.growth)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** Guarantee and facility ceilings per collateral, side by side. */
export function CeilingsTable({ calc }: { calc: Calc }) {
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>وثیقه</th><th>سقف ضمانت‌نامه</th><th>سقف تسهیلات</th></tr></thead>
      <tbody>{(["cheque", "mortgage_2", "mortgage_1"] as const).map((k) => (
        <tr key={k}><td>{COLLATERAL_FA[k]}</td><td className="num" title={toman(calc.guarantee.ceiling[k])}>{tomanShort(calc.guarantee.ceiling[k])}</td><td className="num" title={toman(calc.facility.ceiling[k])}>{tomanShort(calc.facility.ceiling[k])}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

/** The two calculations next to each other, with the one in use marked. */
export function TwoCalcs({ a, b, chosen, bError }: { a: Calc; b: Calc | null; chosen: "a" | "b"; bError?: string[] | null }) {
  const box = (title: string, x: Calc | null, used: boolean, sub: string) => (
    <div className={`card ${used ? "card-highlight" : ""}`} style={{ flex: 1, minWidth: 260 }}>
      <div className="row-between"><strong>{title}</strong>{used && <span className="chip chip-success">مبنای حد</span>}</div>
      <p className="t-small t-muted">{sub}</p>
      {x ? (<>
        <div className="t-h1" title={toman(x.credit_limit)}>{tomanShort(x.credit_limit)}</div>
        <p className="t-small t-muted">رشد متوسط {pct(x.avg_growth)} — حاشیه‌ی سود وزنی {pct(x.avg_margin)}</p>
        {x.periods && <PeriodsTable periods={x.periods} />}
      </>) : <p className="t-muted">محاسبه نشد{bError?.length ? `: ${bError.map((e) => B_ERROR_FA[e] ?? e).join("، ")}` : ": تراز آزمایشی ثبت نشده است یا در بهار پذیرفته نمی‌شود."}</p>}
    </div>
  );
  return (
    <div className="row" style={{ alignItems: "stretch" }}>
      {box("محاسبه‌ی الف", a, chosen === "a", "چهار سال صورت مالی")}
      {box("محاسبه‌ی ب", b, chosen === "b", "تراز آزمایشی سال جاری + سه سال صورت مالی")}
    </div>
  );
}

export const activityFa = (k: string) => ACTIVITY_FA[k] ?? k;
export const coefs = (j: { rc: number; ra: number; re: number }) => `${dec(j.rc, 3)} / ${dec(j.ra, 3)} / ${dec(j.re, 3)}`;
