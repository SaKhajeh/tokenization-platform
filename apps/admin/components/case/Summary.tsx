"use client";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Card, KV, Status, Tracker, fa, jdate, jdatetime } from "@tp/ui";
import type { StaffCase } from "@/lib/case";

const STAGES = ["تکمیل توسط متقاضی", "بررسی مدارک", "بازدید و ارقام", "محاسبه‌ی حد", "تأیید مدیر صندوق", "حد صادر شد"];
const stage = (s: string) => ({ submitted: 1, resubmitted: 1, document_review: 1, documents_complete: 2, scoring: 3, sent_back_to_analyst: 3, pending_approval: 4, limit_issued: 5 } as Record<string, number>)[s] ?? 0;
const FLAG_FA: Record<string, string> = {
  sole_signatory: "تنها یک صاحب امضا", returned_cheques: "چک برگشتی اظهارشده", overdue_debts: "بدهی سررسیدگذشته", negative_equity: "حقوق مالکانه منفی",
  losses: "زیان‌دهی", declining_sales: "کاهش فروش", kyb_update_needed: "نیاز به به‌روزرسانی احراز هویت",
};
interface Report { company: Record<string, any>; red_flags: { code: string; detail?: any }[]; missing_inquiries: string[]; visit_findings: string | null; history_with_fund: any[] }

/** Overview: stage, the company, red flags from the fund's report, and the case history and file-access log (doc 07 §6a). */
export function Summary({ c }: { c: StaffCase }) {
  const api = useApi();
  const rep = useQuery(`report:${c.id}`, () => api.get<Report>(`/admin/cases/${c.id}/report`));
  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        <Card><Tracker steps={STAGES} current={stage(c.state)} /></Card>
        <Card title="پرونده">
          <KV rows={[
            ["آخرین سال مالی", fa(c.latest_fiscal_year)], ["تعداد ارسال", fa(c.submissions)], ["ارسال", jdatetime(c.submitted_at)],
            ["تکمیل مدارک", jdatetime(c.documents_complete_at)], ["قفل ارقام", jdatetime(c.financials_locked_at)], ["تعهدنامه", jdatetime(c.commitment.signed_at)],
          ]} />
        </Card>
      </div>
      <div className="stack">
        <ErrorBanner error={rep.error} />
        {rep.data && (<>
          <Card title="شرکت">
            <KV rows={[["نام", rep.data.company.name], ["شناسه‌ی ملی", <span key="n" className="ltr">{rep.data.company.national_id}</span>], ["نوع", rep.data.company.legal_form ?? "—"],
              ["تأسیس", jdate(rep.data.company.establishment_date)], ["نماینده", rep.data.company.representative ? `${rep.data.company.representative.name} (${rep.data.company.representative.role})` : "—"]]} />
          </Card>
          {rep.data.red_flags.length > 0 && <Banner tone="warning">نشانه‌های هشدار: {rep.data.red_flags.map((f) => FLAG_FA[f.code] ?? f.code).join("، ")}</Banner>}
          {rep.data.missing_inquiries.length > 0 && <Banner tone="info">استعلام اعتباری/ثنا ثبت نشده برای: {rep.data.missing_inquiries.join("، ")}</Banner>}
        </>)}
        <Card title="تاریخچه">
          <ul className="list">{[...c.events].reverse().map((e, i) => (
            <li key={i}><span className="row">{e.from_state && <><Status kind="case" value={e.from_state} /><span aria-hidden="true">←</span></>}<Status kind="case" value={e.to_state} />{e.note && <span className="t-small t-muted">{e.note}</span>}</span><span className="t-small t-muted">{jdatetime(e.at)}</span></li>
          ))}</ul>
        </Card>
        {c.access_history.length > 0 && (
          <Card title="سابقه‌ی دسترسی به فایل‌ها">
            <ul className="list">{c.access_history.slice(-30).reverse().map((a, i) => (
              <li key={i}><span>{a.action === "download" ? "دریافت" : "نمایش"} — {a.filename ?? a.file_id}{a.user_name ? ` — ${a.user_name}` : ""}</span><span className="t-small t-muted">{jdatetime(a.at)}</span></li>
            ))}</ul>
          </Card>
        )}
      </div>
    </div>
  );
}
