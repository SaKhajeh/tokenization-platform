"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FINANCIAL_FIELDS, statement } from "@tp/domain/creditScoring";
import { financialPeriods, toFinancialYear, trialBalancePeriod } from "@tp/domain/caseFile";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, FIN_GROUPS, FIN_TOTALS, STATEMENT_TYPE_FA, Tabs, Toast, fa, latin, millions } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";
import { EDITABLE, type Case } from "@/lib/case";

type Year = { statement_type: string; figures: Record<string, string> };
const empty = (): Year => ({ statement_type: "", figures: Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, ""])) });
const INT = /^-?(0|[1-9]\d{0,14})$/;

/** Doc 07 §5 and §13.2: the current-year trial balance and four years of statements, in whole million rials; each must balance. */
export default function FinancialsPage() {
  const api = useApi();
  const { org } = useMe();
  const cs = useQuery(org ? `case:${org.id}` : null, () => api.get<Case>("/case"));
  const c = cs.data;
  const years = c ? financialPeriods(c.latest_fiscal_year) : [];
  const tbYear = c ? c.latest_fiscal_year + 1 : 0;
  const tb = trialBalancePeriod(new Date(Date.now() + 3.5 * 3600_000).toISOString().slice(0, 10));
  const head = (y: number) => (y === tbYear ? "تراز آزمایشی" : `سال ${fa(y)}`);
  const [vals, setVals] = useState<Record<number, Year>>({});
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [yi, setYi] = useState(0); // on a phone one year is shown at a time

  useEffect(() => {
    if (!c) return;
    const v: Record<number, Year> = {};
    for (const y of financialPeriods(c.latest_fiscal_year)) {
      const row = c.financials.find((f) => f.fiscal_year === y);
      v[y] = row?.declared ? { statement_type: row.statement_type ?? "", figures: { ...empty().figures, ...row.declared } } : empty();
    }
    setVals(v);
    setDirty(new Set());
  }, [c]);

  const save = useAction(async () => {
    for (const y of dirty) {
      const v = vals[y];
      // blanks are saved as 0 so a draft can be kept; the submission check needs every year balanced
      const figures = Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, INT.test(v.figures[k]) ? v.figures[k] : "0"]));
      await api.put(`/case/financials/${y}`, { statement_type: y === tbYear ? "trial_balance" : v.statement_type || "audited", figures });
    }
    cs.reload();
    setToast("ذخیره شد");
  });
  const editable = !!c && EDITABLE.includes(c.state) && ["org_admin", "preparer"].includes(org?.my_role ?? "");
  const totals = (y: number) => {
    const f = vals[y]?.figures;
    if (!f) return null;
    return statement(toFinancialYear(Object.fromEntries(Object.entries(f).map(([k, x]) => [k, INT.test(x) ? x : "0"]))));
  };
  const setFig = (y: number, k: string, x: string) => {
    setVals((v) => ({ ...v, [y]: { ...v[y], figures: { ...v[y].figures, [k]: latin(x).replace(/[^\d-]/g, "") } } }));
    setDirty((d) => new Set(d).add(y));
  };

  return (
    <Shell title="خلاصه‌ی صورت‌های مالی">
      <div className="stack">
        <Link href="/case">← بازگشت به پرونده</Link>
        <p className="t-muted">ارقام <strong>چهار سال اخیر</strong> را به <strong>میلیون ریال</strong> و بدون اعشار، مطابق صورت مالی حسابرسی‌شده یا اظهارنامه وارد کنید. زیان را با علامت منفی بنویسید.</p>
        <p className="t-small t-muted">ستون اول، ارقام تراز آزمایشی سال جاری ({fa(tb.label)}) است؛ ارقام همان دوره را بدون تبدیل به سالانه وارد کنید. صندوق حد را یک بار با چهار سال صورت مالی و یک بار با تراز آزمایشی و سه سال اخیر محاسبه می‌کند.</p>
        <ErrorBanner error={cs.error} />
        {c && (
          <Card>
            <div className="phone-only" style={{ marginBottom: 8 }}>
              <Tabs tabs={years.map((y, i) => [String(i), head(y)] as [string, string])} value={String(yi)} onChange={(v) => setYi(Number(v))} />
            </div>
            <div className="table-wrap">
              <table className="table fin-table">
                <thead>
                  <tr><th>قلم</th>{years.map((y, i) => <th key={y} className={i !== yi ? "yr-other" : undefined}>{head(y)}{y === tbYear && <div className="t-small t-muted" style={{ fontWeight: 400 }}>{fa(tb.label)}</div>}</th>)}</tr>
                  <tr><td>نوع صورت مالی</td>{years.map((y, i) => (
                    <td key={y} className={i !== yi ? "yr-other" : undefined}>
                      {y === tbYear ? <span className="t-small">تراز آزمایشی شش‌ستونی</span> : <select className="select" value={vals[y]?.statement_type ?? ""} disabled={!editable} aria-label={`نوع صورت مالی ${y}`}
                        onChange={(e) => { setVals((v) => ({ ...v, [y]: { ...v[y], statement_type: e.target.value } })); setDirty((d) => new Set(d).add(y)); }}>
                        <option value="" disabled>انتخاب</option>
                        {Object.entries(STATEMENT_TYPE_FA).filter(([k]) => k !== "balance_sheet" && k !== "trial_balance").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>}
                    </td>
                  ))}</tr>
                </thead>
                <tbody>
                  {FIN_GROUPS.map(([g, rows]) => (
                    <FragmentRows key={g} title={g} cols={years.length + 1}>
                      {rows.map(([k, label]) => (
                        <tr key={k}>
                          <td>{label}</td>
                          {years.map((y, i) => (
                            <td key={y} className={i !== yi ? "yr-other" : undefined}><input className="input" aria-label={`${label} ${y}`} inputMode="numeric" disabled={!editable} value={vals[y]?.figures[k] ?? ""} onChange={(e) => setFig(y, k, e.target.value)} /></td>
                          ))}
                        </tr>
                      ))}
                    </FragmentRows>
                  ))}
                  <tr className="group"><td colSpan={years.length + 1}>جمع‌ها (محاسبه‌ی خودکار)</td></tr>
                  {FIN_TOTALS.map(([k, label]) => (
                    <tr key={k} className="total">
                      <td>{label}</td>
                      {years.map((y, i) => {
                        const t = totals(y) as any;
                        const bad = k === "balanceDifference" && t && t[k] !== 0;
                        return <td key={y} className={`num ${i !== yi ? "yr-other" : ""}`} style={bad ? { color: "var(--danger-700)" } : undefined}>{t ? millions(t[k]) : "—"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {c && years.some((y) => (totals(y) as any)?.balanceDifference !== 0) && <Banner tone="warning">در سال‌هایی که اختلاف تراز صفر نیست، جمع دارایی‌ها با جمع بدهی‌ها و حقوق مالکانه برابر نیست.</Banner>}
        <ErrorBanner error={save.error} />
        {editable && <div className="row"><Button busy={save.busy} disabled={!dirty.size} onClick={() => save.run()}>ذخیره</Button></div>}
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}

function FragmentRows({ title, cols, children }: { title: string; cols: number; children: React.ReactNode }) {
  return <><tr className="group"><td colSpan={cols}>{title}</td></tr>{children}</>;
}
