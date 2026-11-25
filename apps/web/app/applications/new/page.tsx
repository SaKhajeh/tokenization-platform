"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, JalaliDateInput, Select, TextArea, TextInput, Tracker, fa, latin, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { FilePick } from "@/components/FilePick";
import { useMe } from "@/lib/me";
import type { Limit } from "@/lib/case";

const STEPS = ["طرح", "مبلغ و مدت", "منبع بازپرداخت", "تضامین پیشنهادی", "مدارک"];
const TYPES: [string, string][] = [["project_finance", "تأمین مالی طرح"], ["working_capital", "سرمایه‌ی در گردش"], ["equipment", "خرید تجهیزات"], ["research_commercialisation", "تجاری‌سازی پژوهش"]];

/** A-42: the 5-step application wizard. The amount is binding and must fit the remaining credit limit (D-C12). */
export default function NewApplication() {
  const api = useApi();
  const router = useRouter();
  const { org } = useMe();
  const limit = useQuery(org ? `limit:${org.id}` : null, () => api.get<Limit>("/case/limit"));
  const [step, setStep] = useState(0);
  const [ini, setIni] = useState({ title: "", description: "", sector: "", location: "", started_on: "", progress_summary: "" });
  const [evidence, setEvidence] = useState<[string, string][]>([]);
  const [a, setA] = useState({ investment_type: "", amount: "", months: "12", rate: "", rule: "keep_raised", use_of_funds: "", repayment_source: "" });
  const [guarantees, setGuarantees] = useState<{ type: string; description: string }[]>([{ type: "چک و سفته", description: "" }]);
  const [docs, setDocs] = useState<[string, string][]>([]);

  const rials = latin(a.amount).replace(/\D/g, "") ? (BigInt(latin(a.amount).replace(/\D/g, "")) * 10n).toString() : "";
  const avail = limit.data?.limit ? BigInt(limit.data.limit.available) : null;
  const over = !!rials && avail !== null && BigInt(rials) > avail;
  const ratePct = Number(latin(a.rate));
  const ok = [
    ini.title.trim().length >= 3 && ini.description.trim().length >= 20 && ini.sector.trim().length >= 2 && ini.location.trim().length >= 2 && !!ini.started_on && ini.progress_summary.trim().length >= 10 && evidence.length > 0,
    !!a.investment_type && !!rials && !over && Number(a.months) >= 1 && ratePct > 0 && ratePct < 100 && a.use_of_funds.trim().length >= 10,
    a.repayment_source.trim().length >= 10,
    guarantees.every((g) => g.type.trim().length >= 2 && g.description.trim().length >= 3),
    true,
  ];

  const create = useAction(async (idem) => {
    const i = await api.post<{ id: string }>("/initiatives", { ...ini, title: ini.title.trim(), evidence_doc_ids: evidence.map((e) => e[0]) }, { idem: `${idem}-i` });
    const app = await api.post<{ id: string }>("/applications", {
      initiative_id: i.id, investment_type: a.investment_type, requested_amount: rials, proposed_rate: (ratePct / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".0"),
      proposed_rate_basis: "monthly", proposed_duration_days: Math.round(Number(a.months) * 30.4), proposed_rule: a.rule,
      use_of_funds: a.use_of_funds.trim(), repayment_source: a.repayment_source.trim(), proposed_guarantees: guarantees, document_ids: docs.map((d) => d[0]),
    }, { idem: `${idem}-a` });
    router.replace(`/applications/${app.id}`);
  });

  return (
    <Shell title="درخواست تأمین مالی">
      <div className="stack">
        <Link href="/financing">← بازگشت</Link>
        {limit.data && !limit.data.limit && <Banner tone="warning">درخواست تأمین مالی پس از صدور حد اعتباری ممکن است.</Banner>}
        {avail !== null && <Banner tone="info">حد اعتباری قابل استفاده: {toman(avail)}</Banner>}
        <div className="wizard">
          <Card className="wizard-steps"><Tracker steps={STEPS} current={step} /></Card>
          <p className="wizard-step-line t-small t-muted">مرحله‌ی {fa(step + 1)} از {fa(STEPS.length)}: <strong>{STEPS[step]}</strong></p>
          <Card title={STEPS[step]}>
            <div className="stack">
              {step === 0 && (<>
                <p className="t-muted">طرح باید آغاز شده باشد و شواهد پیشرفت آن (قرارداد، فاکتور، گزارش پیشرفت) موجود باشد.</p>
                <TextInput label="عنوان طرح" value={ini.title} onValue={(v) => setIni({ ...ini, title: v })} />
                <TextArea label="شرح طرح" value={ini.description} onValue={(v) => setIni({ ...ini, description: v })} />
                <div className="fieldset-grid">
                  <TextInput label="حوزه" value={ini.sector} onValue={(v) => setIni({ ...ini, sector: v })} />
                  <TextInput label="محل اجرا" value={ini.location} onValue={(v) => setIni({ ...ini, location: v })} />
                  <JalaliDateInput label="تاریخ آغاز" value={ini.started_on} onValue={(v) => setIni({ ...ini, started_on: v })} />
                </div>
                <TextArea label="پیشرفت تاکنون" value={ini.progress_summary} onValue={(v) => setIni({ ...ini, progress_summary: v })} />
                <div className="row">{evidence.map((e) => <span key={e[0]} className="chip chip-info">{e[1]}</span>)}<FilePick size="sm" label="افزودن شاهد پیشرفت" category="evidence" onUploaded={(id, f) => setEvidence([...evidence, [id, f.name]])} /></div>
                {!evidence.length && <span className="field-hint">دست‌کم یک مدرک لازم است: قرارداد، فاکتور خرید یا گزارش پیشرفت که نشان دهد طرح آغاز شده است.</span>}
              </>)}
              {step === 1 && (<>
                <Select label="نوع تأمین مالی" value={a.investment_type} onValue={(v) => setA({ ...a, investment_type: v })} options={TYPES} />
                <div className="fieldset-grid">
                  <TextInput label="مبلغ درخواستی (تومان)" digits ltr value={a.amount} onValue={(v) => setA({ ...a, amount: v })} error={over ? "مبلغ از حد اعتباری قابل استفاده بیشتر است." : undefined} hint={rials ? toman(rials) : "این مبلغ تعهدآور است."} />
                  <TextInput label="مدت (ماه)" digits ltr value={a.months} onValue={(v) => setA({ ...a, months: v })} />
                  <TextInput label="نرخ پیشنهادی ماهانه (٪)" ltr value={a.rate} onValue={(v) => setA({ ...a, rate: v })} hint="نرخ نهایی را صندوق در مرحله‌ی تعیین شرایط اعلام می‌کند." />
                </div>
                <Select label="اگر کل مبلغ جذب نشد" value={a.rule} onValue={(v) => setA({ ...a, rule: v })} options={[["keep_raised", "تأمین به میزان جذب‌شده"], ["all_or_nothing", "همه یا هیچ"]]} />
                <TextArea label="محل مصرف منابع" value={a.use_of_funds} onValue={(v) => setA({ ...a, use_of_funds: v })} />
              </>)}
              {step === 2 && <TextArea label="منبع بازپرداخت" value={a.repayment_source} onValue={(v) => setA({ ...a, repayment_source: v })} hint="از کجا و در چه زمانی اصل و سود را بازپرداخت می‌کنید؟" />}
              {step === 3 && (<>
                <p className="t-muted">ضمانت پیش‌فرض چک و سفته است؛ وثیقه‌ی ملکی سقف تأمین مالی را بالا می‌برد.</p>
                {guarantees.map((g, i) => (
                  <div key={i} className="repeat-row">
                    <div className="fieldset-grid">
                      <TextInput label="نوع تضمین" value={g.type} onValue={(v) => setGuarantees(guarantees.map((x, j) => (j === i ? { ...x, type: v } : x)))} />
                      <TextInput label="شرح" value={g.description} onValue={(v) => setGuarantees(guarantees.map((x, j) => (j === i ? { ...x, description: v } : x)))} />
                    </div>
                    {guarantees.length > 1 && <Button size="sm" variant="ghost" onClick={() => setGuarantees(guarantees.filter((_, j) => j !== i))}>حذف</Button>}
                  </div>
                ))}
                <Button variant="secondary" size="sm" onClick={() => setGuarantees([...guarantees, { type: "", description: "" }])}>افزودن تضمین</Button>
              </>)}
              {step === 4 && (<>
                <p className="t-muted">مدارک تکمیلی این درخواست (اختیاری): طرح توجیهی، پیش‌فاکتور، قرارداد.</p>
                <div className="row">{docs.map((d) => <span key={d[0]} className="chip chip-info">{d[1]}</span>)}<FilePick size="sm" label="افزودن مدرک" category="evidence" onUploaded={(id, f) => setDocs([...docs, [id, f.name]])} /></div>
                <ErrorBanner error={create.error} />
              </>)}
              <div className="row-between">
                <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>قبلی</Button>
                {step < 4 ? <Button disabled={!ok[step]} onClick={() => setStep(step + 1)}>بعدی</Button>
                  : <Button busy={create.busy} disabled={!ok.every(Boolean) || !limit.data?.limit} onClick={() => create.run()}>ذخیره‌ی پیش‌نویس</Button>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
