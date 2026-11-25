"use client";
import { useMemo, useState } from "react";
import { scoreCase, ScoringInputError, toRials, type ActivityType, type ScoringMethod } from "@tp/domain/creditScoring";
import { scoringYears, toFinancialYear } from "@tp/domain/caseFile";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { ACTIVITY_FA, Banner, Button, COLLATERAL_FA, Card, KV, Select, Status, TextArea, TextInput, dec, fa, jdatetime, latin, pct, toman, tomanShort } from "@tp/ui";
import type { StaffCase } from "@/lib/case";
import { AdjustLimit } from "./AdjustLimit";

interface Round { id: string; round_no: number; state: string; method_version: number; activity_type: string; judgement: { rc: number; ra: number; re: number; reasons: Record<string, string> }; result: any; summary?: string | null; prepared_by: string; prepared_at?: string; decision_reason?: string | null }
const MISSING_FA: Record<string, string> = { financials_not_locked: "ارقام مالی قفل نشده است", visit_not_done: "بازدید انجام نشده است" };
const three = (x: string) => /^(0(\.\d{1,3})?|1(\.0{1,3})?)$/.test(latin(x));

/** S-19: live credit-limit calculation on the verified figures (the same engine as the server), then the round and its approval. */
export function Scoring({ c, reload, meId, isAnalyst, isFundManager, canAdjust }: { c: StaffCase; reload: () => void; meId: string; isAnalyst: boolean; isFundManager: boolean; canAdjust?: boolean }) {
  const api = useApi();
  const stepUp = useStepUp();
  const method = useQuery("method", () => api.get<ScoringMethod>("/admin/scoring-method"));
  const rounds = useQuery(`rounds:${c.id}`, () => api.get<Round[]>(`/admin/cases/${c.id}/rounds`));
  const last = rounds.data?.[rounds.data.length - 1];
  const [activity, setActivity] = useState<string>(last?.activity_type ?? "");
  const [k, setK] = useState({ rc: String(last?.judgement.rc ?? ""), ra: String(last?.judgement.ra ?? ""), re: String(last?.judgement.re ?? "") });
  const [why, setWhy] = useState({ rc: last?.judgement.reasons?.rc ?? "", ra: last?.judgement.reasons?.ra ?? "", re: last?.judgement.reasons?.re ?? "" });
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  // the three latest full years, as the server uses them (a balance-sheet-only latest year is skipped)
  const latestType = c.financials.find((f) => f.fiscal_year === c.latest_fiscal_year)?.statement_type;
  const years = scoringYears(c.latest_fiscal_year, latestType).map((y) => c.financials.find((f) => f.fiscal_year === y));
  const live = useMemo(() => {
    if (!method.data || !activity || !three(k.rc) || !three(k.ra) || !three(k.re) || years.some((y) => !y?.verified && !y?.declared)) return null;
    try {
      return scoreCase({
        activityType: activity as ActivityType,
        years: years.map((y) => toFinancialYear((y!.verified ?? y!.declared)!)) as any,
        guarantee: { rc: Number(latin(k.rc)), ra: Number(latin(k.ra)), re: Number(latin(k.re)) },
      }, method.data);
    } catch (e) { return e instanceof ScoringInputError ? { error: e.problems } : null; }
  }, [method.data, activity, k, years]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useAction(async () => {
    await api.post(`/admin/cases/${c.id}/scoring`, {
      activity_type: activity, guarantee: { rc: Number(latin(k.rc)), ra: Number(latin(k.ra)), re: Number(latin(k.re)) },
      reasons: { rc: why.rc.trim(), ra: why.ra.trim(), re: why.re.trim() },
    });
    rounds.reload(); reload();
  });
  const send = useAction(async () => { await api.post(`/admin/cases/${c.id}/scoring/submit`, { summary: summary.trim() }); rounds.reload(); reload(); });
  const decide = useAction(async (_k, decision: "approve" | "send_back" | "decline") => {
    const body = decision === "approve" ? { decision, ...(note.trim() ? { note_to_applicant: note.trim() } : {}) } : { decision, reason: reason.trim() };
    await stepUp("POST", `/admin/cases/${c.id}/decision`, body, { title: decision === "approve" ? "تأیید حد اعتباری" : decision === "send_back" ? "بازگشت به کارشناس" : "رد پرونده" });
    rounds.reload(); reload();
  });

  const canScore = isAnalyst && ["documents_complete", "scoring", "sent_back_to_analyst"].includes(c.state);
  const pending = rounds.data?.find((r) => r.state === "pending_approval");
  const preparing = rounds.data?.find((r) => r.state === "preparing");
  const reasonsOk = why.rc.trim().length >= 5 && why.ra.trim().length >= 5 && why.re.trim().length >= 5;
  const res = live && !("error" in live) ? live : null;
  const missing: string[] = run.error?.code === "SCORING_NOT_READY" ? run.error.details?.missing ?? [] : [];

  return (
    <div className="stack">
      {canScore && (
        <div className="grid-2" style={{ alignItems: "start" }}>
          <Card title="ورودی‌های کارشناس">
            <div className="stack">
              <Select label="نوع فعالیت" value={activity} onValue={setActivity} options={Object.entries(ACTIVITY_FA)} />
              <div className="coef">
                {(["rc", "ra", "re"] as const).map((x) => (
                  <TextInput key={x} label={{ rc: "Rc (سابقه‌ی اعتباری)", ra: "Ra (توان اجرایی)", re: "Re (ریسک محیطی)" }[x]} ltr value={k[x]} onValue={(v) => setK({ ...k, [x]: v })}
                    error={k[x] && !three(k[x]) ? "بین ۰ و ۱، حداکثر سه رقم اعشار" : undefined} />
                ))}
              </div>
              {(["rc", "ra", "re"] as const).map((x) => (
                <TextArea key={x} label={`دلیل ${x.toUpperCase()}`} value={why[x]} onValue={(v) => setWhy({ ...why, [x]: v })} rows={2} />
              ))}
              <ErrorBanner error={run.error} />
              {missing.length > 0 && <Banner tone="warning">پیش از محاسبه: {missing.map((m) => MISSING_FA[m] ?? (m.startsWith("original_not_received") ? "تحویل اصل مدرک ثبت نشده" : m)).join("، ")}</Banner>}
              <Button busy={run.busy} disabled={!res || !reasonsOk} onClick={() => run.run()}>ثبت دور محاسبه</Button>
            </div>
          </Card>
          <div className="stack">
            <div className="result" aria-live="polite">
              <span className="t-small t-muted">حد اعتباری (چک و سفته) — پیش‌نمایش با ارقام {c.financials_locked_at ? "تأییدشده" : "فعلی"}</span>
              <span className="t-display">{res ? tomanShort(toRials(res.creditLimit).toString()) : "—"}</span>
              {res && <span className="t-small t-muted">{toman(toRials(res.creditLimit).toString())}</span>}
              {live && "error" in live && <span>ورودی نامعتبر: {(live.error as string[]).join("، ")}</span>}
            </div>
            {res && (
              <Card title="جزئیات محاسبه">
                <KV rows={[
                  ["β ضمانت‌نامه", fa(res.coefficients.betaGuarantee)], ["رشد متوسط فروش", pct(res.avgGrowth)], ["حاشیه‌ی سود وزنی", pct(res.avgMargin)],
                  ["Cp / Cr", `${dec(res.coefficients.cp)} / ${dec(res.coefficients.cr)}`], ["Crl", dec(res.coefficients.crl)],
                  ["سقف نُرم", tomanShort(toRials(res.normCeiling).toString())],
                  ...(["cheque", "mortgage_2", "mortgage_1"] as const).map((x) => [`سقف با ${COLLATERAL_FA[x]}`, tomanShort(toRials(res.guarantee.ceiling[x]).toString())] as [string, string]),
                ]} />
              </Card>
            )}
          </div>
        </div>
      )}

      {preparing && isAnalyst && preparing.prepared_by === meId && (
        <Card highlight title={`دور ${fa(preparing.round_no)} آماده‌ی ارسال برای تأیید`}>
          <div className="stack">
            <p>حد محاسبه‌شده: <strong>{toman(preparing.result?.credit_limit)}</strong></p>
            <TextArea label="خلاصه برای مدیر صندوق" value={summary} onValue={setSummary} rows={3} />
            <ErrorBanner error={send.error} />
            <Button busy={send.busy} disabled={summary.trim().length < 10} onClick={() => send.run()}>ارسال برای تأیید مدیر صندوق</Button>
          </div>
        </Card>
      )}

      {pending && isFundManager && (
        <Card highlight title={`تأیید دور ${fa(pending.round_no)}`}>
          <div className="stack">
            <KV rows={[
              ["حد پیشنهادی", toman(pending.result?.credit_limit)], ["نوع فعالیت", ACTIVITY_FA[pending.activity_type] ?? pending.activity_type],
              ["Rc / Ra / Re", `${dec(pending.judgement.rc, 3)} / ${dec(pending.judgement.ra, 3)} / ${dec(pending.judgement.re, 3)}`],
              ["دلایل", Object.entries(pending.judgement.reasons ?? {}).map(([x, r]) => `${x.toUpperCase()}: ${r}`).join("؛ ")],
              ["خلاصه‌ی کارشناس", pending.summary ?? "—"],
            ]} />
            {pending.prepared_by === meId ? <Banner tone="warning">این دور را خودتان آماده کرده‌اید؛ مدیر اعتبارات یا مدیر صندوق دیگری باید تصمیم بگیرد.</Banner> : (<>
              <TextArea label="یادداشت برای متقاضی (اختیاری)" value={note} onValue={setNote} rows={2} hint="ضرایب به متقاضی نشان داده نمی‌شود." />
              <TextArea label="دلیل (برای بازگشت یا رد)" value={reason} onValue={setReason} rows={2} />
              <ErrorBanner error={decide.error} />
              <div className="row">
                <Button busy={decide.busy} onClick={() => decide.run("approve")}>تأیید و صدور حد</Button>
                <Button variant="outline" busy={decide.busy} disabled={reason.trim().length < 5} onClick={() => decide.run("send_back")}>بازگشت به کارشناس</Button>
                <Button variant="danger" busy={decide.busy} disabled={reason.trim().length < 5} onClick={() => decide.run("decline")}>رد</Button>
              </div>
            </>)}
          </div>
        </Card>
      )}

      {canAdjust && c.state === "limit_issued" && <AdjustLimit c={c} round={rounds.data?.find((r) => r.state === "approved")} reload={reload} />}

      <Card title="دورهای محاسبه">
        <ErrorBanner error={rounds.error} />
        {rounds.data?.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>دور</th><th>روش</th><th>فعالیت</th><th>Rc/Ra/Re</th><th>حد</th><th>وضعیت</th></tr></thead>
            <tbody>{rounds.data.map((r) => (
              <tr key={r.id}><td>{fa(r.round_no)}</td><td>نسخه‌ی {fa(r.method_version)}</td><td>{ACTIVITY_FA[r.activity_type] ?? r.activity_type}</td>
                <td>{dec(r.judgement.rc, 3)} / {dec(r.judgement.ra, 3)} / {dec(r.judgement.re, 3)}</td><td className="num">{toman(r.result?.credit_limit)}</td><td><Status kind="round" value={r.state} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="t-muted">هنوز دوری ثبت نشده است.</p>}
      </Card>
    </div>
  );
}
