"use client";
import { useMemo, useState } from "react";
import { scoreCase, ScoringInputError, toRials, type ActivityType, type ScoringMethod } from "@tp/domain/creditScoring";
import { calculationPeriods, toFinancialYear } from "@tp/domain/caseFile";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { ACTIVITY_FA, Banner, Button, COLLATERAL_FA, Card, Check, JalaliDateInput, KV, Select, Status, TextArea, TextInput, dec, fa, jdate, jdatetime, latin, toman } from "@tp/ui";
import type { StaffCase } from "@/lib/case";
import { AdjustLimit } from "./AdjustLimit";
import { CeilingsTable, TwoCalcs, activityFa, coefs, type Calc, type Period } from "./Periods";

interface Result extends Calc { chosen?: "a" | "b"; b_higher?: boolean; trial_balance_check?: { confirmed: boolean; note: string } | null; alternatives?: { a: Calc; b: Calc | null; b_error: string[] | null } }
interface Round {
  id: string; round_no: number; state: string; method_version: number; activity_type: string; judgement: { rc: number; ra: number; re: number; reasons: Record<string, string> };
  result: Result; summary?: string | null; prepared_by: string; decided_by?: string | null; decision_reason?: string | null; note_to_applicant?: string | null;
  compliance_comment?: string | null; compliance_at?: string | null; committee_meeting_on?: string | null; ceo_decision?: string | null; ceo_comment?: string | null;
  ceo_overrides?: { guarantee?: Record<string, string>; facility?: Record<string, string> } | null; ceo_at?: string | null;
}
const MISSING_FA: Record<string, string> = { financials_not_locked: "ارقام مالی قفل نشده است", visit_not_done: "بازدید انجام نشده است" };
const three = (x: string) => /^(0(\.\d{1,3})?|1(\.0{1,3})?)$/.test(latin(x));
const CLASSES = ["cheque", "mortgage_2", "mortgage_1"] as const;

/**
 * S-19 and the decision chain (fund rules 2026-11-26, revised 2026-11-27): the analyst sees both calculations live and
 * sends a round; the compliance officer sends it to the fund manager (the fund's CEO) with a comment, or back to the
 * analyst; the fund manager confirms the committee meeting and accepts (possibly editing the ceilings) or declines;
 * the compliance officer releases it to the company. The fund manager can adjust an issued limit.
 */
export function Scoring({ c, reload, meId, isAnalyst, isFundManager, canAdjust, isCompliance, isCeo }: {
  c: StaffCase; reload: () => void; meId: string; isAnalyst: boolean; isFundManager: boolean; canAdjust?: boolean; isCompliance?: boolean; isCeo?: boolean;
}) {
  const api = useApi();
  const stepUp = useStepUp();
  const method = useQuery("method", () => api.get<ScoringMethod>("/admin/scoring-method"));
  const rounds = useQuery(`rounds:${c.id}`, () => api.get<Round[]>(`/admin/cases/${c.id}/rounds`));
  const last = rounds.data?.[rounds.data.length - 1];
  const [activity, setActivity] = useState<string>("");
  const [k, setK] = useState({ rc: "", ra: "", re: "" });
  const [why, setWhy] = useState({ rc: "", ra: "", re: "" });
  const [tbOk, setTbOk] = useState(false);
  const [tbNote, setTbNote] = useState("");
  const [text, setText] = useState(""); // summary / reason / comment, depending on the step
  const [note, setNote] = useState("");
  const [meeting, setMeeting] = useState({ held: false, date: "" });
  const [edits, setEdits] = useState<{ guarantee: Record<string, string>; facility: Record<string, string> }>({ guarantee: {}, facility: {} });
  const act = activity || last?.activity_type || "";
  const kv = { rc: k.rc || String(last?.judgement.rc ?? ""), ra: k.ra || String(last?.judgement.ra ?? ""), re: k.re || String(last?.judgement.re ?? "") };
  const wv = { rc: why.rc || last?.judgement.reasons?.rc || "", ra: why.ra || last?.judgement.reasons?.ra || "", re: why.re || last?.judgement.reasons?.re || "" };

  // live preview of both calculations, on the verified figures (the same engine as the server)
  const live = useMemo(() => {
    if (!method.data || !act || ![kv.rc, kv.ra, kv.re].every(three)) return null;
    const n = method.data.marginWeights.length;
    const per = calculationPeriods(c.latest_fiscal_year, n);
    const fin = (y: number) => c.financials.find((f) => f.fiscal_year === y);
    const run = (ys: number[]) => {
      const rows = ys.map(fin);
      if (rows.some((r) => !r?.verified && !r?.declared)) return null;
      try {
        const r = scoreCase({ activityType: act as ActivityType, years: rows.map((r) => toFinancialYear((r!.verified ?? r!.declared)!)), guarantee: { rc: Number(latin(kv.rc)), ra: Number(latin(kv.ra)), re: Number(latin(kv.re)) } }, method.data!);
        const R = (x: number) => toRials(x).toString();
        const map = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([q, v]) => [q, R(v)]));
        const periods: Period[] = ys.map((y, i) => ({ fiscal_year: y, trial_balance: y === c.latest_fiscal_year + 1, through_month: (fin(y) as any)?.through_month ?? null,
          sales: R(r.statements[i].sales), margin: r.ratios[i].profitability, growth: i < ys.length - 1 ? (r.statements[i].sales - r.statements[i + 1].sales) / r.statements[i + 1].sales : null }));
        return { credit_limit: R(r.creditLimit), guarantee: { ceiling: map(r.guarantee.ceiling) }, facility: { ceiling: map(r.facility.ceiling) }, avg_margin: r.avgMargin, avg_growth: r.avgGrowth, periods } as Calc;
      } catch (e) { if (e instanceof ScoringInputError) return null; throw e; }
    };
    return { a: run(per.a), b: run(per.b) };
  }, [method.data, act, kv.rc, kv.ra, kv.re, c]);
  const bHigher = !!live?.a && !!live?.b && BigInt(live.b.credit_limit) > BigInt(live.a.credit_limit);

  const after = () => { setText(""); setNote(""); rounds.reload(); reload(); };
  const run = useAction(async () => {
    await api.post(`/admin/cases/${c.id}/scoring`, {
      activity_type: act, guarantee: { rc: Number(latin(kv.rc)), ra: Number(latin(kv.ra)), re: Number(latin(kv.re)) },
      reasons: { rc: wv.rc.trim(), ra: wv.ra.trim(), re: wv.re.trim() },
      ...(bHigher && tbOk ? { trial_balance_check: { confirmed: true, note: tbNote.trim() } } : {}),
    });
    rounds.reload(); reload();
  });
  const send = useAction(async () => { await api.post(`/admin/cases/${c.id}/scoring/submit`, { summary: text.trim() }); after(); });
  const toCeo = useAction(async () => { await api.post(`/admin/cases/${c.id}/to-ceo`, { comment: text.trim() }); after(); });
  const sendBack = useAction(async () => { await api.post(`/admin/cases/${c.id}/send-back`, { reason: text.trim() }); after(); });
  const ceo = useAction(async (_k, decision: "accept" | "decline", r: Round) => {
    const changed = (part: "guarantee" | "facility") => Object.fromEntries(Object.entries(edits[part])
      .map(([q, t]) => [q, (BigInt(latin(t).replace(/\D/g, "") || "0") * 10n).toString()] as [string, string])
      .filter(([q, v]) => v !== "0" && v !== r.result[part].ceiling[q]));
    const g = changed("guarantee"), f = changed("facility");
    const body = { meeting_held: true, meeting_date: meeting.date, decision, comment: text.trim(),
      ...(decision === "accept" && (Object.keys(g).length || Object.keys(f).length) ? { overrides: { ...(Object.keys(g).length ? { guarantee: g } : {}), ...(Object.keys(f).length ? { facility: f } : {}) } } : {}) };
    await stepUp("POST", `/admin/cases/${c.id}/ceo-decision`, body, { title: decision === "accept" ? "پذیرش حد اعتباری" : "رد درخواست" });
    setEdits({ guarantee: {}, facility: {} }); setMeeting({ held: false, date: "" }); after();
  });
  const release = useAction(async () => { await api.post(`/admin/cases/${c.id}/release`, { note_to_applicant: note.trim() }); after(); });

  const canScore = isAnalyst && ["documents_complete", "scoring", "sent_back_to_analyst"].includes(c.state);
  const r = (s: string) => rounds.data?.find((x) => x.state === s);
  const preparing = r("preparing"), pending = r("pending_approval"), atCeo = r("ceo_review"), ceoDone = r("ceo_accepted") ?? r("ceo_declined");
  const missing: string[] = run.error?.code === "SCORING_NOT_READY" ? run.error.details?.missing ?? [] : [];
  const resultView = (x: Round) => x.result.alternatives
    ? <TwoCalcs a={x.result.alternatives.a} b={x.result.alternatives.b} chosen={x.result.chosen ?? "a"} bError={x.result.alternatives.b_error} />
    : <p>حد: <strong>{toman(x.result.credit_limit)}</strong></p>;
  const roundFacts = (x: Round) => <KV rows={[["نوع فعالیت", activityFa(x.activity_type)], ["Rc / Ra / Re", coefs(x.judgement)],
    ["دلایل", Object.entries(x.judgement.reasons ?? {}).map(([q, t]) => `${q.toUpperCase()}: ${t}`).join("؛ ")], ["خلاصه‌ی کارشناس", x.summary ?? "—"],
    ...(x.result.trial_balance_check?.confirmed ? [["تطبیق تراز آزمایشی", x.result.trial_balance_check.note] as [string, string]] : []),
    ...(x.compliance_comment ? [["نظر کارشناس انطباق", x.compliance_comment] as [string, string]] : [])]} />;

  return (
    <div className="stack">
      {canScore && (
        <div className="grid-2" style={{ alignItems: "start" }}>
          <Card title="ورودی‌های کارشناس">
            <div className="stack">
              <Select label="نوع فعالیت" value={act} onValue={setActivity} options={Object.entries(ACTIVITY_FA)} />
              <div className="coef">
                {(["rc", "ra", "re"] as const).map((x) => (
                  <TextInput key={x} label={{ rc: "Rc (سابقه‌ی اعتباری)", ra: "Ra (توان اجرایی)", re: "Re (ریسک محیطی)" }[x]} ltr value={kv[x]} onValue={(v) => setK({ ...kv, [x]: v })}
                    error={kv[x] && !three(kv[x]) ? "بین ۰ و ۱، حداکثر سه رقم اعشار" : undefined} />
                ))}
              </div>
              {(["rc", "ra", "re"] as const).map((x) => <TextArea key={x} label={`دلیل ${x.toUpperCase()}`} value={wv[x]} onValue={(v) => setWhy({ ...wv, [x]: v })} rows={2} />)}
              {bHigher && (
                <Banner tone="warning">
                  <div className="stack-sm">
                    <span>محاسبه‌ی ب (با تراز آزمایشی) حد بیشتری می‌دهد. فقط پس از تطبیق تراز آزمایشی با اظهارنامه‌ی مالیاتی و سایر مدارک می‌توان آن را مبنا قرار داد؛ وگرنه محاسبه‌ی الف مبناست.</span>
                    <Check checked={tbOk} onValue={setTbOk}>تراز آزمایشی را با اظهارنامه‌ی مالیاتی و سایر مدارک تطبیق دادم.</Check>
                    {tbOk && <TextArea label="شرح تطبیق" value={tbNote} onValue={setTbNote} rows={2} />}
                  </div>
                </Banner>
              )}
              <ErrorBanner error={run.error} />
              {missing.length > 0 && <Banner tone="warning">پیش از محاسبه: {missing.map((m) => MISSING_FA[m] ?? (m.startsWith("original_not_received") ? "تحویل اصل مدرک ثبت نشده" : m)).join("، ")}</Banner>}
              <Button busy={run.busy} disabled={!live?.a || [wv.rc, wv.ra, wv.re].some((x) => x.trim().length < 5) || (bHigher && tbOk && tbNote.trim().length < 5)} onClick={() => run.run()}>ثبت دور محاسبه</Button>
            </div>
          </Card>
          <div className="stack">
            {live?.a ? <TwoCalcs a={live.a} b={live.b} chosen={bHigher && tbOk ? "b" : "a"} /> : <Card><p className="t-muted">برای پیش‌نمایش، نوع فعالیت و ضرایب را وارد کنید.</p></Card>}
          </div>
        </div>
      )}

      {preparing && isAnalyst && preparing.prepared_by === meId && (
        <Card highlight title={`دور ${fa(preparing.round_no)} آماده‌ی ارسال برای کارشناس انطباق`}>
          <div className="stack">
            <p>حد محاسبه‌شده: <strong>{toman(preparing.result.credit_limit)}</strong> (محاسبه‌ی {preparing.result.chosen === "b" ? "ب" : "الف"})</p>
            <TextArea label="خلاصه برای کمیته و کارشناس انطباق" value={text} onValue={setText} rows={3} />
            <ErrorBanner error={send.error} />
            <Button busy={send.busy} disabled={text.trim().length < 10} onClick={() => send.run()}>ارسال برای کارشناس انطباق</Button>
          </div>
        </Card>
      )}

      {pending && (
        <Card highlight title={`ارسال دور ${fa(pending.round_no)} برای مدیر صندوق`}>
          <div className="stack">
            {resultView(pending)}
            {roundFacts(pending)}
            {!isCompliance ? <p className="t-muted">منتظر بررسی کارشناس انطباق.</p>
              : pending.prepared_by === meId ? <Banner tone="warning">این دور را خودتان آماده کرده‌اید؛ کارشناس انطباق دیگری باید آن را ارسال کند.</Banner> : (<>
              <TextArea label="نظر کارشناس انطباق برای مدیر صندوق (یا دلیل بازگشت)" value={text} onValue={setText} rows={3} />
              <ErrorBanner error={toCeo.error ?? sendBack.error} />
              <div className="row">
                <Button busy={toCeo.busy} disabled={text.trim().length < 5} onClick={() => toCeo.run()}>ارسال برای مدیر صندوق</Button>
                <Button variant="outline" busy={sendBack.busy} disabled={text.trim().length < 5} onClick={() => sendBack.run()}>بازگشت به کارشناس</Button>
              </div>
            </>)}
          </div>
        </Card>
      )}

      {atCeo && (
        <Card highlight title="تصمیم مدیر صندوق (مدیرعامل)">
          <div className="stack">
            {resultView(atCeo)}
            {roundFacts(atCeo)}
            {isCeo && atCeo.prepared_by !== meId ? (<>
              <Check checked={meeting.held} onValue={(v) => setMeeting({ ...meeting, held: v })}><strong>جلسه‌ی کمیته برای تعیین سقف این پرونده برگزار شده است.</strong></Check>
              {meeting.held && <JalaliDateInput label="تاریخ جلسه‌ی کمیته" value={meeting.date} onValue={(d) => setMeeting({ ...meeting, date: d })} />}
              <div className="stack-sm">
                <span className="field-label">سقف‌ها (تومان) — در صورت نیاز ویرایش کنید</span>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>وثیقه</th><th>سقف ضمانت‌نامه</th><th>سقف تسهیلات</th></tr></thead>
                  <tbody>{CLASSES.map((q) => (
                    <tr key={q}><td>{COLLATERAL_FA[q]}</td>
                      {(["guarantee", "facility"] as const).map((part) => (
                        <td key={part}><input className="input input-ltr" aria-label={`${part === "guarantee" ? "سقف ضمانت‌نامه" : "سقف تسهیلات"} ${COLLATERAL_FA[q]}`} disabled={!meeting.held}
                          value={edits[part][q] ?? (BigInt(atCeo.result[part].ceiling[q]) / 10n).toString()} onChange={(e) => setEdits({ ...edits, [part]: { ...edits[part], [q]: latin(e.target.value).replace(/\D/g, "") } })} /></td>
                      ))}
                    </tr>
                  ))}</tbody>
                </table></div>
                <span className="t-small t-muted">حد اعتباری شرکت، سقف ضمانت‌نامه با چک و سفته است.</span>
              </div>
              <TextArea label="نظر مدیر صندوق" value={text} onValue={setText} rows={3} />
              <ErrorBanner error={ceo.error} />
              <div className="row">
                <Button busy={ceo.busy} disabled={!meeting.held || !meeting.date || text.trim().length < 5} onClick={() => ceo.run("accept", atCeo)}>پذیرش</Button>
                <Button variant="danger" busy={ceo.busy} disabled={!meeting.held || !meeting.date || text.trim().length < 5} onClick={() => ceo.run("decline", atCeo)}>رد درخواست</Button>
              </div>
            </>) : <p className="t-muted">منتظر تصمیم مدیر صندوق.</p>}
          </div>
        </Card>
      )}

      {ceoDone && (
        <Card highlight title="اعلام نتیجه به شرکت">
          <div className="stack">
            <KV rows={[["تصمیم مدیر صندوق", ceoDone.ceo_decision === "accept" ? <span key="a" className="chip chip-success">پذیرش</span> : <span key="d" className="chip chip-danger">رد</span>],
              ["جلسه‌ی کمیته", jdate(ceoDone.committee_meeting_on)], ["نظر مدیر صندوق", ceoDone.ceo_comment ?? "—"], ["زمان", jdatetime(ceoDone.ceo_at)]]} />
            {ceoDone.ceo_decision === "accept" && (<>
              {ceoDone.ceo_overrides && <Banner tone="info">مدیر صندوق سقف‌ها را ویرایش کرده است؛ ارقام زیر نهایی است.</Banner>}
              <CeilingsTable calc={{ ...ceoDone.result, guarantee: { ceiling: { ...ceoDone.result.guarantee.ceiling, ...(ceoDone.ceo_overrides?.guarantee ?? {}) } }, facility: { ceiling: { ...ceoDone.result.facility.ceiling, ...(ceoDone.ceo_overrides?.facility ?? {}) } } }} />
            </>)}
            {isCompliance ? (<>
              <TextArea label="توضیح برای شرکت (درباره‌ی ارقام و شرایط)" value={note} onValue={setNote} rows={3} hint="ضرایب به شرکت نشان داده نمی‌شود." />
              <ErrorBanner error={release.error} />
              <Button busy={release.busy} disabled={note.trim().length < 5} onClick={() => release.run()}>اعلام به شرکت</Button>
            </>) : <p className="t-muted">منتظر اعلام توسط کارشناس انطباق.</p>}
          </div>
        </Card>
      )}

      {canAdjust && c.state === "limit_issued" && <AdjustLimit c={c} round={rounds.data?.find((x) => x.state === "approved")} reload={reload} />}

      <Card title="دورهای محاسبه">
        <ErrorBanner error={rounds.error} />
        {rounds.data?.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>دور</th><th>روش</th><th>فعالیت</th><th>Rc/Ra/Re</th><th>حد</th><th>وضعیت</th></tr></thead>
            <tbody>{rounds.data.map((x) => (
              <tr key={x.id}><td>{fa(x.round_no)}</td><td>نسخه‌ی {fa(x.method_version)}</td><td>{activityFa(x.activity_type)}</td>
                <td>{coefs(x.judgement)}</td><td className="num">{toman(x.result?.credit_limit)}</td><td><Status kind="round" value={x.state} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="t-muted">هنوز دوری ثبت نشده است.</p>}
      </Card>
    </div>
  );
}
