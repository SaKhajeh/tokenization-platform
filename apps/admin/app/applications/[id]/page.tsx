"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, Check, KV, Status, TextArea, TextInput, dec, fa, jdate, jdatetime, latin, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface AppDetail {
  id: string; application_no: string; status: string; requested_amount: string; investment_type: string; proposed_rate: string; proposed_rate_basis: string; proposed_duration_days: number;
  use_of_funds: string; repayment_source: string; proposed_guarantees: { type: string; description: string }[]; submitted_at: string | null;
  applicant: { id: string; legal_name: string; national_id: string }; initiative: { title: string; description: string; sector: string; location: string; started_on: string; progress_summary: string };
  events: { from_status: string | null; to_status: string; reason: string | null; at: string }[]; applicant_tasks: { id: string; title: string; status: string }[];
  screening?: { outcome: string; comment: string | null; at: string } | null;
}
interface StaffLimit { limit: string; available: string; used: string; remaining_norm: string; norm_ceiling: string; ra: number; re: number; valid_to: string }
const CHECKLIST = ["طرح آغاز شده و شواهد پیشرفت دارد", "مبلغ در محدوده‌ی مجاز صندوق است", "متقاضی مسدود یا دارای منع نیست", "حوزه‌ی فعالیت مجاز است", "منبع بازپرداخت روشن است"];
const three = (x: string) => /^(0\.\d{1,3}|1(\.0{1,3})?)$/.test(latin(x)) && Number(latin(x)) > 0;

/** S-11: screening (checklist, return items) and the limit check against the company's credit limit (doc 07 §9). */
export default function ApplicationReview() {
  const api = useApi();
  const { has } = useStaff();
  const { id } = useParams<{ id: string }>();
  const q = useQuery(`app:${id}`, () => api.get<AppDetail>(`/admin/applications/${id}`));
  const a = q.data;
  const lim = useQuery(a ? `lim:${a.applicant.id}` : null, () => api.get<StaffLimit>(`/admin/orgs/${a!.applicant.id}/credit-limit`));
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => true));
  const [comment, setComment] = useState("");
  const [returns, setReturns] = useState("");
  const [rr, setRr] = useState({ ra: "", re: "", reason: "" });
  const [result, setResult] = useState<any>(null);
  const start = useAction(async () => { await api.post(`/admin/applications/${id}/start-screening`); q.reload(); });
  const screen = useAction(async (_k, outcome: "pass" | "return" | "reject") => {
    await api.post(`/admin/applications/${id}/screening`, {
      checklist: CHECKLIST.map((item, i) => ({ item, ok: checks[i] })), outcome, ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...(outcome === "return" ? { return_items: returns.split("\n").map((x) => x.trim()).filter((x) => x.length >= 3).map((title) => ({ title })) } : {}),
    });
    q.reload();
  });
  const check = useAction(async () => {
    const r = await api.post(`/admin/applications/${id}/limit-check`, { ra: Number(latin(rr.ra)), re: Number(latin(rr.re)), reason: rr.reason.trim() });
    setResult(r); q.reload(); lim.reload();
  });
  const analyst = has("analyst");
  const preview = lim.data && three(rr.ra) && three(rr.re) ? BigInt(lim.data.remaining_norm) * BigInt(Math.round(Number(latin(rr.ra)) * 1000)) * BigInt(Math.round(Number(latin(rr.re)) * 1000)) / 1_000_000n : null;

  return (
    <Shell title={a ? <h1 className="t-h1">درخواست <span className="ltr">{a.application_no}</span></h1> : "درخواست"} action={a ? <Status kind="application" value={a.status} /> : null}>
      <div className="stack">
        <Link href="/applications">← بازگشت</Link>
        <ErrorBanner error={q.error} />
        {a && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="stack">
              <Card title={`${a.applicant.legal_name} — ${a.initiative.title}`}>
                <KV rows={[
                  ["مبلغ", toman(a.requested_amount)], ["مدت", `${fa(Math.round(a.proposed_duration_days / 30.4))} ماه`],
                  ["نرخ پیشنهادی متقاضی", `${fa((Number(a.proposed_rate) * 100).toFixed(2).replace(/\.?0+$/, ""))}٪ ${a.proposed_rate_basis === "monthly" ? "ماهانه" : "سالانه"}`],
                  ["طرح", a.initiative.description], ["آغاز طرح", jdate(a.initiative.started_on)], ["پیشرفت", a.initiative.progress_summary],
                  ["محل مصرف", a.use_of_funds], ["بازپرداخت", a.repayment_source], ["تضامین", a.proposed_guarantees.map((g) => `${g.type}: ${g.description}`).join("؛ ")],
                ]} />
              </Card>
              <Card title="تاریخچه">
                <ul className="list">{[...a.events].reverse().map((e, i) => (
                  <li key={i}><span className="row"><Status kind="application" value={e.to_status} />{e.reason && <span className="t-small t-muted">{e.reason}</span>}</span><span className="t-small t-muted">{jdatetime(e.at)}</span></li>
                ))}</ul>
              </Card>
            </div>
            <div className="stack">
              {analyst && ["submitted", "resubmitted"].includes(a.status) && <Button busy={start.busy} onClick={() => start.run()}>شروع غربالگری</Button>}
              {analyst && a.status === "screening" && (
                <Card title="غربالگری">
                  <div className="stack">
                    {CHECKLIST.map((c, i) => <Check key={c} checked={checks[i]} onValue={(v) => setChecks(checks.map((x, j) => (j === i ? v : x)))}>{c}</Check>)}
                    <TextArea label="توضیح" value={comment} onValue={setComment} rows={2} />
                    <TextArea label="موارد بازگشت به متقاضی (هر خط یک مورد)" value={returns} onValue={setReturns} rows={3} />
                    <ErrorBanner error={screen.error} />
                    <div className="row">
                      <Button busy={screen.busy} disabled={!checks.every(Boolean)} onClick={() => screen.run("pass")}>قبول</Button>
                      <Button variant="outline" busy={screen.busy} disabled={!returns.trim()} onClick={() => screen.run("return")}>بازگشت به متقاضی</Button>
                      <Button variant="danger" busy={screen.busy} disabled={comment.trim().length < 3} onClick={() => screen.run("reject")}>رد</Button>
                    </div>
                  </div>
                </Card>
              )}
              <Card title="حد اعتباری شرکت">
                <ErrorBanner error={lim.error} />
                {lim.data && <KV rows={[["حد", toman(lim.data.limit)], ["قابل استفاده", toman(lim.data.available)], ["نُرم باقی‌مانده", toman(lim.data.remaining_norm)], ["اعتبار تا", jdate(lim.data.valid_to)],
                  ["Ra / Re پرونده", `${dec(lim.data.ra, 3)} / ${dec(lim.data.re, 3)}`]]} />}
              </Card>
              {analyst && a.status === "credit_assessment" && (
                <Card highlight title="بررسی حد برای این طرح">
                  <div className="stack">
                    <p className="t-small t-muted">سقف طرح = نُرم باقی‌مانده × Ra × Re طرح. چیزی رزرو نمی‌شود؛ کسر از حد هنگام تأیید نهایی تأمین مالی انجام می‌شود.</p>
                    <div className="fieldset-grid">
                      <TextInput label="Ra طرح" ltr value={rr.ra} onValue={(v) => setRr({ ...rr, ra: v })} error={rr.ra && !three(rr.ra) ? "بیشتر از ۰ تا ۱، حداکثر سه رقم اعشار" : undefined} />
                      <TextInput label="Re طرح" ltr value={rr.re} onValue={(v) => setRr({ ...rr, re: v })} error={rr.re && !three(rr.re) ? "بیشتر از ۰ تا ۱، حداکثر سه رقم اعشار" : undefined} />
                    </div>
                    <TextArea label="دلیل" value={rr.reason} onValue={(v) => setRr({ ...rr, reason: v })} rows={2} />
                    {preview !== null && <p>سقف طرح: <strong>{toman(preview)}</strong> — درخواست {BigInt(a.requested_amount) <= preview ? <span className="chip chip-success">در سقف است</span> : <span className="chip chip-danger">بیش از سقف</span>}</p>}
                    <ErrorBanner error={check.error} />
                    <Button busy={check.busy} disabled={!three(rr.ra) || !three(rr.re) || rr.reason.trim().length < 5} onClick={() => check.run()}>ثبت بررسی حد</Button>
                  </div>
                </Card>
              )}
              {result && (result.fits ? <Banner tone="success">در سقف است؛ درخواست به بررسی دقیق رفت.</Banner> : <Banner tone="warning">بیش از سقف طرح ({toman(result.project_ceiling)}) به اندازه‌ی {toman(result.shortfall)}. درخواست در همین مرحله می‌ماند.</Banner>)}
              {a.applicant_tasks.length > 0 && <Card title="کارهای متقاضی"><ul className="list">{a.applicant_tasks.map((t) => <li key={t.id}>{t.title}<Status kind="task" value={t.status} /></li>)}</ul></Card>}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
