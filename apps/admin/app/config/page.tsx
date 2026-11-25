"use client";
import { useEffect, useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { ACTIVITY_FA, Button, COLLATERAL_FA, Card, JalaliDateInput, KV, Tabs, TextArea, TextInput, Toast, dec, fa, jdate, jdatetime, latin, pct, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface Tariff { version: number; effective_from: string; assessment_fee_tehran: string; assessment_fee_outside: string; application_fee: string; servicing_fee_bps: number; investor_fee_bps: number; platform_share_bps: number; note: string | null; created_at: string }
interface Method { version: number; beta: Record<string, { guarantee: number; facility: number }>; matrix: number[][]; growthBands: number[]; marginBands: number[]; c1Bands: number[]; c2Bands: number[]; collateral: Record<string, number>; marginWeights: number[]; crl: { a: number; b: number }; taxRate: number; limitCollateral: string }
interface Policy { rate_basis: string; default_applicant_rate: string; default_investor_rate: string; min_spread: string | null; waterfall_order: string; vat_bps: number; version?: number }

const toT = (r: string) => (BigInt(r) / 10n).toString();
const toR = (t: string) => (BigInt(latin(t).replace(/\D/g, "") || "0") * 10n).toString();

/** Fee tariff (D-C13, step-up, versioned), rate policy (D26) and the scoring method (doc 07 §7, read-only here). */
export default function Config() {
  const api = useApi();
  const stepUp = useStepUp();
  const { has } = useStaff();
  const [tab, setTab] = useState<"tariff" | "policy" | "method">("tariff");
  const t = useQuery("tariffs", () => api.get<{ current: Tariff | null; history: Tariff[] }>("/admin/tariffs"));
  const p = useQuery(tab === "policy" ? "policy" : null, () => api.get<Policy>("/admin/pricing/policy"));
  const m = useQuery(tab === "method" ? "method" : null, () => api.get<Method>("/admin/scoring-method"));
  const [f, setF] = useState({ effective_from: new Date().toISOString().slice(0, 10), tehran: "", outside: "", application: "", platform_pct: "10", note: "" });
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const c = t.data?.current;
    if (c) setF((x) => ({ ...x, tehran: toT(c.assessment_fee_tehran), outside: toT(c.assessment_fee_outside), application: toT(c.application_fee), platform_pct: String(c.platform_share_bps / 100) }));
  }, [t.data]);
  const save = useAction(async () => {
    const body = {
      effective_from: f.effective_from, assessment_fee_tehran: toR(f.tehran), assessment_fee_outside: toR(f.outside), application_fee: toR(f.application),
      servicing_fee_bps: t.data?.current?.servicing_fee_bps ?? 0, investor_fee_bps: t.data?.current?.investor_fee_bps ?? 0,
      platform_share_bps: Math.round(Number(latin(f.platform_pct)) * 100), note: f.note.trim() || null,
    };
    await stepUp("PUT", "/admin/tariffs", body, { title: "انتشار نسخه‌ی جدید تعرفه" });
    t.reload(); setToast("تعرفه‌ی جدید ثبت شد");
  });

  return (
    <Shell title="تنظیمات صندوق">
      <div className="stack">
        <Tabs tabs={[["tariff", "تعرفه‌ی کارمزد"], ["policy", "سیاست نرخ"], ["method", "روش محاسبه‌ی حد"]]} value={tab} onChange={setTab} />
        {tab === "tariff" && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            <Card title={t.data?.current ? `تعرفه‌ی جاری — نسخه‌ی ${fa(t.data.current.version)}` : "تعرفه‌ای ثبت نشده است"}>
              <ErrorBanner error={t.error} />
              {t.data?.current && <KV rows={[
                ["کارمزد ارزیابی — تهران", toman(t.data.current.assessment_fee_tehran)], ["کارمزد ارزیابی — خارج از تهران", toman(t.data.current.assessment_fee_outside)],
                ["کارمزد درخواست", toman(t.data.current.application_fee)], ["سهم پلتفرم", pct(t.data.current.platform_share_bps / 10000, 0)],
                ["اعمال از", jdate(t.data.current.effective_from)], ["ثبت", jdatetime(t.data.current.created_at)],
              ]} />}
            </Card>
            {has("fund_manager") && (
              <Card title="نسخه‌ی جدید">
                <div className="stack">
                  <JalaliDateInput label="اعمال از" value={f.effective_from} onValue={(v) => setF({ ...f, effective_from: v })} />
                  <div className="fieldset-grid">
                    <TextInput label="کارمزد ارزیابی تهران (تومان)" digits ltr value={f.tehran} onValue={(v) => setF({ ...f, tehran: v })} />
                    <TextInput label="کارمزد ارزیابی خارج از تهران (تومان)" digits ltr value={f.outside} onValue={(v) => setF({ ...f, outside: v })} />
                    <TextInput label="کارمزد درخواست (تومان)" digits ltr value={f.application} onValue={(v) => setF({ ...f, application: v })} />
                    <TextInput label="سهم پلتفرم (٪)" ltr value={f.platform_pct} onValue={(v) => setF({ ...f, platform_pct: v })} />
                  </div>
                  <TextArea label="یادداشت (اختیاری)" value={f.note} onValue={(v) => setF({ ...f, note: v })} rows={2} />
                  <ErrorBanner error={save.error} />
                  <Button busy={save.busy} disabled={!f.effective_from} onClick={() => save.run()}>ثبت با رمز یکبارمصرف</Button>
                  <p className="t-small t-muted">نسخه‌های قبلی حفظ می‌شوند و هر صورتحساب نسخه‌ای را که با آن صادر شده نگه می‌دارد.</p>
                </div>
              </Card>
            )}
          </div>
        )}
        {tab === "policy" && (
          <Card title="سیاست نرخ (پیش‌فرض‌ها؛ هر سری می‌تواند تغییر دهد)">
            <ErrorBanner error={p.error} />
            {p.data && <KV rows={[
              ["مبنای نرخ", p.data.rate_basis === "monthly" ? "ماهانه" : "سالانه"], ["نرخ متقاضی", pct(Number(p.data.default_applicant_rate), 2)],
              ["نرخ سرمایه‌گذار", pct(Number(p.data.default_investor_rate), 2)], ["حداقل فاصله‌ی نرخ", p.data.min_spread ? pct(Number(p.data.min_spread), 2) : "—"],
              ["ترتیب بازپرداخت", ({ fund_first: "ابتدا سهم صندوق", investors_first: "ابتدا سرمایه‌گذاران", pro_rata: "نسبی" } as Record<string, string>)[p.data.waterfall_order]],
              ["مالیات بر ارزش افزوده", pct(p.data.vat_bps / 10000, 0)],
            ]} />}
          </Card>
        )}
        {tab === "method" && m.data && (
          <div className="stack">
            <Card title={`روش محاسبه — نسخه‌ی ${fa(m.data.version)}`}>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>نوع فعالیت</th><th>β ضمانت‌نامه</th><th>β تسهیلات</th></tr></thead>
                <tbody>{Object.entries(m.data.beta).map(([k, v]) => <tr key={k}><td>{ACTIVITY_FA[k] ?? k}</td><td>{fa(v.guarantee)}</td><td>{fa(v.facility)}</td></tr>)}</tbody>
              </table></div>
            </Card>
            <div className="grid-2">
              <Card title="ضریب وثیقه"><KV rows={Object.entries(m.data.collateral).map(([k, v]) => [COLLATERAL_FA[k] ?? k, dec(v, 1)])} /></Card>
              <Card title="سایر پارامترها"><KV rows={[
                ["وزن سال‌ها در حاشیه‌ی سود", m.data.marginWeights.map((w) => dec(w, 1)).join("، ")], ["Crl", `${dec(m.data.crl.a)} − ${dec(m.data.crl.b)} × نسبت بدهی`],
                ["نرخ مالیات", pct(m.data.taxRate, 0)], ["مبنای حد اعتباری", COLLATERAL_FA[m.data.limitCollateral]],
              ]} /></Card>
            </div>
            <p className="t-small t-muted">ویرایش روش محاسبه فقط با مدیر صندوق و از طریق API نسخه‌دار انجام می‌شود؛ هر دور محاسبه نسخه‌ی خود را نگه می‌دارد.</p>
          </div>
        )}
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}
