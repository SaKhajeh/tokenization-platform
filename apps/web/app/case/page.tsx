"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@tp/client";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, Check, Empty, KV, Progress, Status, TextArea, Tracker, fa, jdate, jdatetime, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";
import { EDITABLE, blockerText, type Case } from "@/lib/case";
import { SECTIONS, SECTION_ORDER } from "@/lib/sections";
import { ASSESSMENT_DISCLAIMER_FA, FINANCIAL_YEARS, VISIT_INSTRUCTIONS_FA } from "@tp/domain/caseFile";

const STAGES = ["تکمیل پرونده", "بررسی مدارک", "بازدید و تأیید ارقام", "محاسبه‌ی حد", "تأیید مدیر صندوق", "حد اعتباری"];
const stageOf = (s: string) => ({ opened: 0, in_preparation: 0, returned: 0, under_review: 0, submitted: 1, resubmitted: 1, document_review: 1, documents_complete: 2, scoring: 3, sent_back_to_analyst: 3, pending_approval: 4, limit_issued: 5 } as Record<string, number>)[s] ?? 0;
interface Visit { id: string; state: string; visit_date: string; visit_time: string; findings: string | null }

/** A-70: the credit case home — what is done, what blocks submission, and the actions (doc 07 §2a, §11). */
export default function CasePage() {
  const api = useApi();
  const stepUp = useStepUp();
  const { org } = useMe();
  const k = org?.id ?? null;
  const cs = useQuery(k && `case:${k}`, () => api.get<Case>("/case"));
  const visit = useQuery(k && cs.data && stageOf(cs.data.state) >= 1 ? `visit:${k}` : null, () => api.get<Visit>("/case/visit").catch((e: ApiError) => (e.code === "NO_VISIT" ? null : Promise.reject(e))));
  const [letter, setLetter] = useState("");
  const [commit, setCommit] = useState(false);
  const [changeMsg, setChangeMsg] = useState("");
  useEffect(() => { if (cs.data?.letter?.text) setLetter(cs.data.letter.text); }, [cs.data?.letter?.text]);

  const saveLetter = useAction(async () => { await api.put("/case/letter", { text: letter.trim() }); cs.reload(); });
  const signLetter = useAction(async () => { await stepUp("POST", "/case/letter/sign", {}, { title: "امضای درخواست‌نامه" }); cs.reload(); });
  const fee = useAction(async (idem) => {
    const inv = await api.post<{ invoice_id: string; total: string; status: string }>("/case/fee");
    if (inv.status === "issued") await stepUp("POST", `/invoices/${inv.invoice_id}/pay`, {}, { idem, title: "پرداخت کارمزد ارزیابی", summary: <span>{toman(inv.total)} از موجودی سازمان پرداخت می‌شود.</span> });
    cs.reload();
  });
  const submit = useAction(async (idem) => {
    await stepUp("POST", "/case/submit", { commitment_accepted: true }, { idem, title: "ارسال پرونده به صندوق", summary: <span>با این تأیید، تعهدنامه‌ی صحت اطلاعات از طرف شرکت امضا می‌شود.</span> });
    cs.reload();
  });
  const confirmVisit = useAction(async () => { await api.post("/case/visit/confirm"); visit.reload(); });
  const otherDate = useAction(async () => { await api.post("/case/visit/change-request", { message: changeMsg.trim() }); setChangeMsg(""); visit.reload(); });

  if (cs.error?.code === "NO_CASE") return (
    <Shell title="پرونده‌ی اعتباری">
      <Card><Empty title="پرونده‌ی اعتباری ندارید" action={<Link href="/onboarding"><Button>درخواست تأمین مالی</Button></Link>}>
        پرونده وقتی باز می‌شود که «دریافت تأمین مالی» را به عنوان هدف سازمان انتخاب کنید و احراز هویت را ارسال کنید.
      </Empty></Card>
    </Shell>
  );
  const c = cs.data;
  const canEdit = !!c && EDITABLE.includes(c.state) && ["org_admin", "preparer"].includes(org?.my_role ?? "");
  const canSign = ["org_admin", "approver"].includes(org?.my_role ?? "");
  const items = c?.items.filter((i) => i.state !== "not_required") ?? [];
  const itemsDone = items.filter((i) => !["empty", "requested", "needs_fix", "rejected"].includes(i.state)).length;
  const secDone = c?.sections.filter((s) => s.state !== "empty" && !s.problems.length).length ?? 0;
  const finDone = c?.financials.filter((f) => f.declared && !f.problems.length && f.statement_type).length ?? 0;
  const feeBlocker = c?.blockers.find((b) => b.code === "assessment_fee_unpaid");
  const sectionTitle = (s: string) => SECTIONS[s]?.title ?? s;

  return (
    <Shell title="پرونده‌ی اعتباری" action={c ? <Status kind="case" value={c.state} /> : null}>
      {!c ? <ErrorBanner error={cs.error} /> : (
        <div className="stack">
          <Banner tone="info"><strong>توجه:</strong> {ASSESSMENT_DISCLAIMER_FA}</Banner>
          <div className="grid-2" style={{ alignItems: "start" }}>
            <Card>
              <KV rows={[["شماره‌ی پرونده", <span key="n" className="ltr">{c.case_no}</span>], ["آخرین سال مالی", fa(c.latest_fiscal_year)], ["تاریخ ارسال", jdate(c.submitted_at)]]} />
              <hr className="divider" />
              <Tracker steps={STAGES} current={stageOf(c.state)} />
            </Card>
            <div className="stack">
              {c.state === "returned" && <Banner tone="warning">صندوق مواردی را برای اصلاح برگردانده است. موارد علامت‌خورده را اصلاح کنید و دوباره ارسال کنید.</Banner>}
              {c.state === "limit_issued" && <Banner tone="success">حد اعتباری شما صادر شد. <Link href="/limit">مشاهده‌ی حد اعتباری</Link></Banner>}
              {["submitted", "resubmitted", "document_review"].includes(c.state) && <Banner tone="info">پرونده در صف بررسی کارشناس صندوق است. هر پیام یا درخواستی به شما اطلاع داده می‌شود.</Banner>}
              {visit.data && (
                <Card title="بازدید از شرکت" action={<Status kind="visit" value={visit.data.state} />}>
                  <p>{jdate(visit.data.visit_date)}، ساعت <span className="ltr">{fa(visit.data.visit_time)}</span></p>
                  {["proposed", "confirmed"].includes(visit.data.state) && <p className="review-note" style={{ marginTop: 8 }}>{VISIT_INSTRUCTIONS_FA}</p>}
                  {visit.data.state === "proposed" && (
                    <div className="stack" style={{ marginTop: 12 }}>
                      <ErrorBanner error={confirmVisit.error ?? otherDate.error} />
                      <Button busy={confirmVisit.busy} onClick={() => confirmVisit.run()}>تأیید زمان بازدید</Button>
                      <TextArea label="یا زمان دیگری پیشنهاد دهید" value={changeMsg} onValue={setChangeMsg} rows={2} />
                      <Button variant="outline" busy={otherDate.busy} disabled={changeMsg.trim().length < 3} onClick={() => otherDate.run()}>ارسال درخواست زمان دیگر</Button>
                    </div>
                  )}
                  {visit.data.state === "confirmed" && <p className="t-small t-muted">لطفاً اصل مدارکی را که با «تحویل اصل» مشخص شده‌اند در روز بازدید آماده کنید.</p>}
                </Card>
              )}
            </div>
          </div>

          <div className="grid-2">
            <Card title="فرم اطلاعات" action={<span className="t-small t-muted">{fa(secDone)} از {fa(SECTION_ORDER.length)}</span>}>
              <Progress value={secDone} max={SECTION_ORDER.length} label="پیشرفت فرم" />
              <ul className="list" style={{ marginTop: 8 }}>
                {SECTION_ORDER.map((s) => {
                  const sec = c.sections.find((x) => x.section === s)!;
                  const ok = sec && sec.state !== "empty" && !sec.problems.length;
                  return (
                    <li key={s}>
                      <Link href={`/case/form/${s}`}>{SECTIONS[s].title}</Link>
                      {sec && ["needs_fix", "rejected"].includes(sec.state) ? <Status kind="item" value={sec.state} /> : ok ? <span className="chip chip-success">کامل</span> : <span className="chip chip-neutral">{sec?.state === "empty" ? "شروع نشده" : "ناقص"}</span>}
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="stack">
              <Card title="مدارک" action={<span className="t-small t-muted">{fa(itemsDone)} از {fa(items.length)}</span>}>
                <Progress value={itemsDone} max={items.length} label="پیشرفت مدارک" />
                <div style={{ marginTop: 12 }}><Link href="/case/documents"><Button variant="secondary" block>بارگذاری و مدیریت مدارک</Button></Link></div>
              </Card>
              <Card title="خلاصه‌ی صورت‌های مالی" action={<span className="t-small t-muted">{fa(finDone)} از {fa(FINANCIAL_YEARS)} سال</span>}>
                <Progress value={finDone} max={FINANCIAL_YEARS} label="پیشرفت صورت‌های مالی" />
                <div style={{ marginTop: 12 }}><Link href="/case/financials"><Button variant="secondary" block>ورود ارقام چهار سال اخیر</Button></Link></div>
              </Card>
            </div>
          </div>

          <Card title="درخواست‌نامه" action={c.letter.signed_at ? <span className="chip chip-success">امضا شد {jdatetime(c.letter.signed_at)}</span> : null}>
            <div className="stack">
              <TextArea label="متن درخواست (خطاب به صندوق)" value={letter} onValue={setLetter} disabled={!canEdit} hint="مبلغ تقریبی، کاربرد منابع و نوع خدمت مورد نیاز را بنویسید. دست‌کم ۲۰ نویسه." />
              <ErrorBanner error={saveLetter.error ?? signLetter.error} />
              <div className="row">
                {canEdit && <Button variant="outline" busy={saveLetter.busy} disabled={letter.trim().length < 20 || letter.trim() === (c.letter.text ?? "")} onClick={() => saveLetter.run()}>ذخیره‌ی متن</Button>}
                {canEdit && canSign && c.letter.text && !c.letter.signed_at && <Button busy={signLetter.busy} onClick={() => signLetter.run()}>امضا با رمز یکبارمصرف</Button>}
              </div>
            </div>
          </Card>

          {EDITABLE.includes(c.state) && (
            <Card title={c.state === "returned" ? "ارسال دوباره" : "ارسال پرونده"}>
              <div className="stack">
                {feeBlocker && (
                  <div className="row-between">
                    <span>کارمزد ارزیابی ({feeBlocker.region === "tehran" ? "تهران" : "خارج از تهران"}): <strong>{toman(feeBlocker.amount)}</strong></span>
                    {canSign && <Button variant="secondary" busy={fee.busy} onClick={() => fee.run()}>پرداخت از موجودی</Button>}
                  </div>
                )}
                <ErrorBanner error={fee.error} />
                {c.blockers.length ? (
                  <Banner tone="warning"><div className="stack-sm"><strong>پیش از ارسال:</strong>
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>{c.blockers.slice(0, 15).map((b, i) => <li key={i}>{blockerText(b, sectionTitle)}</li>)}</ul>
                    {c.blockers.length > 15 && <span>و {fa(c.blockers.length - 15)} مورد دیگر</span>}
                  </div></Banner>
                ) : <Banner tone="success">پرونده آماده‌ی ارسال است.</Banner>}
                {canSign && (
                  <>
                    <Check checked={commit} onValue={setCommit}>تعهد می‌کنم اطلاعات و مدارک پرونده صحیح و کامل است و مسئولیت آن با شرکت است.</Check>
                    <ErrorBanner error={submit.error} />
                    <Button busy={submit.busy} disabled={!commit || c.blockers.length > 0} onClick={() => submit.run()}>{c.state === "returned" ? "ارسال دوباره" : "ارسال پرونده"}</Button>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </Shell>
  );
}
