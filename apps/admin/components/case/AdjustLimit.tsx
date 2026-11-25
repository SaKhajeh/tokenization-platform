"use client";
import { useMemo, useState } from "react";
import { scoreCase, toRials, type ActivityType, type ScoringMethod } from "@tp/domain/creditScoring";
import { scoringYears, toFinancialYear } from "@tp/domain/caseFile";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Banner, Button, COLLATERAL_FA, Card, KV, Select, TextArea, TextInput, dec, latin, toman, tomanShort } from "@tp/ui";
import type { StaffCase } from "@/lib/case";

interface Limit { limit: string; valid_to: string; collateral: string; adjusted: boolean; ra: number; re: number; adjustment: { judgement: { rc: number; ra: number; re: number }; collateral: string; reason: string; previous_limit: string } | null }
const three = (x: string) => /^(0(\.\d{1,3})?|1(\.0{1,3})?)$/.test(latin(x));

/** The fund manager raises or lowers an issued limit through Rc/Ra/Re and the collateral class (fund feedback 2026-11-25). */
export function AdjustLimit({ c, round, reload }: { c: StaffCase; round: { activity_type: string; judgement: { rc: number; ra: number; re: number } } | undefined; reload: () => void }) {
  const api = useApi();
  const stepUp = useStepUp();
  const cur = useQuery(`limit:${c.org_id}`, () => api.get<Limit | null>(`/admin/orgs/${c.org_id}/credit-limit`));
  const method = useQuery("method", () => api.get<ScoringMethod>("/admin/scoring-method"));
  const base = cur.data?.adjustment?.judgement ?? round?.judgement;
  const [k, setK] = useState<{ rc: string; ra: string; re: string } | null>(null);
  const [collateral, setCollateral] = useState<string>("");
  const [reason, setReason] = useState("");
  const v = k ?? (base ? { rc: String(base.rc), ra: String(base.ra), re: String(base.re) } : { rc: "", ra: "", re: "" });
  const col = collateral || cur.data?.collateral || "cheque";

  const preview = useMemo(() => {
    if (!method.data || !round || ![v.rc, v.ra, v.re].every(three)) return null;
    const latestType = c.financials.find((f) => f.fiscal_year === c.latest_fiscal_year)?.statement_type;
    const years = scoringYears(c.latest_fiscal_year, latestType).map((y) => c.financials.find((f) => f.fiscal_year === y));
    if (years.some((y) => !y?.verified)) return null;
    try {
      const r = scoreCase({ activityType: round.activity_type as ActivityType, years: years.map((y) => toFinancialYear(y!.verified!)) as any, guarantee: { rc: Number(latin(v.rc)), ra: Number(latin(v.ra)), re: Number(latin(v.re)) } }, method.data);
      return toRials(r.guarantee.ceiling[col as "cheque"]);
    } catch { return null; }
  }, [method.data, round, v, col, c]);

  const save = useAction(async () => {
    const body = { rc: Number(latin(v.rc)), ra: Number(latin(v.ra)), re: Number(latin(v.re)), collateral: col, reason: reason.trim() };
    await stepUp("POST", `/admin/orgs/${c.org_id}/credit-limit/adjust`, body, { title: "تغییر حد اعتباری", summary: preview !== null ? <span>حد جدید: {toman(preview)}</span> : undefined });
    setK(null); setCollateral(""); setReason("");
    cur.reload(); reload();
  });

  if (!cur.data) return null;
  return (
    <Card title="تغییر حد اعتباری (مدیر صندوق)">
      <div className="stack">
        <KV rows={[["حد فعلی", toman(cur.data.limit)], ["وثیقه‌ی مبنا", COLLATERAL_FA[cur.data.collateral] ?? cur.data.collateral],
          ...(cur.data.adjustment ? [["آخرین تغییر", `${toman(cur.data.adjustment.previous_limit)} ← ${toman(cur.data.limit)} — ${cur.data.adjustment.reason}`] as [string, string]] : [])]} />
        <div className="coef">
          {(["rc", "ra", "re"] as const).map((x) => (
            <TextInput key={x} label={x.toUpperCase()} ltr value={v[x]} onValue={(val) => setK({ ...v, [x]: val })} error={v[x] && !three(v[x]) ? "۰ تا ۱، حداکثر سه رقم اعشار" : undefined} />
          ))}
        </div>
        <Select label="وثیقه‌ی مبنای حد" value={col} onValue={setCollateral} options={Object.entries(COLLATERAL_FA)} />
        {preview !== null && <Banner tone={preview > BigInt(cur.data.limit) ? "success" : preview < BigInt(cur.data.limit) ? "warning" : "info"}>حد جدید: <strong>{tomanShort(preview)}</strong> ({toman(preview)})</Banner>}
        <TextArea label="دلیل تغییر" value={reason} onValue={setReason} rows={2} />
        <ErrorBanner error={save.error} />
        <Button busy={save.busy} disabled={preview === null || reason.trim().length < 5} onClick={() => save.run()}>ثبت تغییر با رمز یکبارمصرف</Button>
        <p className="t-small t-muted">حد با همان ارقام قفل‌شده و روش محاسبه دوباره محاسبه می‌شود؛ مدت اعتبار تغییر نمی‌کند و حد قبلی در سابقه می‌ماند. Ra/Re پرونده: {dec(cur.data.ra, 3)} / {dec(cur.data.re, 3)}</p>
      </div>
    </Card>
  );
}
