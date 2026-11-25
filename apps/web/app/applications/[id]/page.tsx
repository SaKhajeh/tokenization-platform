"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, KV, Status, TextArea, Tracker, fa, jdate, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";

interface App { id: string; application_no: string | null; status: string; investment_type: string; requested_amount: string; proposed_rate: string; proposed_rate_basis: string; proposed_duration_days: number; proposed_rule: string; use_of_funds: string; repayment_source: string; proposed_guarantees: { type: string; description: string }[]; prepared_by: string | null; submitted_at: string | null; created_at: string; assessment_invoice_id: string | null }
const STAGES = ["ارسال", "غربالگری", "پرداخت کارمزد", "بررسی حد اعتباری", "بررسی دقیق و کمیته", "شرایط نهایی و قرارداد", "توکن‌سازی و پذیره‌نویسی"];
const stage = (s: string) => ({ draft: 0, submitted: 1, resubmitted: 1, screening: 1, returned: 1, awaiting_payment: 2, credit_assessment: 3, due_diligence: 4, committee: 4, approved: 5, approved_with_conditions: 5, terms_negotiation: 5, terms_signed: 6, handed_to_tokenisation: 6 } as Record<string, number>)[s] ?? 0;

/** A-44: application tracker and the preparer → approver submission (FR-APP-2). */
export default function ApplicationPage() {
  const api = useApi();
  const stepUp = useStepUp();
  const { me, org } = useMe();
  const { id } = useParams<{ id: string }>();
  const q = useQuery(org ? `app:${id}` : null, () => api.get<App>(`/applications/${id}`));
  const [reason, setReason] = useState("");
  const prepare = useAction(async () => { await api.post(`/applications/${id}/request-approval`); q.reload(); });
  const submit = useAction(async (idem) => { await stepUp("POST", `/applications/${id}/submit`, {}, { idem, title: "ارسال درخواست به صندوق", summary: q.data ? <span>درخواست {toman(q.data.requested_amount)}</span> : undefined }); q.reload(); });
  const pay = useAction(async (idem) => { await stepUp("POST", `/invoices/${q.data!.assessment_invoice_id}/pay`, {}, { idem, title: "پرداخت کارمزد درخواست" }); q.reload(); });
  const withdraw = useAction(async () => { await api.post(`/applications/${id}/withdraw`, { reason: reason.trim() }); q.reload(); });
  const a = q.data;
  const role = org?.my_role ?? "";
  const single = org?.single_user_mode && org.active_members === 1;

  return (
    <Shell title={a ? `درخواست ${a.application_no ?? "(پیش‌نویس)"}` : "درخواست تأمین مالی"} action={a ? <Status kind="application" value={a.status} /> : null}>
      <div className="stack">
        <Link href="/financing">← بازگشت</Link>
        <ErrorBanner error={q.error} />
        {a && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            <Card><Tracker steps={STAGES} current={stage(a.status)} /></Card>
            <div className="stack">
              <Card title="جزئیات">
                <KV rows={[
                  ["مبلغ", toman(a.requested_amount)], ["مدت", `${fa(Math.round(a.proposed_duration_days / 30.4))} ماه`],
                  ["نرخ پیشنهادی", `${fa((Number(a.proposed_rate) * 100).toFixed(2).replace(/\.?0+$/, ""))}٪ ${a.proposed_rate_basis === "monthly" ? "ماهانه" : "سالانه"}`],
                  ["قاعده‌ی عدم تکمیل", a.proposed_rule === "all_or_nothing" ? "همه یا هیچ" : "تأمین به میزان جذب‌شده"],
                  ["محل مصرف", a.use_of_funds], ["منبع بازپرداخت", a.repayment_source],
                  ["تضامین", a.proposed_guarantees.map((g) => `${g.type}: ${g.description}`).join("؛ ")], ["تاریخ ارسال", jdate(a.submitted_at)],
                ]} />
              </Card>
              {a.status === "returned" && <Banner tone="warning">صندوق مواردی را خواسته است؛ کارهای باز را در فهرست کارها انجام دهید و سپس دوباره ارسال کنید.</Banner>}
              {a.status === "awaiting_payment" && a.assessment_invoice_id && ["org_admin", "approver"].includes(role) && (
                <Card highlight title="کارمزد درخواست"><ErrorBanner error={pay.error} /><Button busy={pay.busy} onClick={() => pay.run()}>پرداخت از موجودی</Button></Card>
              )}
              {["draft", "returned"].includes(a.status) && (
                <Card title="ارسال">
                  <div className="stack">
                    {!a.prepared_by && ["org_admin", "preparer"].includes(role) && <>
                      <p className="t-muted">ابتدا تهیه‌کننده درخواست را برای تأیید می‌فرستد؛ سپس تأییدکننده با رمز یکبارمصرف ارسال می‌کند.</p>
                      <ErrorBanner error={prepare.error} />
                      <Button busy={prepare.busy} onClick={() => prepare.run()}>ارسال برای تأیید</Button>
                    </>}
                    {a.prepared_by && ["org_admin", "approver"].includes(role) && (a.prepared_by !== me?.id || single) && <>
                      <ErrorBanner error={submit.error} />
                      <Button busy={submit.busy} onClick={() => submit.run()}>تأیید و ارسال به صندوق</Button>
                    </>}
                    {a.prepared_by && a.prepared_by === me?.id && !single && <Banner tone="info">درخواست برای تأیید فرستاده شد؛ تأییدکننده‌ی دیگری باید آن را ارسال کند.</Banner>}
                  </div>
                </Card>
              )}
              {!["withdrawn", "rejected", "expired", "handed_to_tokenisation"].includes(a.status) && ["org_admin", "approver"].includes(role) && (
                <Card title="انصراف">
                  <div className="stack">
                    <TextArea label="دلیل انصراف" value={reason} onValue={setReason} rows={2} />
                    <ErrorBanner error={withdraw.error} />
                    <Button variant="danger" busy={withdraw.busy} disabled={reason.trim().length < 3} onClick={() => withdraw.run()}>انصراف از درخواست</Button>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
